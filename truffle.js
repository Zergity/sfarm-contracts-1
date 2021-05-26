require('dotenv').config() 
const PrivateKeyProvider = require('truffle-privatekey-provider')

module.exports = {
    networks: {
        local: {
            host: "127.0.0.1",
            port: 8545,
            network_id: "*",
        },
        ganache: {
            host: "127.0.0.1",
            port: 8545,
            network_id: "*",
            gasPrice: process.env.GAS_PRICE,
        },
        mainnet: {
            provider: () => new PrivateKeyProvider(process.env.DEPLOYER_KEY, process.env.RPC),
            network_id: process.env.NET_ID,
            gasPrice: process.env.GAS_PRICE,
            gas: 30000000,
            confirmations: 0,    // # of confs to wait between deployments. (default: 0)
            timeoutBlocks: 200,  // # of blocks before a deployment times out  (minimum/default: 50)
            skipDryRun: true,   // Skip dry run before migrations? (default: false for public nets )
        },
    },
    mocha: {
        reporter: 'eth-gas-reporter',
        reporterOptions: {
            currency: 'USD',
            showTimeSpent: true,
            onlyCalledMethods: true,
            excludeContracts: ["Migrations"],
        },
    },
    compilers: {
        solc: {
            version: '0.6.2',
            settings: {
                optimizer: {
                    enabled: true,
                    runs: 6000000,
                },
            },
        },
    },
}
