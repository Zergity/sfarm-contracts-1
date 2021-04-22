const SFarm = artifacts.require('./SFarm.sol');

let BASE_TOKEN = '0xe9e7cea3dedca5984780bafc599bd69add087d56' // BUSD
let EARN_TOKEN = '0x1c213179c2c08906fb759878860652a61727ed14' // ZD

module.exports = async function(deployer) {
    await deployer.deploy(SFarm, BASE_TOKEN, EARN_TOKEN)
}