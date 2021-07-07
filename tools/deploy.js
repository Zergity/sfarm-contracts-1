const { ethers } = require('ethers');
const { decShift } = require('../tools/lib/big');

const TIME_TOLLERANCE = 2;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const LARGE_VALUE = '0x8000000000000000000000000000000000000000000000000000000000000000'

const TOKEN_LEVEL_RECEIVABLE    = '1'.padStart(24,'0');
const TOKEN_LEVEL_STAKE         = '2'.padStart(24,'0');

const ROUTER_NONE                   = 0;
const ROUTER_EARN_TOKEN             = 1 << 0;
const ROUTER_FARM_TOKEN             = 1 << 1;
const ROUTER_OWNERSHIP_PRESERVED    = 1 << 2;     // router that always use msg.sender as recipient

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

module.exports = async function(callback) {
  try {
    const accounts = await web3.eth.getAccounts()

    const farmer = accounts[2]
    const admin = accounts[1]

    // should our contracts be deployed
    inst.earn = await ERC20.new('ezDeFi', 'ZD')
    inst.farm = await SFarm.new(inst.base.address, inst.earn.address, admin, decShift(0.1, 18), 7*24*60*60)
    for (let i = 0; i < accounts.length; ++i) {
      const coin = await ERC20.new('Stablecoin Number ' + i, 'USD'+i)
      inst.coin.push(coin)
    }

    // should 3rd party contracts be deployed
    inst.weth = await ERC20.new('Wrapped ETH', 'WETH');
    const factory = await Factory.new(accounts[0]);
    inst.router[0] = await AuthorizeRouter.new(factory.address, inst.weth.address)

    // init liquidity routers
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

    // init liquidity routers to earn token
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

    /// setup
    // authorize tokens for stake
    await inst.farm.authorizeTokens(inst.coin.map(c => c.address + TOKEN_LEVEL_STAKE), { from: admin })

    // authorize tokens for receiving
    const pairs = []
    for(const i of Object.keys(inst.pair)) {
      for (const j of Object.keys(inst.pair[i])) {
        if (i < j) {
          pairs.push(inst.pair[i][j].address + TOKEN_LEVEL_RECEIVABLE)
        }
      }
    }
    await inst.farm.authorizeTokens(pairs, { from: admin })

    // approve farm to spent all coins
    await inst.coin[0].mint(accounts[0], 1)
    await inst.coin[0].burn(1, { from: accounts[0] })

    for (const coin of inst.coin) {
      for (const from of accounts) {
        await coin.approve(inst.farm.address, LARGE_VALUE, { from })
      }
    }

    // approve router to spent all farm's coins
    await inst.farm.authorizeRouters(inst.router.map(r => r.address + routerMask(ROUTER_FARM_TOKEN)), { from: admin })

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
      { from: admin }
    )

    console.error('base token', inst.base.address)
    console.error('earn token', inst.earn.address)
    console.error('farm', inst.farm.address)

    // mint some coins
    for (const coin of inst.coin) {
      for (const acc of accounts) {
        await coin.mint(acc, decShift(Math.random(), 24))
      }
    }

    return callback()
  }
  catch(err) {
    return callback(err)
  }
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
