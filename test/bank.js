const { expect } = require('chai');
const { ethers } = require('ethers');
const { time, expectRevert, BN } = require('@openzeppelin/test-helpers');
const bn = (n) => new BN(n)
const snapshot = require('./lib/snapshot');
const { strip0x } = require('./lib/utils');
const { decShift } = require('../tools/lib/big');

require('./lib/seedrandom');
Math.seedrandom('any string you like');

const TIME_TOLLERANCE = 2;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const LARGE_VALUE = '0x8000000000000000000000000000000000000000000000000000000000000000'

const TOKEN_LEVEL_RECEIVABLE    = '1'.padStart(24,'0');
const TOKEN_LEVEL_STAKE         = '2'.padStart(24,'0');

const ROUTER_NONE                   = 0;
const ROUTER_EARN_TOKEN             = 1 << 0;
const ROUTER_FARM_TOKEN             = 1 << 1;
const ROUTER_OWNERSHIP_PRESERVED    = 1 << 2;     // router that always use msg.sender as recipient

const Proxy = artifacts.require('Proxy');
const Token = artifacts.require('Token');
const Timelock = artifacts.require('Timelock');
const Role = artifacts.require('Role');
const Bank = artifacts.require('Bank');

const ERC20 = artifacts.require('ERC20PresetMinterPauser');
const Factory = artifacts.require('UniswapV2Factory');
const UniswapV2Router01 = artifacts.require('UniswapV2Router01');
const Pair = artifacts.require('UniswapV2Pair');
const LZCitizen = artifacts.require('LZCitizen');

Proxy.abi = [ Proxy, Token, Timelock, Role, Bank ]
  .reduce((abi, a) => abi.concat(a.abi), [])
  .reduce((items, item) => {
    if (!items.some(({name}) => name === item.name)) {
      items.push(item)
    }
    return items
  }, [])

const ABIs = [ Proxy, Factory, UniswapV2Router01, Pair ]
  .reduce((abi, a) => abi.concat(a.abi), [])
  .reduce((items, item) => {
    if (!items.some(({name}) => name === item.name)) {
      items.push(item)
    }
    return items
  }, [])

const CONTRACT = new ethers.Contract(ZERO_ADDRESS, ABIs)

let inst = {
  coin: [],
  router: [],
  pair: {},
  earnPair: {},
};

