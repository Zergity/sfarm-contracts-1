const moment = require('moment');
const { expect } = require('chai');
const { ethers } = require('ethers');
const { time, expectRevert, expectEvent, BN } = require('@openzeppelin/test-helpers');
const snapshot = require('./lib/snapshot');
const utils = require('./lib/utils');
const { decShift } = require('../tools/lib/big');
require('./lib/seedrandom');

const TIME_TOLLERANCE = 2;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const LARGE_VALUE = '0x8000000000000000000000000000000000000000000000000000000000000000'

const CONFIG_0 = '0'.repeat(24)
const CONFIG_1 = '1'.padStart(24, '0')
const CONFIG_2 = '2'.padStart(24, '0')
const CONFIG_3 = '3'.padStart(24, '0')
const CONFIG_6 = '6'.padStart(24, '0')
const TOKEN_LEVEL_RECEIVABLE = CONFIG_1
const TOKEN_LEVEL_STAKE = CONFIG_2

const ERC20 = artifacts.require('ERC20PresetMinterPauser');
const SFarm = artifacts.require('SFarm');
const Factory = artifacts.require('UniswapV2Factory');
const AuthorizeRouter = artifacts.require('UniswapV2Router01');
const Pair = artifacts.require('UniswapV2Pair');

const ABIs = [ ERC20, SFarm, Factory, AuthorizeRouter, Pair ]
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
Math.seedrandom('any string you like');

