require('@nomicfoundation/hardhat-toolbox')
require('dotenv').config()

module.exports = {
  solidity: '0.8.24',
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || '',
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || '',
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
    monad: {
      url: process.env.MONAD_TESTNET_RPC_URL || '',
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
}
