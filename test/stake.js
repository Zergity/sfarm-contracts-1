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

const ERC20 = artifacts.require('ERC20PresetMinterPauser');
const SFarm = artifacts.require('SFarm');
const Factory = artifacts.require('UniswapV2Factory');
const Router = artifacts.require('UniswapV2Router01');
const Pair = artifacts.require('UniswapV2Pair');

const ABIs = [ ERC20, SFarm, Factory, Router, Pair ]
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
    inst.router[0] = await Router.new(factory.address, inst.weth.address)
  });

  before("init liquidity pools", async() => {
    for (let i = 0; i < accounts.length-1; ++i) {
      for (let j = i+1; j < accounts.length; ++j) {
        const amountA = decShift(Math.random(), 24)
        const amountB = decShift(Math.random(), 24)
        await inst.coin[i].mint(accounts[i], amountA)
        await inst.coin[j].mint(accounts[i], amountB)
        await inst.coin[i].approve(inst.router[0].address, LARGE_VALUE, { from: accounts[i] })
        await inst.coin[j].approve(inst.router[0].address, LARGE_VALUE, { from: accounts[i] })
        const r = await inst.router[0].addLiquidity(
          inst.coin[i].address, inst.coin[j].address,
          amountA, amountB,
          0, 0,
          ZERO_ADDRESS, // discard the LP token
          LARGE_VALUE,
          { from: accounts[i] },
        )
        const parsedLogs = parseLogs(r.receipt)
        const {token0, token1, pair} = parsedLogs.find(log => log.name === 'PairCreated').args
        if (!inst.pair[i]) inst.pair[i] = {}
        if (!inst.pair[j]) inst.pair[j] = {}
        inst.pair[i][j] = inst.pair[j][i] = await Pair.at(pair)
      }
    }
  })

  describe('setup', () => {
    it("setTokens", async() => {
      await expectRevert(inst.farm.deposit(inst.coin[0].address, 1), 'unauthorized token')
      await inst.farm.setTokens(inst.coin.map(c => c.address), [])
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
      ), 'unauthorized pool')
  
      await inst.farm.setPools(inst.router.map(r => r.address), [])
  
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

  describe('farm', () => {
    it('swap', async() => {
      await inst.coin[0].mint(accounts[0], decShift(60, 18))
      await inst.farm.deposit(inst.coin[0].address, decShift(13, 18))

      await farmExec(
        inst.router[0], 'swapExactTokensForTokens',
          60, 0,
          [ inst.coin[0].address, inst.coin[1].address ],
          accounts[0], LARGE_VALUE
        )
    })
  })
})

async function farmExec(router, func, ...args) {
  const request = await router[func].request(...args)
  return inst.farm.farmExec(router.address, request.data)
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
