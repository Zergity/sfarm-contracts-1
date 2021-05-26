require('dotenv').config() 
const { ethers } = require('ethers');
const { decShift } = require('./lib/big');

const TIME_TOLLERANCE = 2;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const LARGE_VALUE = '0x8000000000000000000000000000000000000000000000000000000000000000'

const TOKEN_LEVEL_RECEIVABLE    = '1'.padStart(24,'0');
const TOKEN_LEVEL_STAKE         = '2'.padStart(24,'0');

const ROUTER_NONE                   = 0;
const ROUTER_EARN_TOKEN             = 1 << 0;
const ROUTER_STAKE_TOKEN            = 1 << 1;
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
    inst.earn = await ERC20.at(process.env.EARN_TOKEN)
    inst.farm = await SFarm.at(process.env.FARM)

    for (const address of process.env.STAKE_TOKENS.split(' ')) {
      const coin = await ERC20.at(address)
      inst.coin.push(coin)
    }

    for (const address of process.env.ROUTERS.split(' ')) {
      const router = await ERC20.at(address)
      inst.router.push(router)
    }

    /// setup ///

    // authorize tokens for stake
    // await inst.farm.authorizeTokens(inst.coin.map(c => c.address + TOKEN_LEVEL_STAKE))

    // approve router to spent all farm's coins
    // await inst.farm.authorizeRouters(inst.router.map(r => r.address + routerMask(ROUTER_STAKE_TOKEN)))

    // set the admin account
    // const KNIGHT = '0x9F1D693102374EF349b7dD0e969c03BeB0314458'
    // await inst.farm.authorizeAdmins([
    //   KNIGHT + '1'.padStart(24, '0')
    // ])

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
