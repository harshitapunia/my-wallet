import { useEffect, useRef, useMemo, useState } from 'react'
import { ethers } from 'ethers'
import { usePublicClient } from 'wagmi'
import { CHAIN_OPTIONS, EXPLORER_APIS, EXPLORER_TX_BASE } from './config/chains'
import PopupLayout from './PopupLayout'

const STORAGE_KEY = 'wallet_expo_secure_wallet_v1'
const TX_STORAGE_KEY = 'wallet_expo_sent_transactions_v1'

// ─── Extension environment guard ─────────────────────────────────────────────
// window.chrome?.runtime?.id is only set when running inside a real extension.
const IS_EXTENSION = typeof chrome !== 'undefined' && !!chrome?.runtime?.id

function shortAddress(address) {
  if (!address) return '-'
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function formatEther(value) {
  try {
    return Number(ethers.formatEther(value)).toFixed(6)
  } catch {
    return '0.000000'
  }
}

function normalizeIpfs(url) {
  if (!url) return ''
  if (url.startsWith('ipfs://')) {
    return `https://ipfs.io/ipfs/${url.replace('ipfs://', '')}`
  }
  return url
}

function getNftImage(item) {
  const image =
    item?.image?.cachedUrl ||
    item?.image?.thumbnailUrl ||
    item?.image?.pngUrl ||
    item?.media?.[0]?.gateway ||
    item?.metadata?.image ||
    item?.raw?.metadata?.image ||
    ''

  return normalizeIpfs(image)
}

function nftFallback(seed) {
  return `https://api.dicebear.com/9.x/shapes/svg?seed=${seed}`
}

function loadWalletRecord() {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function saveWalletRecord(record) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
}

function loadSentTransactions() {
  const raw = localStorage.getItem(TX_STORAGE_KEY)
  if (!raw) return []

  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function saveSentTransactions(items) {
  localStorage.setItem(TX_STORAGE_KEY, JSON.stringify(items))
}

function getProvider(chainKey, customRpcUrl) {
  const selected = CHAIN_OPTIONS.find((chain) => chain.key === chainKey) ?? CHAIN_OPTIONS[0]
  const rpcUrl = customRpcUrl?.trim() || selected.rpcUrl || selected.fallbackRpcUrl

  if (!rpcUrl) {
    throw new Error('Missing RPC URL. Add it in .env or enter a custom RPC URL.')
  }

  return new ethers.JsonRpcProvider(rpcUrl, selected.id)
}

function getVaultAddress(chainKey) {
  const map = {
    sepolia: import.meta.env.VITE_WALLET_VAULT_ADDRESS_SEPOLIA || import.meta.env.VITE_WALLET_VAULT_ADDRESS || '',
    baseSepolia: import.meta.env.VITE_WALLET_VAULT_ADDRESS_BASE_SEPOLIA || '',
    monad: import.meta.env.VITE_WALLET_VAULT_ADDRESS_MONAD || '',
  }

  return map[chainKey] || ''
}

function App() {
  const [showSplash, setShowSplash] = useState(true)
  const [step, setStep] = useState('create')
  const [view, setView] = useState('home')
  const [importMode, setImportMode] = useState('mnemonic')
  const [mnemonicInput, setMnemonicInput] = useState('')
  const [privateKeyInput, setPrivateKeyInput] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [unlockPassword, setUnlockPassword] = useState('')
  const [backupPhrase, setBackupPhrase] = useState('')
  const [address, setAddress] = useState('')
  const [selectedChain, setSelectedChain] = useState('sepolia')
  const [customRpcUrl, setCustomRpcUrl] = useState('')
  const [balance, setBalance] = useState('0.000000')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [wallet, setWallet] = useState(null)
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [gasBreakdown, setGasBreakdown] = useState(null)
  const [txHash, setTxHash] = useState('')
  const [txReceiptStatus, setTxReceiptStatus] = useState('')
  const [history, setHistory] = useState([])
  const [sending, setSending] = useState(false)
  const [nfts, setNfts] = useState([])
  const [nftsLoading, setNftsLoading] = useState(false)
  const [nftsError, setNftsError] = useState('')
  const [securityPassword, setSecurityPassword] = useState('')
  const [privateKeyVisible, setPrivateKeyVisible] = useState(false)
  const [revealedPrivateKey, setRevealedPrivateKey] = useState('')

  // ─── Extension bridge state ─────────────────────────────────────────────
  /**
   * pendingRequest shape:
   * {
   *   requestId: string,
   *   method:    'eth_requestAccounts' | 'eth_sendTransaction' | ...,
   *   params:    any[],
   *   origin:    string,   // dApp URL origin
   * }
   */
  const [pendingRequest, setPendingRequest] = useState(null)
  const [approvalPassword, setApprovalPassword] = useState('')
  const [approvalError, setApprovalError] = useState('')
  const [approvalBusy, setApprovalBusy] = useState(false)
  const portRef = useRef(null)   // chrome.runtime.Port to background

  const activeChain = useMemo(
    () => CHAIN_OPTIONS.find((chain) => chain.key === selectedChain) ?? CHAIN_OPTIONS[0],
    [selectedChain],
  )

  const vaultContractAddress = getVaultAddress(activeChain.key)
  const wagmiPublicClient = usePublicClient({ chainId: activeChain.id })

  useEffect(() => {
    const existing = loadWalletRecord()
    if (!existing) return

    setAddress(existing.address)
    setSelectedChain(existing.chainKey || 'sepolia')
    setCustomRpcUrl(existing.customRpcUrl || '')
    setStep('unlock')
  }, [])

  useEffect(() => {
    if (!address || !activeChain.explorerApi) {
      setHistory([])
      return
    }

    const loadHistory = async () => {
      const explorerApi = EXPLORER_APIS[activeChain.key]
      const apiKey = import.meta.env.VITE_ETHERSCAN_API_KEY || ''
      const local = loadSentTransactions().filter((item) => item.chainKey === activeChain.key)

      if (!explorerApi) {
        setHistory(local)
        return
      }

      try {
        const query = `${explorerApi}?module=account&action=txlist&address=${address}&sort=desc&apikey=${apiKey}`
        const response = await fetch(query)
        const data = await response.json()

        if (data.status === '1' && Array.isArray(data.result)) {
          const normalized = data.result.slice(0, 20).map((item) => ({
            hash: item.hash,
            from: item.from,
            to: item.to,
            value: ethers.formatEther(item.value || '0'),
            status: item.txreceipt_status === '1' ? 'success' : 'failed',
            timestamp: Number(item.timeStamp) * 1000,
            chainKey: activeChain.key,
          }))
          setHistory(normalized)
          return
        }

        setHistory(local)
      } catch {
        setHistory(local)
      }
    }

    loadHistory()
  }, [address, activeChain])

  async function fetchNfts() {
    if (!address) return

    setNftsLoading(true)
    setNftsError('')

    try {
      if (!activeChain.nftApi) {
        setNfts([])
        setNftsError('NFT API URL is not configured for this network.')
        return
      }

      const query = `${activeChain.nftApi}/getNFTsForOwner?owner=${address}&withMetadata=true&pageSize=24`
      const response = await fetch(query)
      const data = await response.json()
      const items = data?.ownedNfts || data?.result?.ownedNfts || []

      const normalized = items.map((item, index) => {
        const tokenId = item?.tokenId || item?.id?.tokenId || '0x0'
        const formattedId = tokenId.startsWith('0x') ? Number.parseInt(tokenId, 16).toString() : tokenId
        const name = item?.name || item?.title || `NFT #${formattedId}`
        const contract = item?.contract?.address || item?.contractAddress || 'Unknown contract'

        return {
          id: `${contract}-${tokenId}-${index}`,
          name,
          tokenId: formattedId,
          contract,
          image: getNftImage(item) || nftFallback(`${contract}-${tokenId}`),
        }
      })

      setNfts(normalized)
    } catch {
      setNfts([])
      setNftsError('Unable to fetch NFTs. Check API key, URL, and wallet activity.')
    } finally {
      setNftsLoading(false)
    }
  }

  async function refreshBalance() {
    if (!address) return

    try {
      const provider = getProvider(selectedChain, customRpcUrl)
      const currentBalance = await provider.getBalance(address)
      setBalance(formatEther(currentBalance))
      setStatus('Balance synced from RPC.')
      setError('')
    } catch (walletError) {
      setError(walletError.message)
      setStatus('')
    }
  }

  async function createWallet() {
    setError('')
    setStatus('')

    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    if (password !== confirmPassword) {
      setError('Password and confirm password do not match.')
      return
    }

    try {
      const newWallet = ethers.Wallet.createRandom()
      const encryptedJson = await newWallet.encrypt(password)
      const record = {
        address: newWallet.address,
        encryptedJson,
        chainKey: selectedChain,
        customRpcUrl,
      }

      saveWalletRecord(record)
      setBackupPhrase(newWallet.mnemonic?.phrase || '')
      setAddress(newWallet.address)
      setPassword('')
      setConfirmPassword('')
      setStep('backup')
      setStatus('Wallet created. Backup your seed phrase now.')
    } catch (walletError) {
      setError(walletError.message)
    }
  }

  async function importWallet() {
    setError('')
    setStatus('')

    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    if (password !== confirmPassword) {
      setError('Password and confirm password do not match.')
      return
    }

    try {
      let imported

      if (importMode === 'mnemonic') {
        imported = ethers.Wallet.fromPhrase(mnemonicInput.trim())
      } else {
        imported = new ethers.Wallet(privateKeyInput.trim())
      }

      const encryptedJson = await imported.encrypt(password)
      const record = {
        address: imported.address,
        encryptedJson,
        chainKey: selectedChain,
        customRpcUrl,
      }

      saveWalletRecord(record)
      setAddress(imported.address)
      setPassword('')
      setConfirmPassword('')
      setMnemonicInput('')
      setPrivateKeyInput('')
      setStep('unlock')
      setStatus('Wallet imported and encrypted locally.')
    } catch {
      setError('Wallet import failed. Check seed phrase/private key format.')
    }
  }

  async function unlockWallet() {
    setError('')
    setStatus('')

    try {
      const stored = loadWalletRecord()
      if (!stored?.encryptedJson) {
        setError('No encrypted wallet found in browser storage.')
        return
      }

      const decrypted = await ethers.Wallet.fromEncryptedJson(stored.encryptedJson, unlockPassword)
      setWallet(decrypted)
      setAddress(decrypted.address)
      setUnlockPassword('')
      setStep('dashboard')
      setView('home')
      setStatus('Wallet unlocked in memory.')
    } catch {
      setError('Invalid password. Unable to decrypt wallet.')
    }
  }

  async function revealPrivateKey() {
    setError('')

    if (!securityPassword) {
      setError('Enter password to reveal private key.')
      return
    }

    try {
      const stored = loadWalletRecord()
      if (!stored?.encryptedJson) {
        setError('No encrypted wallet found in browser storage.')
        return
      }

      const checkedWallet = await ethers.Wallet.fromEncryptedJson(stored.encryptedJson, securityPassword)
      if (checkedWallet.address.toLowerCase() !== address.toLowerCase()) {
        setError('Wallet mismatch while verifying password.')
        return
      }

      setRevealedPrivateKey(checkedWallet.privateKey)
      setPrivateKeyVisible(true)
      setSecurityPassword('')
      setStatus('Private key revealed for 20 seconds. Keep it secure.')
      window.setTimeout(() => {
        setPrivateKeyVisible(false)
        setRevealedPrivateKey('')
      }, 20000)
    } catch {
      setError('Password check failed. Private key not revealed.')
    }
  }

  async function estimateTransaction() {
    setError('')
    setStatus('')
    setTxHash('')
    setTxReceiptStatus('')

    if (!wallet) {
      setError('Unlock your wallet first.')
      return
    }

    try {
      const provider = getProvider(selectedChain, customRpcUrl)
      const value = ethers.parseEther(amount || '0')
      const txRequest = {
        to: recipient,
        value,
        from: wallet.address,
      }

      const [gasLimit, feeData, nonce] = await Promise.all([
        provider.estimateGas(txRequest),
        provider.getFeeData(),
        provider.getTransactionCount(wallet.address, 'latest'),
      ])

      const maxFeePerGas = feeData.maxFeePerGas || feeData.gasPrice || 0n
      const estimatedGasCost = gasLimit * maxFeePerGas

      setGasBreakdown({
        to: recipient,
        value,
        gasLimit,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || 0n,
        maxFeePerGas,
        estimatedGasCost,
        nonce,
      })

      setStatus('Gas estimation complete. Review and send when ready.')
    } catch (walletError) {
      setError(walletError.message)
      setGasBreakdown(null)
    }
  }

  async function sendTransaction() {
    setError('')
    setStatus('')
    setSending(true)

    if (!wallet || !gasBreakdown) {
      setSending(false)
      setError('Estimate gas before sending.')
      return
    }

    try {
      const provider = getProvider(selectedChain, customRpcUrl)
      const connected = wallet.connect(provider)

      const txResponse = await connected.sendTransaction({
        to: gasBreakdown.to,
        value: gasBreakdown.value,
        gasLimit: gasBreakdown.gasLimit,
        maxFeePerGas: gasBreakdown.maxFeePerGas,
        maxPriorityFeePerGas: gasBreakdown.maxPriorityFeePerGas,
        nonce: gasBreakdown.nonce,
      })

      setTxHash(txResponse.hash)
      setStatus('Transaction signed locally and broadcasted via RPC.')
      setTxReceiptStatus('Pending confirmation...')

      const receipt = await txResponse.wait()
      const succeeded = receipt?.status === 1
      setTxReceiptStatus(succeeded ? 'Confirmed on-chain.' : 'Failed on-chain.')

      const localHistory = loadSentTransactions()
      const next = [
        {
          hash: txResponse.hash,
          from: wallet.address,
          to: gasBreakdown.to,
          value: ethers.formatEther(gasBreakdown.value),
          status: succeeded ? 'success' : 'failed',
          timestamp: Date.now(),
          chainKey: activeChain.key,
        },
        ...localHistory,
      ]

      saveSentTransactions(next)
      setHistory(next.filter((item) => item.chainKey === activeChain.key).slice(0, 20))
      await refreshBalance()
      setGasBreakdown(null)
      setAmount('')
      setRecipient('')
      setView('transactions')
    } catch (walletError) {
      setError(walletError.message)
      setTxReceiptStatus('')
    } finally {
      setSending(false)
    }
  }

  function lockWallet() {
    setWallet(null)
    setPrivateKeyVisible(false)
    setRevealedPrivateKey('')
    setStep('unlock')
    setStatus('Wallet locked.')
  }

  function resetWallet() {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(TX_STORAGE_KEY)
    setWallet(null)
    setAddress('')
    setBalance('0.000000')
    setGasBreakdown(null)
    setHistory([])
    setNfts([])
    setStep('create')
    setStatus('Local wallet data cleared.')
    setError('')
  }

  useEffect(() => {
    if (!wallet) return
    refreshBalance()
  }, [wallet, selectedChain, customRpcUrl])

  useEffect(() => {
    if (step === 'dashboard' && view === 'nfts') {
      fetchNfts()
    }
  }, [step, view, selectedChain, address])

  // ─── Extension port connection ───────────────────────────────────────────
  // Connects to background.js via the named 'wallet-expo-channel' port.
  // Receives pending dApp requests and surfaces them as the approval UI.
  // Also notifies background when user changes accounts / chain.
  //
  // NOTE: We connect once on mount regardless of whether the wallet is
  // unlocked.  Requests can arrive while the wallet is locked; we surface
  // the unlock screen first and queue the request so it is shown
  // immediately after the user unlocks.
  useEffect(() => {
    if (!IS_EXTENSION) return  // Skip entirely when running as a plain website

    let port
    try {
      port = chrome.runtime.connect({ name: 'wallet-expo-channel' })
      portRef.current = port
    } catch (err) {
      console.warn('[Shakkar] Could not connect to background:', err.message)
      return
    }

    port.onMessage.addListener((msg) => {
      if (msg.type === 'SHAKKAR_PENDING_REQUEST') {
        // A dApp is requesting something – surface the approval UI
        setPendingRequest({
          requestId: msg.requestId,
          method: msg.method,
          params: msg.params || [],
          origin: msg.origin || 'Unknown dApp',
        })
        setApprovalError('')
        setApprovalPassword('')
        // If the wallet is locked and a request arrives, jump to the unlock
        // screen so the user can authenticate before approving
        setShowSplash(false)
      }
    })

    port.onDisconnect.addListener(() => {
      portRef.current = null
    })

    return () => {
      try { port.disconnect() } catch (_) { }
      portRef.current = null
    }
  }, []) // connect once on mount

  // Notify background when selected chain changes so dApps get chainChanged.
  // We only broadcast if the wallet is unlocked (avoid spurious empty events
  // during initial render before the user has authenticated).
  useEffect(() => {
    if (!IS_EXTENSION || !portRef.current || !wallet) return
    const chain = CHAIN_OPTIONS.find((c) => c.key === selectedChain)
    if (!chain) return
    const hexChainId = '0x' + chain.id.toString(16)
    try {
      portRef.current.postMessage({
        type: 'SHAKKAR_CHAIN_CHANGED',
        chainId: hexChainId,
      })
    } catch (_) { }
  }, [selectedChain, wallet])

  // Notify background when wallet (account) changes
  useEffect(() => {
    if (!IS_EXTENSION || !portRef.current) return
    const accounts = wallet ? [wallet.address] : []
    try {
      portRef.current.postMessage({
        type: 'SHAKKAR_ACCOUNTS_CHANGED',
        accounts,
      })
    } catch (_) { }
  }, [wallet])

  // ─── dApp Approval Handlers ──────────────────────────────────────────────

  /** Send a result or error back to the background, which relays to the dApp */
  function sendApprovalResponse(requestId, result, error) {
    if (!portRef.current) return
    try {
      portRef.current.postMessage({
        type: 'SHAKKAR_RESPONSE',
        requestId,
        result: result ?? null,
        error: error ?? null,
      })
    } catch (err) {
      console.warn('[Shakkar] Could not send approval response:', err.message)
    }
    setPendingRequest(null)
    setApprovalPassword('')
    setApprovalError('')
    setApprovalBusy(false)
  }

  /** User clicked REJECT on any dApp request */
  function handleApprovalReject() {
    if (!pendingRequest) return
    sendApprovalResponse(pendingRequest.requestId, null, {
      code: 4001,
      message: 'User rejected the request.',
    })
  }

  /** User approved eth_requestAccounts – return the active address */
  function handleApproveAccounts() {
    if (!pendingRequest || !wallet) return
    sendApprovalResponse(pendingRequest.requestId, [wallet.address], null)
  }

  /** User approved eth_sendTransaction – decrypt key, sign, broadcast */
  async function handleApproveSendTransaction() {
    if (!pendingRequest) return
    setApprovalError('')
    setApprovalBusy(true)

    try {
      const stored = loadWalletRecord()
      if (!stored?.encryptedJson) throw new Error('No encrypted wallet found.')

      // Decrypt the private key with the password the user just entered
      const decryptedWallet = await ethers.Wallet.fromEncryptedJson(
        stored.encryptedJson,
        approvalPassword,
      )

      // Build provider for the currently selected chain
      const provider = getProvider(selectedChain, customRpcUrl)
      const connected = decryptedWallet.connect(provider)

      // Extract transaction fields from the dApp-supplied params[0]
      const txParams = pendingRequest.params[0] || {}
      const txRequest = {
        to: txParams.to,
        from: txParams.from || decryptedWallet.address,
        value: txParams.value ? BigInt(txParams.value) : 0n,
        data: txParams.data || '0x',
        ...(txParams.gas && { gasLimit: BigInt(txParams.gas) }),
        ...(txParams.gasPrice && { gasPrice: BigInt(txParams.gasPrice) }),
        ...(txParams.maxFeePerGas && { maxFeePerGas: BigInt(txParams.maxFeePerGas) }),
        ...(txParams.maxPriorityFeePerGas && { maxPriorityFeePerGas: BigInt(txParams.maxPriorityFeePerGas) }),
        ...(txParams.nonce !== undefined && { nonce: Number(txParams.nonce) }),
      }

      const txResponse = await connected.sendTransaction(txRequest)

      // Return the tx hash to the dApp immediately; don't wait for mining
      sendApprovalResponse(pendingRequest.requestId, txResponse.hash, null)

      // Update local history in the background
      const localHistory = loadSentTransactions()
      const next = [
        {
          hash: txResponse.hash,
          from: decryptedWallet.address,
          to: txRequest.to,
          value: ethers.formatEther(txRequest.value),
          status: 'pending',
          timestamp: Date.now(),
          chainKey: selectedChain,
        },
        ...localHistory,
      ]
      saveSentTransactions(next)
      setHistory(next.filter((item) => item.chainKey === selectedChain).slice(0, 20))
    } catch (err) {
      // Wrong password or broadcast failure
      const isDecryptError = err.message?.toLowerCase().includes('invalid')
        || err.message?.toLowerCase().includes('password')
        || err.message?.toLowerCase().includes('decrypt')
      if (isDecryptError) {
        setApprovalError('Wrong password — could not decrypt wallet.')
        setApprovalBusy(false)
        return  // Leave the approval UI open so user can retry
      }
      // For real broadcast errors, reject back to the dApp
      sendApprovalResponse(pendingRequest?.requestId, null, {
        code: -32603,
        message: err.message || 'Transaction failed.',
      })
      setApprovalError('')
    } finally {
      setApprovalBusy(false)
    }
  }

  const wagmiNetworkInfo = wagmiPublicClient ? `Wagmi live: chain #${activeChain.id}` : 'Wagmi unavailable'

  // ─── Shared sticky header (shown on all screens except splash) ──────────────
  const StickyHeader = (
    <header className="popup-header">
      <div className="brand-mark small" aria-hidden="true"><span /></div>
      <div className="popup-header-center">
        <p className="tag">Shakkar Wallet</p>
        {wallet && <h2 style={{ fontSize: '0.78rem' }}>{shortAddress(address)}</h2>}
      </div>
      <span className="network-pill">{activeChain.label}</span>
    </header>
  )

  // ─── dApp Approval Screen ────────────────────────────────────────────────
  // Intercepts rendering when a dApp request is pending.
  //
  // Three cases:
  //   1. Wallet unlocked (step==='dashboard' && wallet)  → show approval UI
  //   2. Wallet locked  (step==='unlock')  → unlock form is shown; once the
  //      user unlocks, wallet becomes non-null and we re-render into case 1.
  //   3. No wallet exists yet → user must create/import first.
  //
  // We only full-screen intercept for case 1 here; cases 2 & 3 fall through
  // to the normal flow which already shows the unlock/create screen.
  if (pendingRequest && step === 'dashboard' && wallet) {
    const { method, params, origin } = pendingRequest
    const txParams = params[0] || {}

    return (
      <PopupLayout showHeader header={StickyHeader}>
        {/* ── dApp origin badge ── */}
        <div className="panel" style={{ gap: '0.4rem' }}>
          <p className="tag">dApp Request</p>
          <p className="meta" style={{ wordBreak: 'break-all' }}>
            <strong>Origin:</strong> {origin}
          </p>
        </div>

        {/* ── eth_requestAccounts ── */}
        {method === 'eth_requestAccounts' && (
          <div className="panel">
            <h2>Connect Wallet</h2>
            <p className="meta">This dApp is requesting access to your address.</p>
            <div className="mini-stat">
              <p className="meta">Account to share</p>
              <p className="mono">{wallet?.address}</p>
            </div>
            <div className="inline-actions">
              <button onClick={handleApproveAccounts}>Approve</button>
              <button className="ghost" onClick={handleApprovalReject}>Reject</button>
            </div>
          </div>
        )}

        {/* ── eth_sendTransaction ── */}
        {method === 'eth_sendTransaction' && (
          <div className="panel">
            <h2>Sign Transaction</h2>
            <p className="meta">This dApp wants to send a transaction.</p>
            <div className="tx-breakdown">
              <h3>Transaction Details</h3>
              <p><strong>To:</strong> <span className="mono">{txParams.to || '—'}</span></p>
              <p><strong>Value:</strong> {txParams.value ? formatEther(BigInt(txParams.value)) : '0.000000'} ETH</p>
              {txParams.data && txParams.data !== '0x' && (
                <p><strong>Data:</strong> <span className="mono">{txParams.data.slice(0, 42)}…</span></p>
              )}
              <p className="meta">Network: {activeChain.label}</p>
            </div>
            <label>
              Wallet Password
              <input
                type="password"
                value={approvalPassword}
                onChange={(e) => setApprovalPassword(e.target.value)}
                placeholder="Enter unlock password"
                disabled={approvalBusy}
              />
            </label>
            {approvalError && <p className="status error">{approvalError}</p>}
            <div className="inline-actions">
              <button onClick={handleApproveSendTransaction} disabled={approvalBusy || !approvalPassword}>
                {approvalBusy ? 'Signing…' : 'Sign & Send'}
              </button>
              <button className="ghost" onClick={handleApprovalReject} disabled={approvalBusy}>Reject</button>
            </div>
          </div>
        )}

        {/* ── Unsupported method ── */}
        {method !== 'eth_requestAccounts' && method !== 'eth_sendTransaction' && (
          <div className="panel">
            <p className="meta">Unsupported method: <code>{method}</code></p>
            <button className="ghost" onClick={handleApprovalReject}>Dismiss</button>
          </div>
        )}
      </PopupLayout>
    )
  }

  if (showSplash) {
    return (
      <PopupLayout showHeader={false}>
        <div className="splash-screen" style={{ margin: '-0.75rem', height: '100%', minHeight: 'calc(600px - 0px)' }}>
          <div className="splash-orb orb-left" />
          <div className="splash-orb orb-right" />
          <section className="splash-card">
            <div className="brand-mark" aria-hidden="true"><span /></div>
            <p className="logo-word">SHAKKAR</p>
            <p className="splash-eyebrow">Wallet Expo 2026</p>
            <h1 className="brand-title splash-title">Shakkar</h1>
            <button onClick={() => setShowSplash(false)}>Enter Wallet</button>
          </section>
        </div>
      </PopupLayout>
    )
  }

  return (
    <PopupLayout
      showHeader
      header={StickyHeader}
      footer={
        (status || error) ? (
          <>
            {status && <p className="status ok" style={{ margin: 0, borderRadius: '0.5rem' }}>{status}</p>}
            {error && <p className="status error" style={{ margin: 0, borderRadius: '0.5rem' }}>{error}</p>}
          </>
        ) : null
      }
    >
      {/* ── Network + RPC selector (collapsed compact panel) ── */}
      <div className="panel" style={{ gap: '0.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Network</h2>
          <p className="meta" style={{ fontSize: '0.68rem' }}>{wagmiNetworkInfo}</p>
        </div>
        <label style={{ margin: 0 }}>
          Chain
          <select value={selectedChain} onChange={(e) => setSelectedChain(e.target.value)}>
            {CHAIN_OPTIONS.map((chain) => (
              <option key={chain.key} value={chain.key}>{chain.label}</option>
            ))}
          </select>
        </label>
        <label style={{ margin: 0 }}>
          Custom RPC <span className="meta" style={{ fontWeight: 400 }}>(optional)</span>
          <input
            value={customRpcUrl}
            onChange={(e) => setCustomRpcUrl(e.target.value)}
            placeholder="https://your-rpc-url"
          />
        </label>
      </div>

      {/* ══════════════════════ CREATE / IMPORT ══════════════════════ */}
      {step === 'create' && (
        <div className="panel">
          <h2>New Wallet</h2>
          <div className="tabs">
            <button className={importMode === 'mnemonic' ? 'active' : ''} onClick={() => setImportMode('mnemonic')}>
              Seed Phrase
            </button>
            <button className={importMode === 'privateKey' ? 'active' : ''} onClick={() => setImportMode('privateKey')}>
              Private Key
            </button>
          </div>

          {/* Create card */}
          <div className="card">
            <h3>Create New</h3>
            <label>Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 8 chars" />
            </label>
            <label>Confirm
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </label>
            <button onClick={createWallet}>Create Wallet</button>
          </div>

          {/* Import card */}
          <div className="card">
            <h3>Import Existing</h3>
            {importMode === 'mnemonic' ? (
              <label>Seed Phrase
                <textarea rows={2} value={mnemonicInput} onChange={(e) => setMnemonicInput(e.target.value)} placeholder="word1 word2 … word12" />
              </label>
            ) : (
              <label>Private Key
                <input type="password" value={privateKeyInput} onChange={(e) => setPrivateKeyInput(e.target.value)} placeholder="0x..." />
              </label>
            )}
            <label>Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 8 chars" />
            </label>
            <label>Confirm
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </label>
            <button onClick={importWallet}>Import Wallet</button>
          </div>
        </div>
      )}

      {/* ══════════════════════ BACKUP ══════════════════════ */}
      {step === 'backup' && (
        <div className="panel">
          <h2>Backup Seed Phrase</h2>
          <p className="warning">Write this offline. Anyone with this controls your funds.</p>
          <div className="phrase">{backupPhrase}</div>
          <button onClick={() => { setBackupPhrase(''); setStep('unlock') }}>I backed it up ✓</button>
        </div>
      )}

      {/* ══════════════════════ UNLOCK ══════════════════════ */}
      {step === 'unlock' && (
        <div className="panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
            <div className="wallet-avatar" aria-hidden="true" style={{ width: 44, height: 44, flexShrink: 0 }}><span /></div>
            <div>
              <p className="tag">Unlock Wallet</p>
              <p className="meta">{shortAddress(address)}</p>
            </div>
          </div>
          <label>Password
            <input
              type="password"
              value={unlockPassword}
              onChange={(e) => setUnlockPassword(e.target.value)}
              placeholder="Enter unlock password"
              autoFocus
            />
          </label>
          <div className="inline-actions">
            <button onClick={unlockWallet}>Unlock</button>
            <button className="ghost" onClick={resetWallet}>Reset</button>
          </div>
          {pendingRequest && (
            <p className="meta" style={{ marginTop: '0.3rem' }}>
              ⚠️ A dApp request is waiting. Unlock to review it.
            </p>
          )}
        </div>
      )}

      {/* ══════════════════════ DASHBOARD ══════════════════════ */}
      {step === 'dashboard' && (
        <>
          {/* ── Account identity strip ── */}
          <div className="panel" style={{ gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div className="wallet-avatar" aria-hidden="true" style={{ width: 44, height: 44, flexShrink: 0 }}><span /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="tag">Current Wallet</p>
                <p className="mono" style={{ fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {address}
                </p>
                <p className="balance">{balance} ETH</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flexShrink: 0 }}>
                <button onClick={refreshBalance} style={{ minHeight: 30, fontSize: '0.7rem', padding: '0.22rem 0.5rem', width: 'auto' }}>↻</button>
                <button className="ghost" onClick={lockWallet} style={{ minHeight: 30, fontSize: '0.7rem', padding: '0.22rem 0.5rem', width: 'auto' }}>🔒</button>
              </div>
            </div>

            {/* ── Tab navigation strip ── */}
            <div className="sidebar-nav">
              <button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}>Home</button>
              <button className={view === 'send' ? 'active' : ''} onClick={() => setView('send')}>Send</button>
              <button className={view === 'transactions' ? 'active' : ''} onClick={() => setView('transactions')}>Txns</button>
              <button className={view === 'nfts' ? 'active' : ''} onClick={() => setView('nfts')}>NFTs</button>
              <button className={view === 'security' ? 'active' : ''} onClick={() => setView('security')}>Keys</button>
            </div>
          </div>

          {/* ── Home ── */}
          {view === 'home' && (
            <div className="panel">
              <h2>Overview</h2>
              <div className="stats-row">
                <article className="mini-stat">
                  <p className="meta">Address</p>
                  <p className="mono">{shortAddress(address)}</p>
                </article>
                <article className="mini-stat">
                  <p className="meta">Vault Contract</p>
                  <p className="mono">{shortAddress(vaultContractAddress) || 'Not set'}</p>
                </article>
                <article className="mini-stat">
                  <p className="meta">Activity</p>
                  <p style={{ fontWeight: 700 }}>{history.length} records</p>
                </article>
              </div>

              <div className="dual-showcase">
                <section className="panel-lite">
                  <div className="section-head">
                    <h3>Recent Txns</h3>
                    <button className="ghost" onClick={() => setView('transactions')}>All</button>
                  </div>
                  {history.length === 0 && <p className="meta">No records yet.</p>}
                  <ul className="history-list compact-list">
                    {history.slice(0, 3).map((item) => {
                      const isIn = item.to?.toLowerCase() === address.toLowerCase()
                      return (
                        <li key={item.hash}>
                          <strong>{isIn ? '⬇ IN' : '⬆ OUT'}</strong> {Number(item.value).toFixed(4)} ETH
                          <div className="meta">{new Date(item.timestamp).toLocaleDateString()}</div>
                        </li>
                      )
                    })}
                  </ul>
                </section>

                <section className="panel-lite">
                  <div className="section-head">
                    <h3>NFTs</h3>
                    <button className="ghost" onClick={() => setView('nfts')}>All</button>
                  </div>
                  <button onClick={fetchNfts} disabled={nftsLoading} style={{ minHeight: 30, fontSize: '0.72rem' }}>
                    {nftsLoading ? 'Loading…' : 'Refresh'}
                  </button>
                  {nfts.length === 0 && !nftsLoading && <p className="meta">None on {activeChain.label}.</p>}
                  <div className="nft-mini-grid">
                    {nfts.slice(0, 2).map((nft) => (
                      <article key={nft.id} className="nft-mini-card">
                        <img src={nft.image} alt={nft.name} loading="lazy" />
                        <p>{nft.name}</p>
                      </article>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          )}

          {/* ── Send ── */}
          {view === 'send' && (
            <div className="panel">
              <h2>Send ETH</h2>
              <label>Recipient
                <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x..." />
              </label>
              <label>Amount (ETH)
                <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.01" type="number" step="any" />
              </label>
              <button onClick={estimateTransaction}>Estimate Gas</button>
              {gasBreakdown && (
                <div className="tx-breakdown">
                  <h3>Gas Breakdown</h3>
                  <p>To: <span className="mono">{shortAddress(gasBreakdown.to)}</span></p>
                  <p>Amount: {formatEther(gasBreakdown.value)} ETH</p>
                  <p>Gas Limit: {gasBreakdown.gasLimit.toString()}</p>
                  <p>Est. Fee: {formatEther(gasBreakdown.estimatedGasCost)} ETH</p>
                  <button onClick={sendTransaction} disabled={sending}>
                    {sending ? 'Sending…' : 'Sign & Send'}
                  </button>
                </div>
              )}
              {txHash && <p className="meta">Hash: <span className="mono">{shortAddress(txHash)}</span></p>}
              {txReceiptStatus && <p className="meta">{txReceiptStatus}</p>}
            </div>
          )}

          {/* ── Transactions ── */}
          {view === 'transactions' && (
            <div className="panel">
              <h2>Transactions</h2>
              {history.length === 0 && <p className="meta">No transactions yet on {activeChain.label}.</p>}
              <ul className="history-list">
                {history.map((item) => {
                  const isIn = item.to?.toLowerCase() === address.toLowerCase()
                  const base = EXPLORER_TX_BASE[activeChain.key]
                  return (
                    <li key={item.hash}>
                      <div><strong>{isIn ? '⬇ IN' : '⬆ OUT'}</strong> {Number(item.value).toFixed(6)} ETH</div>
                      <div className="meta">{new Date(item.timestamp).toLocaleString()}</div>
                      <div className="meta">Status: {item.status}</div>
                      {base && <a href={`${base}${item.hash}`} target="_blank" rel="noreferrer">Explorer ↗</a>}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* ── NFTs ── */}
          {view === 'nfts' && (
            <div className="panel">
              <h2>NFT Gallery</h2>
              <p className="meta">On {activeChain.label}</p>
              <button onClick={fetchNfts} disabled={nftsLoading}>
                {nftsLoading ? 'Loading…' : 'Refresh NFTs'}
              </button>
              {nftsError && <p className="status error">{nftsError}</p>}
              {!nftsLoading && nfts.length === 0 && !nftsError && <p className="meta">No NFTs found.</p>}
              <div className="nft-grid">
                {nfts.map((nft) => (
                  <article key={nft.id} className="nft-card">
                    <img src={nft.image} alt={nft.name} loading="lazy" />
                    <h3>{nft.name}</h3>
                    <p className="meta">#{nft.tokenId}</p>
                    <p className="meta mono">{shortAddress(nft.contract)}</p>
                  </article>
                ))}
              </div>
            </div>
          )}

          {/* ── Security ── */}
          {view === 'security' && (
            <div className="panel">
              <h2>Security</h2>
              <p className="warning">Never share your private key.</p>
              <label>Re-enter Password
                <input
                  type="password"
                  value={securityPassword}
                  onChange={(e) => setSecurityPassword(e.target.value)}
                  placeholder="Password"
                />
              </label>
              <div className="inline-actions">
                <button onClick={revealPrivateKey}>Reveal 20s</button>
                <button className="ghost" onClick={() => { setPrivateKeyVisible(false); setRevealedPrivateKey('') }}>Hide</button>
              </div>
              <div className="phrase">
                {privateKeyVisible ? revealedPrivateKey : '●●●●●●●●●●●●●●●●●●●● hidden'}
              </div>
            </div>
          )}
        </>
      )}
    </PopupLayout>
  )
}

export default App
