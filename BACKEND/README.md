# Wallet Expo Backend (Solidity)

This folder contains the Solidity contract and Hardhat deployment setup.

## Contract

- `contracts/WalletVault.sol`
  - Receives ETH
  - Allows owner-only ETH transfer
  - Emits transfer and deposit events
  - Exposes vault balance

## Setup

1. Copy `.env.example` to `.env`
2. Fill values:
   - `SEPOLIA_RPC_URL`
   - `DEPLOYER_PRIVATE_KEY`

## Commands

```bash
npm install
npm run compile
npm run deploy:sepolia
```

After deployment, copy the deployed contract address and share it for frontend integration.
