# Wallet Expo Frontend (Independent Wallet)

Client-side, non-custodial wallet MVP built with React, ethers.js, and Wagmi.

## Features

- Create wallet using mnemonic (BIP-39 through ethers)
- Import wallet by seed phrase or private key
- Encrypt wallet with password before saving to localStorage
- Unlock wallet in-browser using password
- Show wallet address and ETH balance via direct RPC
- Build, sign, and send raw ETH transactions without MetaMask
- Estimate gas fees before sending
- Show transaction hash and confirmation status
- Network switching: Sepolia, Base Sepolia, Monad Testnet
- Transaction history section via explorer APIs (with local fallback)

## Setup

1. Copy `.env.example` to `.env`
2. Fill RPC/API values
3. Run:

```bash
npm install
npm run dev
```

## Security Notes

- Private key is never persisted in plaintext
- Encrypted JSON wallet is stored in browser storage
- Seed phrase is only shown once during creation backup step
