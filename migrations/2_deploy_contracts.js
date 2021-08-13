const dotenv = require('dotenv')
dotenv.config()
const { decShift } = require('../tools/lib/big');

// const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

module.exports = async function(deployer, network, accounts) {
    dotenv.config({ path: `.env.${network}` })
    if (network === 'local') {
        return
    }
    if (!process.env.EARN_TOKEN) {
        throw "missing env: EARN_TOKEN"
    }

    const admin = accounts[0]

    const arts = {}
    const inst = {}

    const contracts = [
        { name: 'Proxy', ctorParams: [admin, process.env.EARN_TOKEN] },
        { name: 'Token' },
        { name: 'Timelock' },
        { name: 'Role' },
        { name: 'Bank' },
    ]

    await Promise.all(
        contracts.map(async contract => {
            const { name } = contract
            arts[name] = artifacts.require(name)
            if (process.env[name]) {
                inst[name] = await arts[name].at(process.env[name])
            } else {
                const ctorParams = contract.ctorParams || []
                await deployer.deploy(arts[name], ...ctorParams)
                inst[name] = await arts[name].deployed()
            }
            return
        })
    )

    const txs = await Promise.all([
        inst.Proxy.upgradeContract(inst.Token.address, '0x'),

        inst.Timelock.setDelay.request(7*24*60*60)
            .then(({data}) => inst.Proxy.upgradeContract(inst.Timelock.address, data)),

        inst.Role.setSubsidy.request(admin, decShift(0.1, 18))
            .then(({data}) => inst.Proxy.upgradeContract(inst.Role.address, data)),

        inst.Proxy.upgradeContract(inst.Bank.address, '0x'),
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