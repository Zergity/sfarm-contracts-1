const SFarmingImpl = artifacts.require('./SFarmingImpl.sol');

const BASE_TOKEN = '0xe9e7cea3dedca5984780bafc599bd69add087d56' // BUSD

module.exports = async function(deployer) {
    await deployer.deploy(SFarmingImpl, BASE_TOKEN)
}