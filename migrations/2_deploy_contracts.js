require('dotenv').config() 
const SFarm = artifacts.require('./SFarm.sol');
const { decShift } = require('../tools/lib/big');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

module.exports = async function(deployer) {
    if (deployer.network === 'local') {
        return
    }
    if (!process.env.EARN_TOKEN) {
        throw "missing env: EARN_TOKEN"
    }
    await deployer.deploy(SFarm, process.env.EARN_TOKEN, ZERO_ADDRESS, decShift(0.1, 18), 7*24*60*60)
}