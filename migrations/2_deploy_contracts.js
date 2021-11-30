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

    if (process.env.Citizen) {
        try {
            const proxy = await artifacts.require('Role').at(process.env.Proxy)
            const tx = await proxy.setReferralContract(process.env.Citizen)
            printTx(tx)
        } catch (err) {
            console.error(err)
        }
        return
    }

    for (const contract of contracts) {
        const { name } = contract
        arts[name] = artifacts.require(name)

        let data = '0x'

        if (process.env[name]) {
            inst[name] = await arts[name].at(process.env[name])
            if (!process.env[`${name}_need_upgrade`]) {
                continue
            }
        } else {
            const ctorParams = contract.ctorParams || []
            await deployer.deploy(arts[name], ...ctorParams)
            inst[name] = await arts[name].deployed()
        }

        if (!process.env.Proxy) {   // first time deploy
            switch(name) {
                case 'Timelock':
                    data = (await inst.Timelock.setDelay.request(7*24*60*60)).data
                    console.log(data)
                    break
                case 'Role':
                    data = (await inst.Role.setSubsidy.request(admin, decShift(0.1, 18))).data
                    break
            }
        }

        if (name == 'Proxy') {
            continue
        }

        const tx = await inst.Proxy.upgradeContract(inst[name].address, data)
        printTx(tx)
    }
}

function printTx(tx) {
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
    }
