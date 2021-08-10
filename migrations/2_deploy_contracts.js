require('dotenv').config() 
const { ethers } = require('ethers');
const { decShift } = require('../tools/lib/big');

// const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

module.exports = async function(deployer, network, accounts) {
    if (network === 'local') {
        return
    }
    if (!process.env.EARN_TOKEN) {
        throw "missing env: EARN_TOKEN"
    }

    const admin = accounts[0]

    const Proxy = artifacts.require('Proxy.sol');
    const Timelock = artifacts.require('Timelock.sol')
    const Token = artifacts.require('Token.sol');
    const Role = artifacts.require('Role.sol');
    const Bank = artifacts.require('Bank.sol');

    await Promise.all([
        deployer.deploy(Proxy, admin, process.env.EARN_TOKEN),
        deployer.deploy(Token),
        deployer.deploy(Timelock),
        deployer.deploy(Role),
        deployer.deploy(Bank),
    ])

    const [ proxy, token, timelock, role, bank ] = await Promise.all([
        Proxy.deployed(),
        Token.deployed(),
        Timelock.deployed(),
        Role.deployed(),
        Bank.deployed(),
    ])

    const txs = await Promise.all([
        proxy.upgradeContract(token.address, '0x'),

        timelock.setDelay.request(7*24*60*60)
            .then(({data}) => proxy.upgradeContract(timelock.address, data)),

        role.setSubsidy.request(admin, decShift(0.1, 18))
            .then(({data}) => proxy.upgradeContract(role.address, data)),

        proxy.upgradeContract(bank.address, '0x'),
    ])

    // test upgrade
    // await deployer.deploy(SFarm)
    // const sfarm2 = await SFarm.deployed()
    // txs.push(
    //     await sfarm2.initialize.request(process.env.EARN_TOKEN, admin, decShift(0.1, 18))
    //         .then(({data}) => proxy.upgradeContract(sfarm2.address, data)),
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