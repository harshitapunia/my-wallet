import { createConfig, http } from 'wagmi'
import { CHAIN_OPTIONS, WAGMI_CHAINS } from './config/chains'

const transports = Object.fromEntries(
  CHAIN_OPTIONS.map((chain) => [chain.id, http(chain.rpcUrl || chain.fallbackRpcUrl || undefined)]),
)

export const wagmiConfig = createConfig({
  chains: WAGMI_CHAINS,
  transports,
})
