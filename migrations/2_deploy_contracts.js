require('dotenv').config() 
const { ethers } = require('ethers');
const { decShift } = require('../tools/lib/big');

// const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

module.exports = async function(deployer, network, accounts) {
    console.error({deployer})
    if (network === 'local') {
        return
    }
    if (!process.env.EARN_TOKEN) {
        throw "missing env: EARN_TOKEN"
    }

    const admin = accounts[0]

    const Proxy = artifacts.require('./Proxy.sol');
    await deployer.deploy(Proxy, admin)
    const proxy = await Proxy.deployed()

    const Timelock = artifacts.require('./Timelock.sol')
    const Token = artifacts.require('./Token.sol');
    const SFarm = artifacts.require('./SFarm.sol');

    const txs = await Promise.all([
        Timelock.at(proxy.address)
            .then(inst => inst.setDelay.request(7*24*60*60))
            .then(({data}) => proxy.upgradeContract(Timelock.bytecode, 0, data)),

        proxy.upgradeContract(Token.bytecode, 0, '0x'),

        SFarm.at(proxy.address)
            .then(inst => inst.initialize.request(process.env.EARN_TOKEN, admin, decShift(0.1, 18)))
            .then(({data}) => proxy.upgradeContract(SFarm.bytecode, 2, data))
    ])

    // test upgrade
    // txs.push(
    //     await SFarm.at(proxy.address)
    //         .then(inst => inst.initialize.request(process.env.EARN_TOKEN, admin, decShift(0.1, 18)))
    //         .then(({data}) => proxy.upgradeContract(SFarm.bytecode, 1, data))
    // )

    txs.map(tx => {
        const { logs, rawLogs, logsBloom, ...receipt } = tx.receipt
        console.log('==============================================')
        console.log('receipt:', receipt)
        console.log('logs:', logs.map(log => {
            Object.keys(log).forEach(key => {
                if (receipt.hasOwnProperty(key)) {
                    delete log[key]
                }
            })
            return log
        }))
    })
}