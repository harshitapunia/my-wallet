import { baseSepolia, sepolia } from 'wagmi/chains'

export const CHAIN_OPTIONS = [
  {
    key: 'sepolia',
    id: sepolia.id,
    label: 'Ethereum Sepolia',
    rpcUrl: import.meta.env.VITE_SEPOLIA_RPC_URL || '',
    fallbackRpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    explorerApi: import.meta.env.VITE_SEPOLIA_EXPLORER_API || 'https://api-sepolia.etherscan.io/api',
    explorerTxBase: 'https://sepolia.etherscan.io/tx/',
    nftApi: import.meta.env.VITE_ALCHEMY_SEPOLIA_NFT_API || '',
  },
  {
    key: 'baseSepolia',
    id: baseSepolia.id,
    label: 'Base Sepolia',
    rpcUrl: import.meta.env.VITE_BASE_SEPOLIA_RPC_URL || '',
    fallbackRpcUrl: 'https://sepolia.base.org',
    explorerApi: import.meta.env.VITE_BASE_SEPOLIA_EXPLORER_API || 'https://api-sepolia.basescan.org/api',
    explorerTxBase: 'https://sepolia.basescan.org/tx/',
    nftApi: import.meta.env.VITE_ALCHEMY_BASE_SEPOLIA_NFT_API || '',
  },
  {
    key: 'monad',
    id: 10143,
    label: 'Monad Testnet',
    rpcUrl: import.meta.env.VITE_MONAD_TESTNET_RPC_URL || '',
    fallbackRpcUrl: 'https://testnet-rpc.monad.xyz',
    explorerApi: import.meta.env.VITE_MONAD_EXPLORER_API || '',
    explorerTxBase: import.meta.env.VITE_MONAD_EXPLORER_TX_BASE || 'https://testnet.monadexplorer.com/tx/',
    nftApi: import.meta.env.VITE_MONAD_NFT_API || '',
  },
]

const monadChain = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'MON',
    symbol: 'MON',
  },
  rpcUrls: {
    default: {
      http: [CHAIN_OPTIONS.find((item) => item.key === 'monad')?.rpcUrl || 'https://testnet-rpc.monad.xyz'],
    },
    public: {
      http: [CHAIN_OPTIONS.find((item) => item.key === 'monad')?.fallbackRpcUrl || 'https://testnet-rpc.monad.xyz'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Monad Explorer',
      url: 'https://testnet.monadexplorer.com',
    },
  },
}

export const WAGMI_CHAINS = [sepolia, baseSepolia, monadChain]

export const EXPLORER_APIS = CHAIN_OPTIONS.reduce((acc, chain) => {
  acc[chain.key] = chain.explorerApi
  return acc
}, {})

export const EXPLORER_TX_BASE = CHAIN_OPTIONS.reduce((acc, chain) => {
  acc[chain.key] = chain.explorerTxBase
  return acc
}, {})
