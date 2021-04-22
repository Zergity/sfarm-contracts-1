const moment = require('moment');
const { expect } = require('chai');
const { time, expectRevert, expectEvent, BN } = require('@openzeppelin/test-helpers');
const snapshot = require('./lib/snapshot');
const utils = require('./lib/utils');
const { decShift } = require('../tools/lib/big');

const ERC20 = artifacts.require("ERC20PresetMinterPauser");
const SFarm = artifacts.require("SFarm");
let inst = {};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

contract("Stake and Earn", accounts => {
  before('should our contracts be deployed', async () => {
    inst.base = await ERC20.new('Base USD', 'BUSD')
    expect(inst.base, 'contract not deployed: BUSD').to.not.be.null
    inst.earn = await ERC20.new('ezDeFi', 'ZD')
    expect(inst.earn, 'contract not deployed: ZD').to.not.be.null
    inst.farm = await SFarm.new(inst.base.address, inst.earn.address)
    expect(inst.farm, 'contract not deployed: SFarm').to.not.be.null
    inst.coin = []
    for (let i = 0; i < 5; ++i) {
      const coin = await ERC20.new('Stablecoin Number ' + i, 'USD'+i)
      inst.coin.push(coin)
    }
    await inst.farm.setTokens(inst.coin.map(c => c.address), [])
  });

  describe('stake', () => {
    it("approve farm to spent", async() => {
      for (const coin of inst.coin) {
        for (const from of accounts) {
          await coin.approve(inst.farm.address, decShift(8, 63), { from })
        }
      }
    })

    it("stake some coin", async() => {
      await inst.coin[0].mint(accounts[0], decShift(60, 18))
      await inst.farm.deposit(inst.coin[0].address, decShift(13, 18))

      await time.increase(24*60*60);
      await inst.coin[0].mint(accounts[1], decShift(100, 18))
      await inst.farm.deposit(inst.coin[0].address, decShift(87, 18), { from: accounts[1] })

      await time.increase(13*60*60);
      await inst.farm.withdraw(inst.coin[0].address, decShift(13, 18), [])
      expect(await inst.coin[0].balanceOf(accounts[0])).to.be.bignumber.equal(decShift(60, 18), "balance intact")

      await time.increase(30*60*60);
      await inst.farm.withdraw(inst.coin[0].address, decShift(87, 18), [], { from: accounts[1] })
      expect(await inst.coin[0].balanceOf(accounts[1])).to.be.bignumber.equal(decShift(100, 18), "balance intact")
    })
  })
})