contract("SFarm", accounts => {
  before('should our contracts be deployed', async () => {
    inst.base = await ERC20.new('Base USD', 'BUSD')
    expect(inst.base, 'contract not deployed: BUSD').to.not.be.null
    inst.earn = await ERC20.new('ezDeFi', 'ZD')
    expect(inst.earn, 'contract not deployed: ZD').to.not.be.null
    inst.farm = await SFarm.new(inst.base.address, inst.earn.address)
    expect(inst.farm, 'contract not deployed: SFarm').to.not.be.null
    for (let i = 0; i < accounts.length; ++i) {
      const coin = await ERC20.new('Stablecoin Number ' + i, 'USD'+i)
      inst.coin.push(coin)
    }
  });

  before('should 3rd party contracts be deployed', async () => {
    inst.weth = await ERC20.new('Wrapped ETH', 'WETH');
    const factory = await Factory.new(accounts[0]);
    inst.router[0] = await AuthorizeRouter.new(factory.address, inst.weth.address)
  });

  before("init liquidity routers", async() => {
    for (let i = 0; i < inst.coin.length-1; ++i) {
      for (let j = i+1; j < inst.coin.length; ++j) {
        const amountA = decShift(Math.random(), 24)
        const amountB = decShift(Math.random(), 24)
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
      await expectRevert(inst.farm.deposit(inst.coin[0].address, 1), 'unauthorized token')
      await inst.farm.authorizeTokens(inst.coin.map(c => c.address + TOKEN_LEVEL_STAKE))
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
      await inst.farm.authorizeTokens(pairs)
    })

    it("approve farm to spent all coins", async() => {
      await expectRevert(inst.farm.deposit(inst.coin[0].address, 1), 'transfer amount exceeds balance')
      await inst.coin[0].mint(accounts[0], 1)
      await expectRevert(inst.farm.deposit(inst.coin[0].address, 1), 'transfer amount exceeds allowance')
      await inst.coin[0].burn(1, { from: accounts[0] })
  
      for (const coin of inst.coin) {
        for (const from of accounts) {
          await coin.approve(inst.farm.address, LARGE_VALUE, { from })
        }
      }
    })

    it("approve router to spent all farm's coins", async() => {
      await expectRevert(inst.farm.approve(
        inst.coin.map(c => c.address),
        inst.router.map(r => r.address),
        LARGE_VALUE,
      ), 'unauthorized router')

      await inst.farm.authorizeRouters(inst.router.map(r => r.address + CONFIG_2))

      const coins = inst.coin.map(c => c.address)
      for (let i = 0; i < inst.coin.length-1; ++i) {
        for (let j = i+1; j < inst.coin.length; ++j) {
          coins.push(inst.pair[i][j].address)
        }
      }

      await inst.farm.approve(
        coins,
        inst.router.map(r => r.address),
        LARGE_VALUE,
      )
    })
  })

  describe('stake', () => {
    it("overlap", async() => {
      const ss = await snapshot.take();
      await inst.coin[0].mint(accounts[0], decShift(60, 18))
      await inst.farm.deposit(inst.coin[0].address, decShift(13, 18))

      await time.increase(240*60*60);
      await inst.coin[0].mint(accounts[1], decShift(100, 18))
      await inst.farm.deposit(inst.coin[0].address, decShift(87, 18), { from: accounts[1] })

      await time.increase(13*60*60);
      await inst.farm.withdraw(inst.coin[0].address, decShift(13, 18), [])
      expect(await inst.coin[0].balanceOf(accounts[0])).to.be.bignumber.equal(decShift(60, 18), "balance intact")

      await time.increase(30*60*60);
      await inst.farm.withdraw(inst.coin[0].address, decShift(87, 18), [], { from: accounts[1] })
      expect(await inst.coin[0].balanceOf(accounts[1])).to.be.bignumber.equal(decShift(100, 18), "balance intact")
      await snapshot.revert(ss);
    })

    it("stake withdraw: leave 1 wei behind", async() => {
      const ss = await snapshot.take();

      await inst.coin[0].mint(accounts[0], decShift(60, 18))
      await inst.farm.deposit(inst.coin[0].address, decShift(60, 18))

      await time.increase(48*60*60);
      await expectRevert(
        inst.farm.withdraw(inst.coin[0].address, new BN(decShift(60, 18)).sub(new BN(1)), []),
        "ds-math-sub-underflow")

      await snapshot.revert(ss);
    })

    it("stake lock: single", async() => {
      const ss = await snapshot.take();
      await inst.coin[0].mint(accounts[0], decShift(60, 18))
      await inst.farm.deposit(inst.coin[0].address, decShift(13, 18))

      await time.increase(24*60*60-TIME_TOLLERANCE);
      await expectRevert(inst.farm.withdraw(inst.coin[0].address, 1, []), 'locked', 'withdraw: locked')
      await time.increase(TIME_TOLLERANCE);
      await inst.farm.withdraw(inst.coin[0].address, decShift(13, 18), [])
      expect(await inst.coin[0].balanceOf(accounts[0])).to.be.bignumber.equal(decShift(60, 18), "balance intact")
      await snapshot.revert(ss);
    })

    it("stake lock: queue", async() => {
      const ss = await snapshot.take();
      await inst.coin[0].mint(accounts[0], decShift(100, 18))
      await inst.farm.deposit(inst.coin[0].address, decShift(10, 18))

      await time.increase(24*60*60-TIME_TOLLERANCE);
      await expectRevert(inst.farm.withdraw(inst.coin[0].address, 1, []), 'locked', 'withdraw: locked')
      await time.increase(TIME_TOLLERANCE);
      {
        const ss = await snapshot.take();
        await inst.farm.withdraw(inst.coin[0].address, decShift(10, 18), [])
        expect(await inst.coin[0].balanceOf(accounts[0])).to.be.bignumber.equal(decShift(100, 18))
        await snapshot.revert(ss);
      }

      await inst.farm.deposit(inst.coin[0].address, decShift(2, 18))

      await time.increase(24*60*60*2/(10+2)-TIME_TOLLERANCE);
      await expectRevert(inst.farm.withdraw(inst.coin[0].address, 1, []), 'locked', 'withdraw: locked 2')
      await time.increase(TIME_TOLLERANCE);
      {
        const ss = await snapshot.take();
        await inst.farm.withdraw(inst.coin[0].address, decShift(12, 18), [])
        expect(await inst.coin[0].balanceOf(accounts[0])).to.be.bignumber.equal(decShift(100, 18))
        await snapshot.revert(ss);
      }

      await snapshot.revert(ss);
    })

    it("stake lock: stack", async() => {
      const ss = await snapshot.take();
      await inst.coin[0].mint(accounts[0], decShift(100, 18))
      await inst.farm.deposit(inst.coin[0].address, decShift(10, 18))

      await time.increase(10*60*60);
      await expectRevert(inst.farm.withdraw(inst.coin[0].address, 1, []), 'locked', 'withdraw: locked')

      await inst.farm.deposit(inst.coin[0].address, decShift(2, 18))

      await time.increase(14*60*60*10/(10+2) + 24*60*60*2/(10+2) - TIME_TOLLERANCE);
      await expectRevert(inst.farm.withdraw(inst.coin[0].address, 1, []), 'locked', 'withdraw: locked 2')
      await time.increase(TIME_TOLLERANCE);
      {
        const ss = await snapshot.take();
        await inst.farm.withdraw(inst.coin[0].address, decShift(12, 18), [])
        expect(await inst.coin[0].balanceOf(accounts[0])).to.be.bignumber.equal(decShift(100, 18))
        await snapshot.revert(ss);
      }

      await snapshot.revert(ss);
    })

    it("stake lock: repeated resurrection", async() => {
      const ss = await snapshot.take();
      await inst.coin[0].mint(accounts[0], decShift(100, 18))
      await inst.farm.deposit(inst.coin[0].address, decShift(10, 18))

      await time.increase(48*60*60);
      await inst.farm.withdraw(inst.coin[0].address, decShift(10, 18), [])
      await expectRevert(inst.farm.withdraw(inst.coin[0].address, 1, []), '!Stake', 'withdraw: !Stake')

      await time.increase(30*24*60*60);

      for (let i = 0; i < 5; ++i) {
        await inst.farm.deposit(inst.coin[0].address, decShift(2, 18))
        await inst.farm.withdraw(inst.coin[0].address, decShift(2, 18), [])
      }

      await inst.farm.deposit(inst.coin[0].address, decShift(2, 18))
      await expectRevert(inst.farm.withdraw(inst.coin[0].address, 1, []), 'locked', 'withdraw: locked')

      await snapshot.revert(ss);
    })
  })

  describe('farmExec', () => {
    it('deposit', async() => {
      await inst.coin[0].mint(accounts[0], decShift(60, 18))
      await inst.farm.deposit(inst.coin[0].address, decShift(60, 18))
    })

    it('swap', async() => {
      await expectRevert(inst.farm.farmExec(
        inst.coin[1].address,
        ...await execParams(inst.router[0], 'swapExactTokensForTokens',
          decShift(30, 18), 0,
          [ inst.coin[0].address, inst.coin[1].address ],
          accounts[0], LARGE_VALUE,
        ),
      ), "token balance unchanged")

      await expectRevert(inst.farm.farmExec(
        inst.coin[0].address,
        ...await execParams(inst.router[0], 'swapExactTokensForTokens',
          decShift(30, 18), 0,
          [ inst.coin[0].address, inst.coin[1].address ],
          inst.farm.address, LARGE_VALUE,
        ),
      ), "token balance unchanged")
  
      await inst.farm.farmExec(
        inst.coin[1].address,
        ...await execParams(inst.router[0], 'swapExactTokensForTokens',
          decShift(30, 18), 0,
          [ inst.coin[0].address, inst.coin[1].address ],
          inst.farm.address, LARGE_VALUE,
        ),
      )
    })

    it('addLiquidity and stealing', async() => {
      const balance0 = await inst.coin[0].balanceOf(inst.farm.address)
      const balance1 = await inst.coin[1].balanceOf(inst.farm.address)

      await expectRevert(inst.farm.farmExec(
        inst.pair[0][1].address,
        ...await execParams(inst.router[0], 'addLiquidity',
          inst.coin[0].address, inst.coin[1].address,
          balance0, balance1,
          0, 0,
          accounts[3], LARGE_VALUE,
        ),
      ), "token balance unchanged")
    })

    it('addLiquidity', async() => {
      const balance0 = await inst.coin[0].balanceOf(inst.farm.address)
      const balance1 = await inst.coin[1].balanceOf(inst.farm.address)

      await inst.farm.farmExec(
        inst.pair[0][1].address,
        ...await execParams(inst.router[0], 'addLiquidity',
          inst.coin[0].address, inst.coin[1].address,
          balance0, balance1,
          0, 0,
          inst.farm.address, LARGE_VALUE,
        ),
      )
    })

    it("authorize router as ownership preserved", async() => {
      const ss = await snapshot.take()

      const liquidity = await inst.pair[0][1].balanceOf(inst.farm.address)

      await expectRevert(inst.farm.farmExec(
        ZERO_ADDRESS,
        ...await execParams(inst.router[0], 'removeLiquidity',
          inst.coin[0].address, inst.coin[1].address,
          liquidity,
          0, 0,
          inst.farm.address, LARGE_VALUE,
        ),
      ), "not authorized as ownership preserved")

      // authorize the router to farmExec without balance verification
      await inst.farm.authorizeRouters([ inst.router[0].address + CONFIG_6 ])

      await inst.farm.farmExec(
        ZERO_ADDRESS,
        ...await execParams(inst.router[0], 'removeLiquidity',
          inst.coin[0].address, inst.coin[1].address,
          liquidity,
          0, 0,
          inst.farm.address, LARGE_VALUE,
        ),
      )

      await snapshot.revert(ss)
    })

    it('removeLiquidity and stealing', async() => {
      const liquidity = await inst.pair[0][1].balanceOf(inst.farm.address)
      await expectRevert(inst.farm.farmExec(
        inst.coin[0].address,
        ...await execParams(inst.router[0], 'removeLiquidity',
          inst.coin[0].address, inst.coin[1].address,
          liquidity,
          0, 0,
          accounts[1], LARGE_VALUE,
        ),
      ), "token balance unchanged")
    })

    it('removeLiquidity more than owned', async() => {
      const liquidity = await inst.pair[0][1].balanceOf(inst.farm.address)
      await expectRevert(inst.farm.farmExec(
        inst.coin[0].address,
        ...await execParams(inst.router[0], 'removeLiquidity',
          inst.coin[0].address, inst.coin[1].address,
          liquidity.add(new BN(1)),
          0, 0,
          inst.farm.address, LARGE_VALUE,
        ),
      ), "ds-math-sub-underflow")
    })

    it('removeLiquidity', async() => {
      const liquidity = await inst.pair[0][1].balanceOf(inst.farm.address)
      await inst.farm.farmExec(
        inst.coin[0].address,
        ...await execParams(inst.router[0], 'removeLiquidity',
          inst.coin[0].address, inst.coin[1].address,
          liquidity,
          0, 0,
          inst.farm.address, LARGE_VALUE,
        ),
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
      b3 = r3.div(new BN(10))
      b4 = r4.div(new BN(10))

      await inst.coin[3].mint(accounts[3], b3)
      await inst.farm.deposit(inst.coin[3].address, b3, { from: accounts[3] })
      await inst.coin[4].mint(accounts[4], b4)
      await inst.farm.deposit(inst.coin[4].address, b4, { from: accounts[4] })

      await time.increase(48*60*60);

      await inst.farm.farmExec(
        inst.pair[3][4].address,
        ...await execParams(inst.router[0], 'addLiquidity',
          inst.coin[3].address, inst.coin[4].address,
          b3, b4,
          0, 0,
          inst.farm.address, LARGE_VALUE
        )
      )

      await expectRevert(inst.farm.withdraw(inst.coin[3].address, 1, [], { from: accounts[3] }), "transfer amount exceeds balance")
    })

    it("add some coin buffer", async() => {
      await inst.coin[3].mint(accounts[0], b3.div(new BN(100)))
      await inst.farm.deposit(inst.coin[3].address, b3.div(new BN(100)))
      await inst.coin[4].mint(accounts[0], b4.div(new BN(100)))
      await inst.farm.deposit(inst.coin[4].address, b4.div(new BN(100)))
    })

    it("unauthorize router.function", async() => {
      const liquidity = await inst.pair[3][4].balanceOf(inst.farm.address)
      await expectRevert(inst.farm.withdraw(inst.coin[3].address, b3, [
          {
            receivingToken: inst.coin[3].address,
            execs: [
              await execParam(inst.router[0], "removeLiquidity",
                inst.coin[3].address, inst.coin[4].address,
                liquidity,
                0, 0,
                inst.farm.address, LARGE_VALUE
              ),
            ],
          },
        ], { from: accounts[3] },
      ), "unauthorized router.function")

      // authorize inst.router[0].removeLiquidity
      await inst.farm.authorizeWithdrawalFuncs(
        inst.router.map(r => r.address + 'baa2abde' + '2'.padStart(16,'0'))
      )

      await inst.farm.authorizeWithdrawalFuncs(
        inst.router.map(r => r.address + 'baa2abde' + '0'.padStart(16,'0'))
      )

      await expectRevert(inst.farm.withdraw(inst.coin[3].address, b3, [
          {
            receivingToken: inst.coin[3].address,
            execs: [
              await execParam(inst.router[0], "removeLiquidity",
                inst.coin[3].address, inst.coin[4].address,
                liquidity,
                0, 0,
                inst.farm.address, LARGE_VALUE
              ),
            ],
          },
        ], { from: accounts[3] },
      ), "unauthorized router.function")

      // authorize inst.router[0].removeLiquidity again
      await inst.farm.authorizeWithdrawalFuncs(
        inst.router.map(r => r.address + 'baa2abde' + '2'.padStart(16,'0'))
      )
    })

    it("unauthorize router.function as ownership preserved", async() => {
      const ss = await snapshot.take()

      const liquidity = await inst.pair[3][4].balanceOf(inst.farm.address)
      await expectRevert(inst.farm.withdraw(inst.coin[3].address, b3, [
          {
            receivingToken: ZERO_ADDRESS,
            execs: [
              await execParam(inst.router[0], "removeLiquidity",
                inst.coin[3].address, inst.coin[4].address,
                liquidity,
                0, 0,
                inst.farm.address, LARGE_VALUE
              ),
            ],
          },
        ], { from: accounts[3] },
      ), "router not authorized as ownership preserved")

      // authorize inst.router[0].removeLiquidity as ownership preserved
      await inst.farm.authorizeWithdrawalFuncs(
        [ inst.router[0].address + 'baa2abde' + '6'.padStart(16,'0') ]
      )

      await inst.farm.withdraw(inst.coin[3].address, b3, [
          {
            receivingToken: ZERO_ADDRESS,
            execs: [
              await execParam(inst.router[0], "removeLiquidity",
                inst.coin[3].address, inst.coin[4].address,
                liquidity,
                0, 0,
                inst.farm.address, LARGE_VALUE
              ),
            ],
          },
        ], { from: accounts[3] },
      )

      await snapshot.revert(ss)
    })

    it('single removeLiquidity', async() => {
      const liquidity = await inst.pair[3][4].balanceOf(inst.farm.address)

      const ss = await snapshot.take()
      await inst.farm.withdraw(inst.coin[3].address, b3, [
          {
            receivingToken: inst.coin[3].address,
            execs: [
              await execParam(inst.router[0], "removeLiquidity",
                inst.coin[3].address, inst.coin[4].address,
                liquidity,
                0, 0,
                inst.farm.address, LARGE_VALUE
              ),
            ],
          },
        ], { from: accounts[3] },
      )

      await inst.farm.withdraw(inst.coin[4].address, b4, [], { from: accounts[4] })
      await snapshot.revert(ss)
    })

    it('double removeLiquidity', async() => {
      const liquidity = await inst.pair[3][4].balanceOf(inst.farm.address)
      const firstLiquidity = liquidity.div(new BN(3))
      const nextLiquidity = liquidity.sub(firstLiquidity)

      await inst.farm.withdraw(inst.coin[3].address, b3, [
          {
            receivingToken: inst.coin[3].address,
            execs: [
              await execParam(inst.router[0], "removeLiquidity",
                inst.coin[3].address, inst.coin[4].address,
                firstLiquidity,
                0, 0,
                inst.farm.address, LARGE_VALUE
              ),
              await execParam(inst.router[0], "removeLiquidity",
                inst.coin[3].address, inst.coin[4].address,
                nextLiquidity,
                0, 0,
                inst.farm.address, LARGE_VALUE
              ),
            ],
          },
        ], { from: accounts[3] },
      )

      await inst.farm.withdraw(inst.coin[4].address, b4, [], { from: accounts[4] })
    })
  })

  describe("outstanding token", () => {
    it("remove all liquidity", async() => {
      const N = Object.keys(inst.coin).length
      for (let i = 0; i < N-1; ++i) {
        for (let j = 1; j < i; ++j) {
          const liquidity = await inst.pair[i][j].balanceOf(inst.farm.address)
          if (liquidity.isZero()) {
            continue
          }
          await inst.farm.farmExec(
            inst.coin[i].address,
            ...await execParams(inst.router[0], "removeLiquidity",
              inst.coin[i].address, inst.coin[j].address,
              liquidity,
              0, 0,
              inst.farm.address, LARGE_VALUE,
            ),
          )
        }
      }
    })

    it("authorized earn token router", async() => {
      await expectRevert(inst.farm.processOutstandingToken(
        ...await execParams(inst.router[0], "swapExactTokensForTokens",
          1, 0,
          [inst.coin[0].address, inst.earn.address ],
          inst.farm.address, LARGE_VALUE,
        ),
        Object.values(inst.coin).map(c => c.address),
      ), "unauthorized")

      // authorize the router to swap to earn token
      await inst.farm.authorizeRouters(inst.router.map(r => r.address + CONFIG_3))
    })

    // due to slippages, total balance might be != total stake
    // it("re-balance the stake", async() => {
    // })

    it("outstanding token: over processed", async() => {
      // due to slippages, total balance might be != total stake

      await expectRevert(inst.farm.processOutstandingToken(
        ...await execParams(inst.router[0], "swapExactTokensForTokens",
          1000, 0,
          [inst.coin[3].address, inst.earn.address ],
          inst.farm.address, LARGE_VALUE,
        ),
        Object.values(inst.coin).map(c => c.address),
      ), "over proccessed")
    })

    it("mint some more token for buffer", async() => {
      await inst.coin[3].mint(inst.farm.address, decShift(1, 22));
    })

    it("stealing outstanding token", async() => {
      await expectRevert(inst.farm.processOutstandingToken(
        ...await execParams(inst.router[0], "swapExactTokensForTokens",
          decShift(1, 18), 0,
          [inst.coin[3].address, inst.earn.address ],
          accounts[0], LARGE_VALUE,
        ),
        Object.values(inst.coin).map(c => c.address),
      ), "earn token balance unchanged")
    })

    it("outstanding token", async() => {
      await inst.farm.processOutstandingToken(
        ...await execParams(inst.router[0], "swapExactTokensForTokens",
          decShift(1, 18), 0,
          [inst.coin[3].address, inst.earn.address ],
          inst.farm.address, LARGE_VALUE,
        ),
        Object.values(inst.coin).map(c => c.address),
      )
    })

  })
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

function parseLogs(receipt, contract) {
  return receipt.parsedLogs = receipt.rawLogs.map(rawLog => {
    try {
      return (contract || CONTRACT).interface.parseLog(rawLog)
    } catch (error) {
      console.error(err)
    }
  }).filter(log => !!log)
}
