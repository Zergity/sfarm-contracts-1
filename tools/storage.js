const { ethers } = require('ethers')
const provider = new ethers.providers.Web3Provider(web3.currentProvider);

const lockedSeconds = async (bankAddress, address) => {
  const slot = 12 // stakes
  const MAX_T = 0xFFFFFFFFFFFFFFFF
  const p = slot.toString(16).padStart(64, '0')
  const k = '0'.repeat(24) + address.substr(2)
  const position = ethers.utils.keccak256('0x' + k + p)
  // const stake = await web3.eth.getStorageAt(bankAddress, position, 'pending')
  const stake = await provider.getStorageAt(bankAddress, position)
  // const s = ethers.BigNumber.from('0x'+stake.substr(18))
  const t = parseInt(stake.substr(2, 16), 16)
  if (t >= MAX_T) { // no stake
    return 0
  }
  const timestamp = Date.now() / 1000
  if (timestamp >= t) {  // no lock
    return 0
  }
  return t - timestamp
}

async function isPaused (bankAddress) {
  const slot = 16 // refContract | _paused
  const _paused = await provider.getStorageAt(bankAddress, slot)
  return !_paused.endsWith('00')
}

async function getRefStakes(bankAddress) {
  const refStakes = await Promise.all([
    provider.getStorageAt(bankAddress, 18),
    provider.getStorageAt(bankAddress, 19),
  ])
  return refStakes.map(a => ethers.BigNumber.from(a))
}

module.exports = async function(callback) {
  const dotenv = require('dotenv')
  dotenv.config()
  dotenv.config({ path: `.env.${process.env.NODE_ENV}` })

  const address = 'put your address here'

  try {
    const locked = await lockedSeconds(process.env.Proxy, address)
    console.error(locked)
    return callback()
  } catch (err) {
    return callback(err)
  }
}