contract("bank", accounts => {	
  const farmer = accounts[2]
  const admin = accounts[1]

  before('should our contracts be deployed', async () => {
    inst.earn = await ERC20.new('ezDeFi', 'LZ')
    expect(inst.earn, 'contract not deployed: LZ').to.not.be.null

    inst.proxy = await Proxy.new(admin, inst.earn.address)
    expect(inst.proxy, 'contract not deployed: proxy').to.not.be.null

    const token = await Token.new()
    await inst.proxy.upgradeContract(
      token.address,
      '0x',
      { from: admin },
    )
    // inst.token = await Token.at(inst.proxy.address)

    const timelock = await Timelock.new()
    await inst.proxy.upgradeContract(
      timelock.address,
      (await timelock.setDelay.request(7*24*60*60)).data,
      { from: admin },
    )
    // inst.timelock = await Timelock.at(inst.proxy.address)

    const role = await Role.new()
    await inst.proxy.upgradeContract(
      role.address,
      (await role.setSubsidy.request(admin, decShift(0.1, 18))).data,
      { from: admin },
    )
    // inst.role = await Role.at(inst.proxy.address)

    const bank = await Bank.new()
    await inst.proxy.upgradeContract(
      bank.address,
      '0x',
      { from: admin },
    )
    // inst.bank = await Bank.at(inst.proxy.address)

    for (let i = 0; i < accounts.length; ++i) {
      const coin = await ERC20.new('Stablecoin Number ' + i, 'USD'+i)
      inst.coin.push(coin)
    }
  });

  before('should 3rd party contracts be deployed', async () => {
    inst.weth = await ERC20.new('Wrapped ETH', 'WETH');
    const factory = await Factory.new(accounts[0]);
    inst.router[0] = await UniswapV2Router01.new(factory.address, inst.weth.address)
    inst.citizen = await LZCitizen.new()
  });

  before("init liquidity routers", async() => {
    for (let i = 0; i < inst.coin.length-1; ++i) {
      for (let j = i+1; j < inst.coin.length; ++j) {
        const a = Math.random()
        const b = a + (Math.random()/100) - 1/200
        const amountA = decShift(a, 24)
        const amountB = decShift(b, 24)
        await inst.coin[i].mint(accounts[0], amountA)
        await inst.coin[j].mint(accounts[0], amountB)
        await inst.coin[i].approve(inst.router[0].address, LARGE_VALUE)
        await inst.coin[j].approve(inst.router[0].address, LARGE_VALUE)
        const r = await inst.router[0].addLiquidity(
          inst.coin[i].address, inst.coin[j].address,
          amountA, amountB,
          0, 0,
          ZERO_ADDRESS, // discard the LP token
          LARGE_VALUE,
        )
        const parsedLogs = parseLogs(r.receipt)
        const {token0, token1, pair} = parsedLogs.find(log => log.name === 'PairCreated').args
        if (!inst.pair[i]) inst.pair[i] = {}
        if (!inst.pair[j]) inst.pair[j] = {}
        inst.pair[i][j] = inst.pair[j][i] = await Pair.at(pair)
      }
    }
  })

  before("init liquidity routers to earn token", async() => {
    for (let i = 0; i < inst.coin.length; ++i) {
      const amountA = decShift(Math.random(), 24)
      const amountB = decShift(Math.random(), 24)
      await inst.coin[i].mint(accounts[0], amountA)
      await inst.earn.mint(accounts[0], amountB)
      await inst.coin[i].approve(inst.router[0].address, LARGE_VALUE)
      await inst.earn.approve(inst.router[0].address, LARGE_VALUE)
      const r = await inst.router[0].addLiquidity(
        inst.coin[i].address, inst.earn.address,
        amountA, amountB,
        0, 0,
        ZERO_ADDRESS, // discard the LP token
        LARGE_VALUE,
      )
      const parsedLogs = parseLogs(r.receipt)
      const {token0, token1, pair} = parsedLogs.find(log => log.name === 'PairCreated').args
      inst.earnPair[i] = await Pair.at(pair)
    }
  })

  describe('setup', () => {
    it("authorize tokens for stake", async() => {
      await expectRevert(inst.proxy.deposit(inst.coin[0].address, 1), 'unauthorized token')
      await inst.proxy.authorizeTokens(inst.coin.map(c => c.address + TOKEN_LEVEL_STAKE), { from: admin })
    })

    it("authorize tokens for receiving", async() => {
      // TODO: expectRevert
      const pairs = []
      for(const i of Object.keys(inst.pair)) {
        for (const j of Object.keys(inst.pair[i])) {
          if (i < j) {
            pairs.push(inst.pair[i][j].address + TOKEN_LEVEL_RECEIVABLE)
          }
        }
      }
      await inst.proxy.authorizeTokens(pairs, { from: admin })
    })

    it("approve farm to spent all coins", async() => {
      await expectRevert(inst.proxy.deposit(inst.coin[0].address, 1), 'transfer amount exceeds balance')
      await inst.coin[0].mint(accounts[0], 1)
      await expectRevert(inst.proxy.deposit(inst.coin[0].address, 1), 'transfer amount exceeds allowance')
      await inst.coin[0].burn(1, { from: accounts[0] })
  
      for (const coin of inst.coin) {
        for (const from of accounts) {
          await coin.approve(inst.proxy.address, LARGE_VALUE, { from })
        }
      }
    })

    it("approve router to spent all farm's coins", async() => {
      await expectRevert(inst.proxy.allow(
        inst.coin.map(c => c.address),
        inst.router.map(r => r.address),
        LARGE_VALUE,
        { from: admin }
      ), 'unauthorized router')

      await inst.proxy.authorizeRouters(inst.router.map(r => r.address + routerMask(ROUTER_FARM_TOKEN)), { from: admin })

      const coins = inst.coin.map(c => c.address)
      for (let i = 0; i < inst.coin.length-1; ++i) {
        for (let j = i+1; j < inst.coin.length; ++j) {
          coins.push(inst.pair[i][j].address)
        }
      }

      await inst.proxy.allow(
        coins,
        inst.router.map(r => r.address),
        LARGE_VALUE,
        { from: admin }
      )
    })
  })

  describe("ERC20", () => {
    let ss
    it("setup some balance", async() => {
      ss = await snapshot.take()

      await inst.coin[0].mint(accounts[5], decShift(100, 18))
      await inst.proxy.deposit(inst.coin[0].address, decShift(100, 18), { from: accounts[5] })

      await inst.coin[1].mint(accounts[6], decShift(33, 18))
      await inst.proxy.deposit(inst.coin[1].address, decShift(33, 18), { from: accounts[6] })

      await expectRevert(
        inst.proxy.transfer(accounts[6], decShift(13, 18), { from: accounts[5] }),
        "locked",
      )

      await time.increase(48*60*60)
    })

    it("transfer", async() => {
      await inst.proxy.transfer(accounts[6], decShift(13, 18), { from: accounts[5] })
      expect(await inst.proxy.balanceOf(accounts[5])).is.bignumber.equal(decShift(87, 18), "balance after transfer")
      expect(await inst.proxy.balanceOf(accounts[6])).is.bignumber.equal(decShift(46, 18), "balance after receive")
    })

    it("harvest", async() => {
      await inst.earn.mint(inst.proxy.address, decShift(100, 18))

      await inst.proxy.transfer(accounts[3], decShift(4, 18), { from: accounts[6] })
      expect(await inst.proxy.balanceOf(accounts[3])).is.bignumber.equal(decShift(4, 18), "balance after transfer")
      {
        const { contribution } = await inst.proxy.query(accounts[3])
        expect(contribution).is.bignumber.lte('0', "contribution right after receiving stake")
      }
      {
        const tx = await inst.proxy.harvest(0, { from: accounts[3] })
        const { value } = tx.receipt.logs.find(l => l.event === 'Harvest').args
        expect(value).is.bignumber.equal('0', "harveset right after receiving stake")
      }
      await time.increase(24*60*60)
      {
        const { contribution } = await inst.proxy.query(accounts[3])
        expect(contribution).is.bignumber.at.least(decShift(4*24*60*60, 18), "contribution after a while")
      }
      {
        const tx = await inst.proxy.harvest(0, { from: accounts[3] })
        const { value } = tx.receipt.logs.find(l => l.event === 'Harvest').args
        expect(value).is.bignumber.gt('0', "harveset after a while")
      }
    })

    it("ignored address", async() => {
      await inst.proxy.transfer(accounts[4], decShift(4, 18), { from: accounts[5] })
      const z = await inst.proxy.totalSupply()
      await inst.proxy.ignoreAddress([accounts[4]], true, { from: admin })
      await expectRevert(inst.proxy.ignoreAddress([accounts[4]], true, { from: admin }), "ignore flag unchanged")
      const a = await inst.proxy.totalSupply()
      expect(z.sub(a)).is.bignumber.equal(decShift(4, 18), "after ignoring address with balance")
      await inst.proxy.transfer(accounts[4], decShift(13, 18), { from: accounts[5] })
      const b = await inst.proxy.totalSupply()
      expect(a.sub(b)).is.bignumber.equal(decShift(13, 18), "after transfering to ignored address")
      await inst.proxy.transfer(accounts[6], decShift(6, 18), { from: accounts[4] })
      const c = await inst.proxy.totalSupply()
      expect(c.sub(b)).is.bignumber.equal(decShift(6, 18), "after transfering from ignored address")
      await inst.proxy.ignoreAddress([accounts[4]], false, { from: admin })
      await expectRevert(inst.proxy.ignoreAddress([accounts[4]], false, { from: admin }), "ignore flag unchanged")
      const d = await inst.proxy.totalSupply()
      expect(d).is.bignumber.equal(z, "after un-ignoring address with balance")
    })

    it("revert all changes", async() => {
      await snapshot.revert(ss)
    })
  })

  describe("Pausable", () => {
    let ss
    it("setup some balance", async() => {
      ss = await snapshot.take()

      await inst.coin[0].mint(accounts[5], decShift(100, 18))
      await inst.proxy.deposit(inst.coin[0].address, decShift(100, 18), { from: accounts[5] })

      await inst.coin[1].mint(accounts[6], decShift(33, 18))
      await inst.proxy.deposit(inst.coin[1].address, decShift(33, 18), { from: accounts[6] })

      await expectRevert(
        inst.proxy.transfer(accounts[6], decShift(13, 18), { from: accounts[5] }),
        "locked",
      )

      await time.increase(48*60*60)
    })

    it("pause permission", async() => {
      await expectRevert(inst.proxy.pause(true), "!admin")
      await inst.proxy.pause(true, { from: admin })
      await expectRevert(inst.proxy.pause(true, { from: admin }), "Pausable: unchanged")
      await expectRevert(inst.proxy.pause(false), "!admin")
      await inst.proxy.pause(false, { from: admin })
      await expectRevert(inst.proxy.pause(false, { from: admin }), "Pausable: unchanged")
    })

    it("pause effect", async() => {
      await inst.proxy.pause(true, { from: admin })

      await expectRevert(inst.proxy.transfer(accounts[3], decShift(4, 18), { from: accounts[6] }), "Pausable: paused" )
      await expectRevert(inst.proxy.harvest(0, { from: accounts[5] }), "Pausable: paused" )
      await expectRevert(inst.proxy.withdraw(inst.coin[0].address, decShift(13, 18), [], { from: accounts[5] }), "Pausable: paused")

      await inst.proxy.pause(false, { from: admin })

      await inst.proxy.transfer(accounts[3], decShift(4, 18), { from: accounts[6] })
      await inst.proxy.harvest(0, { from: accounts[5] })
      await inst.proxy.withdraw(inst.coin[0].address, decShift(13, 18), [], { from: accounts[5] })
    })

    it("revert all changes", async() => {
      await snapshot.revert(ss)
    })
  })

  describe('timelock', () => {
    it("!admin without timelock", async() => {
      await expectRevert(inst.proxy.authorizeTokens(inst.coin.map(c => c.address + TOKEN_LEVEL_STAKE)), "!admin")
    })

    it("stake enough token to trigger timelock requirement", async() => {
      await inst.coin[2].mint(accounts[2], decShift(10001, 18))
      await inst.proxy.deposit(inst.coin[2].address, decShift(10001, 18), { from: accounts[2] })
    })

    it("!timelock", async() => {
      await expectRevert(inst.proxy.authorizeTokens(inst.coin.map(c => c.address + TOKEN_LEVEL_STAKE)), "!timelock")
    })

    it("!admin", async() => {
      const params = await timelockParams('authorizeTokens', inst.coin.map(c => c.address + TOKEN_LEVEL_STAKE))
      await expectRevert(inst.proxy.queueTransaction(...params), "!admin")
    })

    it("timelock: too soon", async() => {
      const params = await timelockParams('authorizeTokens', inst.coin.map(c => c.address + TOKEN_LEVEL_STAKE))
      await inst.proxy.queueTransaction(...params, { from: admin })
      await expectRevert(inst.proxy.executeTransaction(...params, { from: admin }), "hasn't surpassed time lock")
      await time.increase(7*24*60*60 + TIME_TOLLERANCE)
      await expectRevert(inst.proxy.executeTransaction(...params), "!admin")
    })

    it("timelock: not queued", async() => {
      const params = await timelockParams('authorizeTokens', inst.coin.map(c => c.address + TOKEN_LEVEL_STAKE))
      await time.increase(7*24*60*60 + TIME_TOLLERANCE)
      await expectRevert(inst.proxy.executeTransaction(...params, { from: admin }), "hasn't been queued")
    })

    it("timelock: canceled", async() => {
      const params = await timelockParams('authorizeTokens', inst.coin.map(c => c.address + TOKEN_LEVEL_STAKE))
      await inst.proxy.queueTransaction(...params, { from: admin })
      await time.increase(3*24*60*60 + TIME_TOLLERANCE)
      await inst.proxy.cancelTransaction(...params, { from: admin })
      await time.increase(4*24*60*60 + TIME_TOLLERANCE)
      await expectRevert(inst.proxy.executeTransaction(...params, { from: admin }), "hasn't been queued")
    })

    it("timelock: farmerExec attack", async() => {
      const ss = await snapshot.take()

      await adminExec("authorizeFarmers", [ farmer + '1'.padStart(24,'0') ])

      await expectRevert(adminExec("authorizeRouters",
        [ inst.proxy.address + routerMask(ROUTER_EARN_TOKEN | ROUTER_FARM_TOKEN | ROUTER_OWNERSHIP_PRESERVED) ]
      ), "nice try")

      const params = await timelockParams('authorizeTokens', inst.coin.map(c => c.address + TOKEN_LEVEL_STAKE))
      const input = params[3]

      await expectRevert(inst.proxy.farmerExec(
        inst.coin[0].address,
        inst.proxy.address,
        input,
        { from: farmer },
      ), "unauthorized router")

      await snapshot.revert(ss)
    })

    it("timelock: withdraw attack", async() => {
      const ss = await snapshot.take()

      const amount = 1000000;
      await inst.coin[0].mint(accounts[0], amount)
      await inst.proxy.deposit(inst.coin[0].address, amount)

      const params = await timelockParams('authorizeTokens', inst.coin.map(c => c.address + TOKEN_LEVEL_STAKE))
      const input = params[3]
      const funcSign = strip0x(input).substr(0, 8)

      await expectRevert(adminExec("authorizeWithdrawalFuncs",
        [ inst.proxy.address + funcSign + routerWithdrawalMask(ROUTER_EARN_TOKEN | ROUTER_FARM_TOKEN | ROUTER_OWNERSHIP_PRESERVED) ]
      ), "nice try")

      await expectRevert(inst.proxy.withdraw(inst.coin[0].address, amount, [{
          receivingToken: inst.coin[0].address,
          execs: [{
            router: inst.proxy.address,
            input,
          }],
        }],
      ), "unauthorized router.function")

      await snapshot.revert(ss)
    })
  })

  describe('stake', () => {
    it("overlap", async() => {
      const ss = await snapshot.take();
      await inst.coin[0].mint(accounts[0], decShift(60, 18))
      await inst.proxy.deposit(inst.coin[0].address, decShift(13, 18))

      await time.increase(240*60*60);
      await inst.coin[0].mint(accounts[1], decShift(100, 18))
      await inst.proxy.deposit(inst.coin[0].address, decShift(87, 18), { from: accounts[1] })

      await time.increase(13*60*60);
      await inst.proxy.withdraw(inst.coin[0].address, decShift(13, 18), [])
      expect(await inst.coin[0].balanceOf(accounts[0])).to.be.bignumber.equal(decShift(60, 18), "balance intact")

      await time.increase(30*60*60);
      await inst.proxy.withdraw(inst.coin[0].address, decShift(87, 18), [], { from: accounts[1] })
      expect(await inst.coin[0].balanceOf(accounts[1])).to.be.bignumber.equal(decShift(100, 18), "balance intact")
      await snapshot.revert(ss);
    })

    it("stake withdraw: leave 1 wei behind", async() => {
      const ss = await snapshot.take();

      await inst.coin[0].mint(accounts[0], decShift(60, 18))
      await inst.proxy.deposit(inst.coin[0].address, decShift(60, 18))

      await time.increase(48*60*60);
      await expectRevert(
        inst.proxy.withdraw(inst.coin[0].address, bn(decShift(60, 18)).sub(bn(1)), []),
        "ds-math-sub-underflow")

      await snapshot.revert(ss);
    })

    it("stake lock: single", async() => {
      const ss = await snapshot.take();
      await inst.coin[0].mint(accounts[0], decShift(60, 18))
      await inst.proxy.deposit(inst.coin[0].address, decShift(13, 18))

      await time.increase(24*60*60-TIME_TOLLERANCE);
      await expectRevert(inst.proxy.withdraw(inst.coin[0].address, 1, []), 'locked', 'withdraw: locked')
      const { contribution } = await inst.proxy.query(accounts[0]);
      expect(contribution).is.bignumber.lt('0', "locked contribution")
      await time.increase(TIME_TOLLERANCE);
      await inst.proxy.withdraw(inst.coin[0].address, decShift(13, 18), [])
      expect(await inst.coin[0].balanceOf(accounts[0])).to.be.bignumber.equal(decShift(60, 18), "balance intact")
      await snapshot.revert(ss);
    })

    it("stake lock: queue", async() => {
      const ss = await snapshot.take();
      await inst.coin[0].mint(accounts[0], decShift(100, 18))
      await inst.proxy.deposit(inst.coin[0].address, decShift(10, 18))

      await time.increase(24*60*60-TIME_TOLLERANCE);
      await expectRevert(inst.proxy.withdraw(inst.coin[0].address, 1, []), 'locked', 'withdraw: locked')
      await time.increase(TIME_TOLLERANCE);
      {
        const ss = await snapshot.take();
        await inst.proxy.withdraw(inst.coin[0].address, decShift(10, 18), [])
        expect(await inst.coin[0].balanceOf(accounts[0])).to.be.bignumber.equal(decShift(100, 18))
        await snapshot.revert(ss);
      }

      await inst.proxy.deposit(inst.coin[0].address, decShift(2, 18))

      await time.increase(24*60*60*2/(10+2)-TIME_TOLLERANCE);
      await expectRevert(inst.proxy.withdraw(inst.coin[0].address, 1, []), 'locked', 'withdraw: locked 2')
      await time.increase(TIME_TOLLERANCE);
      {
        const ss = await snapshot.take();
        await inst.proxy.withdraw(inst.coin[0].address, decShift(12, 18), [])
        expect(await inst.coin[0].balanceOf(accounts[0])).to.be.bignumber.equal(decShift(100, 18))
        await snapshot.revert(ss);
      }

      await snapshot.revert(ss);
    })

    it("stake lock: stack", async() => {
      const ss = await snapshot.take();
      await inst.coin[0].mint(accounts[0], decShift(100, 18))
      await inst.proxy.deposit(inst.coin[0].address, decShift(10, 18))

      await time.increase(10*60*60);
      await expectRevert(inst.proxy.withdraw(inst.coin[0].address, 1, []), 'locked', 'withdraw: locked')

      await inst.proxy.deposit(inst.coin[0].address, decShift(2, 18))

      await time.increase(14*60*60*10/(10+2) + 24*60*60*2/(10+2) - TIME_TOLLERANCE);
      await expectRevert(inst.proxy.withdraw(inst.coin[0].address, 1, []), 'locked', 'withdraw: locked 2')
      await time.increase(TIME_TOLLERANCE);
      {
        const ss = await snapshot.take();
        await inst.proxy.withdraw(inst.coin[0].address, decShift(12, 18), [])
        expect(await inst.coin[0].balanceOf(accounts[0])).to.be.bignumber.equal(decShift(100, 18))
        await snapshot.revert(ss);
      }

      await snapshot.revert(ss);
    })

    it("stake lock: repeated resurrection", async() => {
      const ss = await snapshot.take();
      await inst.coin[0].mint(accounts[0], decShift(100, 18))
      await inst.proxy.deposit(inst.coin[0].address, decShift(10, 18))

      await time.increase(48*60*60);
      await inst.proxy.withdraw(inst.coin[0].address, decShift(10, 18), [])
      await expectRevert(inst.proxy.withdraw(inst.coin[0].address, 1, []), '!Stake', 'withdraw: !Stake')

      await time.increase(30*24*60*60);

      for (let i = 0; i < 5; ++i) {
        await inst.proxy.deposit(inst.coin[0].address, decShift(2, 18))
        await inst.proxy.withdraw(inst.coin[0].address, decShift(2, 18), [])
      }

      await inst.proxy.deposit(inst.coin[0].address, decShift(2, 18))
      await expectRevert(inst.proxy.withdraw(inst.coin[0].address, 1, []), 'locked', 'withdraw: locked')

      await snapshot.revert(ss);
    })
  })

  describe('farmerExec', () => {
    it('deposit', async() => {
      await inst.coin[0].mint(accounts[0], decShift(60, 18))
      await inst.proxy.deposit(inst.coin[0].address, decShift(60, 18))
    })

    it("unauthorize farmer", async() => {
      await expectRevert(inst.proxy.farmerExec(
        inst.coin[1].address,
        ...await execParams(inst.router[0], 'swapExactTokensForTokens',
          decShift(30, 18), 0,
          [ inst.coin[0].address, inst.coin[1].address ],
          accounts[0], LARGE_VALUE,
        ), { from: farmer },
      ), "unauthorized farmer")

      await expectRevert(inst.proxy.farmerProcessOutstandingToken(
        ...await execParams(inst.router[0], "swapExactTokensForTokens",
          decShift(1, 18), 0,
          [inst.coin[3].address, inst.earn.address ],
          accounts[0], LARGE_VALUE,
        ),
        Object.values(inst.coin).map(c => c.address),
        { from: farmer },
      ), "unauthorized farmer")

      await adminExec("authorizeFarmers", [ farmer + '1'.padStart(24,'0') ])

      await expectRevert(inst.proxy.farmerExec(
        inst.coin[1].address,
        ...await execParams(inst.router[0], 'swapExactTokensForTokens',
          decShift(30, 18), 0,
          [ inst.coin[0].address, inst.coin[1].address ],
          accounts[0], LARGE_VALUE,
        ),
      ), "unauthorized farmer")
    })

    it('swap', async() => {
      await expectRevert(inst.proxy.farmerExec(
        inst.coin[1].address,
        ...await execParams(inst.router[0], 'swapExactTokensForTokens',
          decShift(30, 18), 0,
          [ inst.coin[0].address, inst.coin[1].address ],
          accounts[0], LARGE_VALUE,
          ), { from: farmer },
      ), "token balance unchanged")

      await expectRevert(inst.proxy.farmerExec(
        inst.coin[0].address,
        ...await execParams(inst.router[0], 'swapExactTokensForTokens',
          decShift(30, 18), 0,
          [ inst.coin[0].address, inst.coin[1].address ],
          inst.proxy.address, LARGE_VALUE,
          ), { from: farmer },
      ), "token balance unchanged")
  
      await inst.proxy.farmerExec(
        inst.coin[1].address,
        ...await execParams(inst.router[0], 'swapExactTokensForTokens',
          decShift(30, 18), 0,
          [ inst.coin[0].address, inst.coin[1].address ],
          inst.proxy.address, LARGE_VALUE,
          ), { from: farmer },
      )
    })

    it('addLiquidity and stealing', async() => {
      const balance0 = await inst.coin[0].balanceOf(inst.proxy.address)
      const balance1 = await inst.coin[1].balanceOf(inst.proxy.address)

      await expectRevert(inst.proxy.farmerExec(
        inst.pair[0][1].address,
        ...await execParams(inst.router[0], 'addLiquidity',
          inst.coin[0].address, inst.coin[1].address,
          balance0, balance1,
          0, 0,
          accounts[3], LARGE_VALUE,
          ), { from: farmer },
      ), "token balance unchanged")
    })

    it('addLiquidity', async() => {
      const balance0 = await inst.coin[0].balanceOf(inst.proxy.address)
      const balance1 = await inst.coin[1].balanceOf(inst.proxy.address)

      await inst.proxy.farmerExec(
        inst.pair[0][1].address,
        ...await execParams(inst.router[0], 'addLiquidity',
          inst.coin[0].address, inst.coin[1].address,
          balance0, balance1,
          0, 0,
          inst.proxy.address, LARGE_VALUE,
          ), { from: farmer },
      )
    })

    it("authorize router as ownership preserved", async() => {
      const ss = await snapshot.take()

      const liquidity = await inst.pair[0][1].balanceOf(inst.proxy.address)

      await expectRevert(inst.proxy.farmerExec(
        ZERO_ADDRESS,
        ...await execParams(inst.router[0], 'removeLiquidity',
          inst.coin[0].address, inst.coin[1].address,
          liquidity,
          0, 0,
          inst.proxy.address, LARGE_VALUE,
        ), { from: farmer },
      ), "not authorized as ownership preserved")

      // authorize the router to farmerExec without balance verification
      await adminExec("authorizeRouters", [ inst.router[0].address + routerMask(ROUTER_FARM_TOKEN | ROUTER_OWNERSHIP_PRESERVED) ])

      await inst.proxy.farmerExec(
        ZERO_ADDRESS,
        ...await execParams(inst.router[0], 'removeLiquidity',
          inst.coin[0].address, inst.coin[1].address,
          liquidity,
          0, 0,
          inst.proxy.address, LARGE_VALUE,
        ), { from: farmer },
      )

      await snapshot.revert(ss)
    })

    it('removeLiquidity and stealing', async() => {
      const liquidity = await inst.pair[0][1].balanceOf(inst.proxy.address)
      await expectRevert(inst.proxy.farmerExec(
        inst.coin[0].address,
        ...await execParams(inst.router[0], 'removeLiquidity',
          inst.coin[0].address, inst.coin[1].address,
          liquidity,
          0, 0,
          accounts[1], LARGE_VALUE,
        ), { from: farmer },
      ), "token balance unchanged")
    })

    it('removeLiquidity more than owned', async() => {
      const liquidity = await inst.pair[0][1].balanceOf(inst.proxy.address)
      await expectRevert(inst.proxy.farmerExec(
        inst.coin[0].address,
        ...await execParams(inst.router[0], 'removeLiquidity',
          inst.coin[0].address, inst.coin[1].address,
          liquidity.add(bn(1)),
          0, 0,
          inst.proxy.address, LARGE_VALUE,
        ), { from: farmer },
      ), "ds-math-sub-underflow")
    })

    it('removeLiquidity', async() => {
      const liquidity = await inst.pair[0][1].balanceOf(inst.proxy.address)
      await inst.proxy.farmerExec(
        inst.coin[0].address,
        ...await execParams(inst.router[0], 'removeLiquidity',
          inst.coin[0].address, inst.coin[1].address,
          liquidity,
          0, 0,
          inst.proxy.address, LARGE_VALUE,
        ), { from: farmer },
      )
    })

    // TODO: add pancake farming service

    // stake the LP
  })

  describe('withdraw', () => {
    let r3, r4, b3, b4

    it('setup liquidity', async() => {
      r3 = await inst.coin[3].balanceOf(inst.pair[3][4].address)
      r4 = await inst.coin[4].balanceOf(inst.pair[3][4].address)
      b3 = r3.div(bn(10))
      b4 = r4.div(bn(10))

      await inst.coin[3].mint(accounts[3], b3)
      await inst.proxy.deposit(inst.coin[3].address, b3, { from: accounts[3] })
      await inst.coin[4].mint(accounts[4], b4)
      await inst.proxy.deposit(inst.coin[4].address, b4, { from: accounts[4] })

      await time.increase(48*60*60);

      await inst.proxy.farmerExec(
        inst.pair[3][4].address,
        ...await execParams(inst.router[0], 'addLiquidity',
          inst.coin[3].address, inst.coin[4].address,
          b3, b4,
          0, 0,
          inst.proxy.address, LARGE_VALUE
        ), { from: farmer },
      )

      await expectRevert(inst.proxy.withdraw(inst.coin[3].address, 1, [], { from: accounts[3] }), "transfer amount exceeds balance")
    })

    it("add some coin buffer", async() => {
      await inst.coin[3].mint(accounts[0], b3.div(bn(100)))
      await inst.proxy.deposit(inst.coin[3].address, b3.div(bn(100)))
      await inst.coin[4].mint(accounts[0], b4.div(bn(100)))
      await inst.proxy.deposit(inst.coin[4].address, b4.div(bn(100)))
    })

    it("unauthorize router.function", async() => {
      const liquidity = await inst.pair[3][4].balanceOf(inst.proxy.address)
      await expectRevert(inst.proxy.withdraw(inst.coin[3].address, b3, [
          {
            receivingToken: inst.coin[3].address,
            execs: [
              await execParam(inst.router[0], "removeLiquidity",
                inst.coin[3].address, inst.coin[4].address,
                liquidity,
                0, 0,
                inst.proxy.address, LARGE_VALUE
              ),
            ],
          },
        ], { from: accounts[3] },
      ), "unauthorized router.function")

      // authorize inst.router[0].removeLiquidity
      await adminExec("authorizeWithdrawalFuncs",
        inst.router.map(r => r.address + 'baa2abde' + routerWithdrawalMask(ROUTER_FARM_TOKEN)),
      )

      await adminExec("authorizeWithdrawalFuncs",
        inst.router.map(r => r.address + 'baa2abde' + routerWithdrawalMask(ROUTER_NONE)),
      )

      await expectRevert(inst.proxy.withdraw(inst.coin[3].address, b3, [
          {
            receivingToken: inst.coin[3].address,
            execs: [
              await execParam(inst.router[0], "removeLiquidity",
                inst.coin[3].address, inst.coin[4].address,
                liquidity,
                0, 0,
                inst.proxy.address, LARGE_VALUE
              ),
            ],
          },
        ], { from: accounts[3] },
      ), "unauthorized router.function")

      // authorize inst.router[0].removeLiquidity again
      await adminExec("authorizeWithdrawalFuncs",
        inst.router.map(r => r.address + 'baa2abde' + routerWithdrawalMask(ROUTER_FARM_TOKEN)),
      )
    })

    it("unauthorize router.function as ownership preserved", async() => {
      const ss = await snapshot.take()

      const liquidity = await inst.pair[3][4].balanceOf(inst.proxy.address)
      await expectRevert(inst.proxy.withdraw(inst.coin[3].address, b3, [
          {
            receivingToken: ZERO_ADDRESS,
            execs: [
              await execParam(inst.router[0], "removeLiquidity",
                inst.coin[3].address, inst.coin[4].address,
                liquidity,
                0, 0,
                inst.proxy.address, LARGE_VALUE
              ),
            ],
          },
        ], { from: accounts[3] },
      ), "router not authorized as ownership preserved")

      // authorize inst.router[0].removeLiquidity as ownership preserved
      await adminExec("authorizeWithdrawalFuncs",
        [ inst.router[0].address + 'baa2abde' + routerWithdrawalMask(ROUTER_FARM_TOKEN | ROUTER_OWNERSHIP_PRESERVED) ],
      )

      await inst.proxy.withdraw(inst.coin[3].address, b3, [
          {
            receivingToken: ZERO_ADDRESS,
            execs: [
              await execParam(inst.router[0], "removeLiquidity",
                inst.coin[3].address, inst.coin[4].address,
                liquidity,
                0, 0,
                inst.proxy.address, LARGE_VALUE
              ),
            ],
          },
        ], { from: accounts[3] },
      )

      await snapshot.revert(ss)
    })

    it('single removeLiquidity', async() => {
      const liquidity = await inst.pair[3][4].balanceOf(inst.proxy.address)

      const ss = await snapshot.take()
      await inst.proxy.withdraw(inst.coin[3].address, b3, [
          {
            receivingToken: inst.coin[3].address,
            execs: [
              await execParam(inst.router[0], "removeLiquidity",
                inst.coin[3].address, inst.coin[4].address,
                liquidity,
                0, 0,
                inst.proxy.address, LARGE_VALUE
              ),
            ],
          },
        ], { from: accounts[3] },
      )

      await inst.proxy.withdraw(inst.coin[4].address, b4, [], { from: accounts[4] })
      await snapshot.revert(ss)
    })

    it('double removeLiquidity', async() => {
      const liquidity = await inst.pair[3][4].balanceOf(inst.proxy.address)
      const firstLiquidity = liquidity.div(bn(3))
      const nextLiquidity = liquidity.sub(firstLiquidity)

      await inst.proxy.withdraw(inst.coin[3].address, b3, [
          {
            receivingToken: inst.coin[3].address,
            execs: [
              await execParam(inst.router[0], "removeLiquidity",
                inst.coin[3].address, inst.coin[4].address,
                firstLiquidity,
                0, 0,
                inst.proxy.address, LARGE_VALUE
              ),
              await execParam(inst.router[0], "removeLiquidity",
                inst.coin[3].address, inst.coin[4].address,
                nextLiquidity,
                0, 0,
                inst.proxy.address, LARGE_VALUE
              ),
            ],
          },
        ], { from: accounts[3] },
      )

      await inst.proxy.withdraw(inst.coin[4].address, b4, [], { from: accounts[4] })
    })
  })

  describe("outstanding token", () => {
    it("remove all liquidity", async() => {
      const N = Object.keys(inst.coin).length
      for (let i = 0; i < N-1; ++i) {
        for (let j = 1; j < i; ++j) {
          const liquidity = await inst.pair[i][j].balanceOf(inst.proxy.address)
          if (liquidity.isZero()) {
            continue
          }
          await inst.proxy.farmerExec(
            inst.coin[i].address,
            ...await execParams(inst.router[0], "removeLiquidity",
              inst.coin[i].address, inst.coin[j].address,
              liquidity,
              0, 0,
              inst.proxy.address, LARGE_VALUE,
            ), { from: farmer },
          )
        }
      }
    })

    it("authorized earn token router", async() => {
      await expectRevert(inst.proxy.farmerProcessOutstandingToken(
        ...await execParams(inst.router[0], "swapExactTokensForTokens",
          1, 0,
          [inst.coin[0].address, inst.earn.address ],
          inst.proxy.address, LARGE_VALUE,
        ),
        Object.values(inst.coin).map(c => c.address),
      ), "unauthorized")

      // authorize the router to swap to earn token
      await adminExec("authorizeRouters", inst.router.map(r => r.address + routerMask(ROUTER_EARN_TOKEN | ROUTER_FARM_TOKEN)))
    })

    // due to slippages, total balance might be != total stake
    // it("re-balance the stake", async() => {
    // })

    it("outstanding token: over processed", async() => {
      // due to slippages, total balance might be != total stake

      await expectRevert(inst.proxy.farmerProcessOutstandingToken(
        ...await execParams(inst.router[0], "swapExactTokensForTokens",
          1000, 0,
          [inst.coin[3].address, inst.earn.address ],
          inst.proxy.address, LARGE_VALUE,
        ),
        Object.values(inst.coin).map(c => c.address),
        { from: farmer },
      ), "over proccessed")
    })

    it("mint some more token for buffer", async() => {
      await inst.coin[3].mint(inst.proxy.address, decShift(1, 22));
    })

    it("stealing outstanding token", async() => {
      await expectRevert(inst.proxy.farmerProcessOutstandingToken(
        ...await execParams(inst.router[0], "swapExactTokensForTokens",
          decShift(1, 18), 0,
          [inst.coin[3].address, inst.earn.address ],
          accounts[0], LARGE_VALUE,
        ),
        Object.values(inst.coin).map(c => c.address),
        { from: farmer },
      ), "earn token balance unchanged")
    })

    it("duplicate tokens", async() => {
      const duplicatedCoinList = Object.values(inst.coin).map(c => c.address)
      duplicatedCoinList[duplicatedCoinList.length-1] = duplicatedCoinList[0]
      await expectRevert(inst.proxy.farmerProcessOutstandingToken(
        ...await execParams(inst.router[0], "swapExactTokensForTokens",
          decShift(1, 18), 0,
          [inst.coin[3].address, inst.earn.address ],
          inst.proxy.address, LARGE_VALUE,
        ),
        duplicatedCoinList,
        { from: farmer },
      ), "duplicate tokens")
    })

    it("incorrect tokens count", async() => {
      const duplicatedCoinList = Object.values(inst.coin).map(c => c.address)
      duplicatedCoinList.push(inst.earn.address)
      await expectRevert(inst.proxy.farmerProcessOutstandingToken(
        ...await execParams(inst.router[0], "swapExactTokensForTokens",
          decShift(1, 18), 0,
          [inst.coin[3].address, inst.earn.address ],
          inst.proxy.address, LARGE_VALUE,
        ),
        duplicatedCoinList,
        { from: farmer },
      ), "incorrect tokens count")
    })

    it("outstanding token", async() => {
      await inst.proxy.farmerProcessOutstandingToken(
        ...await execParams(inst.router[0], "swapExactTokensForTokens",
          decShift(1, 18), 0,
          [inst.coin[3].address, inst.earn.address ],
          inst.proxy.address, LARGE_VALUE,
        ),
        Object.values(inst.coin).map(c => c.address),
        { from: farmer },
      )
    })
  })

  describe("referral", () => {
    let ss
    it("take the snapshot", async() => {
      ss = await snapshot.take()
    })

    it("setup", async() => {
      await inst.citizen.setLzPool(inst.proxy.address)
      await inst.proxy.setReferralContract(inst.citizen.address, { from: admin })
      await adminExec("setReferralLevels", [decShift(0.05, 9), decShift(0.025, 9)], [0, 0], { from: admin })
    })

    it("harvest with no referrer", async() => {
      const ss = await snapshot.take()

      await inst.coin[0].mint(accounts[5], decShift(100, 18))
      await inst.proxy.deposit(inst.coin[0].address, decShift(100, 18), { from: accounts[5] })

      await time.increase(48*60*60)

      const tx = await inst.proxy.harvest(0, { from: accounts[5] })
      const { value, subsidy } = tx.receipt.logs.find(l => l.event === 'Harvest').args
      const both = value.add(subsidy)
      const expectedSubsidy = both.mul(bn(175)).div(bn(1000))
      expect(subsidy).is.bignumber
        .at.most(expectedSubsidy, "harvest subsidy rate at most")
        .at.least(expectedSubsidy.mul(bn(999)).div(bn(1000)), "harvest subsidy rate at least")

      await snapshot.revert(ss)
    })

    it("harvest with 1 referrer", async() => {
      const ss = await snapshot.take()

      await inst.coin[0].mint(accounts[5], decShift(100, 18))
      await inst.proxy.referAndDeposit(accounts[0], inst.coin[0].address, decShift(100, 18), { from: accounts[5] })

      await time.increase(48*60*60)

      const before = await inst.earn.balanceOf(accounts[0])

      const tx = await inst.proxy.harvest(0, { from: accounts[5] })
      const { value, subsidy } = tx.receipt.logs.find(l => l.event === 'Harvest').args
      const both = value.add(subsidy)
      const expectedSubsidy = both.mul(bn(125)).div(bn(1000))
      expect(subsidy).is.bignumber
        .at.most(expectedSubsidy, "harvest subsidy rate at most")
        .at.least(expectedSubsidy.mul(bn(999)).div(bn(1000)), "harvest subsidy rate at least")

      const expectedRef = both.div(bn(20))

      const after = await inst.earn.balanceOf(accounts[0])
      const ref = after.sub(before)
      expect(ref).is.bignumber
        .at.most(expectedRef, "harvest referral earn at most")
        .at.least(expectedRef.mul(bn(999)).div(bn(1000)), "harvest referral earn at least")

      await snapshot.revert(ss)
    })

    it("harvest with 2 referrers", async() => {
      const ss = await snapshot.take()

      await inst.coin[0].mint(accounts[5], decShift(100, 18))
      await inst.proxy.referAndDeposit(accounts[4], inst.coin[0].address, decShift(100, 18), { from: accounts[5] })
      await inst.proxy.referAndDeposit(accounts[3], ZERO_ADDRESS, 0, { from: accounts[4] })

      await time.increase(48*60*60)

      const before = {
        4: await inst.earn.balanceOf(accounts[4]),
        3: await inst.earn.balanceOf(accounts[3]),
      }

      const tx = await inst.proxy.harvest(0, { from: accounts[5] })
      const { value, subsidy } = tx.receipt.logs.find(l => l.event === 'Harvest').args
      const expectedSubsidy = value.div(bn(9))
      expect(subsidy).is.bignumber
        .at.most(expectedSubsidy, "harvest subsidy rate at most")
        .at.least(expectedSubsidy.mul(bn(999)).div(bn(1000)), "harvest subsidy rate at least")

      const expectedRef = {
        4: value.div(bn(9*2)),
        3: value.div(bn(9*2*2)),
      }
  
      for (const i of [4, 3]) {
        const after = await inst.earn.balanceOf(accounts[i])
        const ref = after.sub(before[i])
        expect(ref).is.bignumber
          .at.most(expectedRef[i], `harvest referral earn ${i} at most`)
          .at.least(expectedRef[i].mul(bn(999)).div(bn(1000)), `harvest referral earn {i} at least`)
      }
  
      await snapshot.revert(ss)
    })

    it("2 referrers with stake requirement", async() => {
      const ss = await snapshot.take()

      await inst.coin[0].mint(accounts[5], decShift(100, 18))
      await inst.proxy.referAndDeposit(accounts[4], inst.coin[0].address, decShift(100, 18), { from: accounts[5] })
      await inst.proxy.referAndDeposit(accounts[3], ZERO_ADDRESS, 0, { from: accounts[4] })

      await time.increase(48*60*60)

      const before = {
        4: await inst.earn.balanceOf(accounts[4]),
        3: await inst.earn.balanceOf(accounts[3]),
      }

      const tx = await inst.proxy.harvest(0, { from: accounts[5] })
      const { value, subsidy } = tx.receipt.logs.find(l => l.event === 'Harvest').args
      const expectedSubsidy = value.div(bn(9))
      expect(subsidy).is.bignumber
        .at.most(expectedSubsidy, "harvest subsidy rate at most")
        .at.least(expectedSubsidy.mul(bn(999)).div(bn(1000)), "harvest subsidy rate at least")

      await adminExec("setReferralLevels",
        [decShift(0.05, 9), decShift(0.025, 9)],
        [decShift(1, 18), decShift(10, 18)],
        { from: admin })

      const expectedRef = {
        4: value.div(bn(9*2)),
        3: value.div(bn(9*2*2)),
      }

      for (const i of [4, 3]) {
        const after = await inst.earn.balanceOf(accounts[i])
        const ref = after.sub(before[i])
        expect(ref).is.bignumber
          .at.most(expectedRef[i], `harvest referral earn ${i} at most`)
          .at.least(expectedRef[i].mul(bn(999)).div(bn(1000)), `harvest referral earn ${i} at least`)
      }

      await snapshot.revert(ss)
    })

    it("2 referrers with not enough stake requirement", async() => {
      const ss = await snapshot.take()

      await adminExec("setReferralLevels",
        [decShift(0.05, 9), decShift(0.025, 9)],
        [decShift(1, 18), decShift(10, 18)],
        { from: admin })

      await inst.coin[1].mint(accounts[3], decShift(20, 18))
      // TODO: move this "too many unharvested" test out
      await expectRevert(inst.proxy.deposit(inst.coin[1].address, decShift(20, 18), { from: accounts[3] }), "too many unharvested")
      await inst.proxy.harvest(0, { from: accounts[3] })
      await inst.proxy.deposit(inst.coin[1].address, decShift(20, 18), { from: accounts[3] })
  
      await inst.coin[0].mint(accounts[5], decShift(100, 18))
      await inst.proxy.referAndDeposit(accounts[4], inst.coin[0].address, decShift(100, 18), { from: accounts[5] })
      await inst.proxy.referAndDeposit(accounts[3], ZERO_ADDRESS, 0, { from: accounts[4] })

      await time.increase(48*60*60)

      const before = {
        4: await inst.earn.balanceOf(accounts[4]),
        3: await inst.earn.balanceOf(accounts[3]),
      }

      const tx = await inst.proxy.harvest(0, { from: accounts[5] })
      const { value, subsidy } = tx.receipt.logs.find(l => l.event === 'Harvest').args
      const both = value.add(subsidy)
      const expectedSubsidy = both.mul(bn(150)).div(bn(1000))
      expect(subsidy).is.bignumber
        .at.most(expectedSubsidy, "harvest subsidy rate at most")
        .at.least(expectedSubsidy.mul(bn(999)).div(bn(1000)), "harvest subsidy rate at least")

      const expectedRef = {
        4: bn(0),
        3: both.div(bn(40)),
      }

      for (const i of [4, 3]) {
        const after = await inst.earn.balanceOf(accounts[i])
        const ref = after.sub(before[i])
        expect(ref).is.bignumber
          .at.most(expectedRef[i], `harvest referral earn ${i} at most`)
          .at.least(expectedRef[i].mul(bn(999)).div(bn(1000)), `harvest referral earn ${i} at least`)
      }
  
      await snapshot.revert(ss)
    })

    it("revert referral changes", async() => {
      await snapshot.revert(ss)
    })
  })

  describe("harvest", () => {
    it("harvest with active stake", async() => {
      const ss = await snapshot.take()

      await inst.coin[0].mint(accounts[5], decShift(100, 18))
      await inst.proxy.deposit(inst.coin[0].address, decShift(100, 18), { from: accounts[5] })

      await inst.coin[1].mint(accounts[6], decShift(33, 18))
      await inst.proxy.deposit(inst.coin[1].address, decShift(33, 18), { from: accounts[6] })

      await time.increase(48*60*60)

      const tx = await inst.proxy.harvest(0, { from: accounts[5] })
      const { value, subsidy } = tx.receipt.logs.find(l => l.event === 'Harvest').args
      const expectedSubsidy = value.div(bn(9))
      expect(subsidy).is.bignumber
        .at.most(expectedSubsidy, "harvest subsidy rate at most")
        .at.least(expectedSubsidy.mul(bn(999)).div(bn(1000)), "harvest subsidy rate at least")

      await time.increase(24*60*60)

      const tx1 = await inst.proxy.harvest(13456789, { from: accounts[6] })
      const { value: value1, subsidy: subsidy1 } = tx1.receipt.logs.find(l => l.event === 'Harvest').args
      const expectedSubsidy1 = value1.div(bn(9))
      expect(subsidy1).is.bignumber
        .at.most(expectedSubsidy1, "harvest subsidy rate 1 at most")
        .at.least(expectedSubsidy1.mul(bn(999)).div(bn(1000)), "harvest subsidy rate 1 at least")

      const expectdValue1 = value.mul(bn(66)).div(bn(100))
      expect(value1).is.bignumber
        .at.most(expectdValue1.mul(bn(102)).div(bn(100)), "harvest value by double the stake time at most")
        .at.least(expectdValue1.mul(bn(98)).div(bn(100)), "harvest value by double the stake time at least")

      await snapshot.revert(ss)
    })

    it("harvest with stake withdrawn", async() => {
      await inst.coin[0].mint(accounts[5], decShift(100, 18))
      await inst.proxy.deposit(inst.coin[0].address, decShift(100, 18), { from: accounts[5] })

      await inst.coin[1].mint(accounts[6], decShift(33, 18))
      await inst.proxy.deposit(inst.coin[1].address, decShift(33, 18), { from: accounts[6] })

      await time.increase(48*60*60)
      await inst.proxy.withdraw(inst.coin[0].address, decShift(100, 18), [], { from: accounts[5] })
      await time.increase(24*60*60)
      await inst.proxy.withdraw(inst.coin[1].address, decShift(33, 18), [], { from: accounts[6] })

      await time.increase(13*60*60)

      // randomly deposit some more for other account
      await inst.coin[0].mint(accounts[0], decShift(13, 18))
      await inst.proxy.deposit(inst.coin[0].address, decShift(13, 18), { from: accounts[0] })

      await time.increase(60*60*60)

      const tx = await inst.proxy.harvest(0, { from: accounts[5] })
      const { value, subsidy } = tx.receipt.logs.find(l => l.event === 'Harvest').args
      const expectedSubsidy = value.div(bn(9))
      expect(subsidy).is.bignumber
        .at.most(expectedSubsidy, "harvest subsidy rate at most")
        .at.least(expectedSubsidy.mul(bn(999)).div(bn(1000)), "harvest subsidy rate at least")

      await time.increase(24*60*60)

      const tx1 = await inst.proxy.harvest(13456789, { from: accounts[6] })
      const { value: value1, subsidy: subsidy1 } = tx1.receipt.logs.find(l => l.event === 'Harvest').args
      const expectedSubsidy1 = value1.div(bn(9))
      expect(subsidy1).is.bignumber
        .at.most(expectedSubsidy1, "harvest subsidy rate 1 at most")
        .at.least(expectedSubsidy1.mul(bn(999)).div(bn(1000)), "harvest subsidy rate 1 at least")

      const expectdValue1 = value.mul(bn(66)).div(bn(100))
      expect(value1).is.bignumber
        .at.most(expectdValue1.mul(bn(102)).div(bn(100)), "harvest value by double the stake time at most")
        .at.least(expectdValue1.mul(bn(98)).div(bn(100)), "harvest value by double the stake time at least")
    })
  })

  async function adminExec(func, ...args) {
    await expectRevert(inst.proxy[func](...args), "!timelock")
    const params = await timelockParams(func, ...args)
    await expectRevert(inst.proxy.queueTransaction(...params), "!admin")
    await inst.proxy.queueTransaction(...params, { from: admin })
    await expectRevert(inst.proxy.executeTransaction(...params, { from: admin }), "hasn't surpassed time lock")
    await time.increase(7*24*60*60 + TIME_TOLLERANCE)
    await expectRevert(inst.proxy.executeTransaction(...params), "!admin")
    return inst.proxy.executeTransaction(...params, { from: admin })
  }
})

async function execParams(router, func, ...args) {
  const { data } = await router[func].request(...args)
  return [ router.address, data ]
}

async function execParam(router, func, ...args) {
  const { data } = await router[func].request(...args)
  return {
    router: router.address,
    input: data,
  }
}

async function timelockParams(func, ...args) {
  const { data } = await inst.proxy[func].request(...args)
  const eta = parseInt(await time.latest()) + 7*24*60*60 + TIME_TOLLERANCE
  return [ inst.proxy.address, 0, "", data, eta ]
}

function routerMask(mask) {
  return mask.toString().padStart(24, '0')
}

function routerWithdrawalMask(mask) {
  return mask.toString().padStart(16, '0')
}

function parseLogs(receipt, contract) {
  return receipt.parsedLogs = receipt.rawLogs.map(rawLog => {
    try {
      return (contract || CONTRACT).interface.parseLog(rawLog)
    } catch (error) {
      console.error(err)
    }
  }).filter(log => !!log)
}
