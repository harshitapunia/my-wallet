/**
 * provider.js  –  Shakkar Wallet  (MAIN WORLD injection)
 *
 * Injected by contentScript.js into the page's MAIN world so it can
 * write to window.ethereum without violating Manifest V3 isolation.
 *
 * EIP compliance:
 *   • EIP-1193  – .request({ method, params })
 *   • EIP-1102  – legacy .enable()
 *   • EIP-6963  – multi-wallet provider discovery
 *
 * Message contract with contentScript.js (window.postMessage):
 *
 *   page → extension  (outbound RPC call)
 *     { __shakkar: true, direction: 'from-page', requestId, method, params, origin }
 *
 *   extension → page  (RPC response)
 *     { __shakkar: true, direction: 'from-extension', requestId, result | error }
 *
 *   extension → page  (push event: accountsChanged / chainChanged)
 *     { __shakkar: true, direction: 'provider-event', eventName, eventData }
 */

;(function () {
  'use strict'

  // ─────────────────────────────────────────────────────────────────────────────
  // Guard: never inject twice (e.g. if the script tag fires more than once)
  // ─────────────────────────────────────────────────────────────────────────────
  if (window.__shakkarInjected) return
  window.__shakkarInjected = true

  // ─────────────────────────────────────────────────────────────────────────────
  // Minimal EventEmitter  (no external deps – runs in untrusted page context)
  // Implements the Node.js-compatible subset that EIP-1193 dApps expect:
  //   .on / .addListener / .once / .removeListener / .off / .emit
  // ─────────────────────────────────────────────────────────────────────────────
  class EventEmitter {
    constructor() {
      /** @type {Record<string, Function[]>} */
      this._events = {}
    }

    on(event, fn) {
      ;(this._events[event] || (this._events[event] = [])).push(fn)
      return this
    }

    addListener(event, fn) {
      return this.on(event, fn)
    }

    once(event, fn) {
      const wrapper = (...args) => {
        this.removeListener(event, wrapper)
        try { fn(...args) } catch (_) {}
      }
      wrapper._origin = fn   // lets removeListener work on the original fn
      return this.on(event, wrapper)
    }

    removeListener(event, fn) {
      if (!this._events[event]) return this
      this._events[event] = this._events[event].filter(
        (l) => l !== fn && l._origin !== fn,
      )
      return this
    }

    off(event, fn) {
      return this.removeListener(event, fn)
    }

    emit(event, ...args) {
      // Snapshot the array so that once() removals during iteration are safe
      const listeners = (this._events[event] || []).slice()
      for (const fn of listeners) {
        try { fn(...args) } catch (_) {}
      }
      return listeners.length > 0
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Pending request registry  { requestId → { resolve, reject } }
  // Lives here (MAIN world) because this is where dApp Promises are created.
  // ─────────────────────────────────────────────────────────────────────────────
  /** @type {Map<string, { resolve: Function, reject: Function }>} */
  const pending = new Map()

  // Request counter – guarantees monotonically unique IDs within this tab
  let _counter = 0

  // ─────────────────────────────────────────────────────────────────────────────
  // window.postMessage listener  (extension → page responses & push events)
  // ─────────────────────────────────────────────────────────────────────────────
  window.addEventListener('message', (event) => {
    // Only process messages that originate from this same window/tab
    if (event.source !== window) return

    const msg = event.data
    if (!msg || msg.__shakkar !== true) return

    // ── RPC response ──────────────────────────────────────────────────────────
    if (msg.direction === 'from-extension') {
      const entry = pending.get(msg.requestId)
      if (!entry) return
      pending.delete(msg.requestId)

      if (msg.error) {
        // Construct a proper EIP-1193 ProviderRpcError
        const err = new Error(msg.error.message || 'Provider error')
        err.code    = msg.error.code  ?? -32603
        err.data    = msg.error.data  ?? undefined
        err.name    = 'ProviderRpcError'
        entry.reject(err)
      } else {
        entry.resolve(msg.result)
      }
      return
    }

    // ── Push event (accountsChanged / chainChanged / connect / disconnect) ────
    if (msg.direction === 'provider-event') {
      try {
        // Keep the provider's cached state in sync
        if (msg.eventName === 'accountsChanged') {
          provider.selectedAddress = Array.isArray(msg.eventData) && msg.eventData.length
            ? msg.eventData[0]
            : null
        }
        if (msg.eventName === 'chainChanged') {
          provider.chainId = msg.eventData ?? null
          // Derive legacy networkVersion (decimal string)
          provider.networkVersion = msg.eventData
            ? String(parseInt(msg.eventData, 16))
            : null
        }

        provider.emit(msg.eventName, msg.eventData)
      } catch (_) {}
    }
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // ShakkarProvider  –  EIP-1193 compatible provider class
  // ─────────────────────────────────────────────────────────────────────────────
  class ShakkarProvider extends EventEmitter {
    constructor() {
      super()

      // ── EIP-1193 required identity fields ─────────────────────────────────
      /** Many dApps gate on isMetaMask; setting it keeps compatibility. */
      this.isMetaMask      = true
      /** Custom identity flag so dApps can detect Shakkar specifically. */
      this.isShakkar       = true

      // ── Cached state (populated/updated by push events from extension) ─────
      /** Currently selected account address, or null when not connected. */
      this.selectedAddress = null
      /** EIP-1193 chainId as a "0x"-prefixed hex string, or null. */
      this.chainId         = null
      /** Legacy decimal chain ID string (e.g. "11155111"). */
      this.networkVersion  = null
    }

    // ──────────────────────────────────────────────────────────────────────────
    // EIP-1193  .request({ method, params? })
    //
    // The core method. Generates a unique request ID, registers a Promise in
    // the local `pending` map, then forwards the call to the content-script
    // via window.postMessage. The message listener above resolves/rejects the
    // Promise when the background service worker returns an answer.
    // ──────────────────────────────────────────────────────────────────────────
    request({ method, params }) {
      if (typeof method !== 'string') {
        return Promise.reject(
          Object.assign(new Error('method must be a string'), { code: -32600 }),
        )
      }

      return new Promise((resolve, reject) => {
        const requestId = `shakkar-${Date.now()}-${++_counter}`
        pending.set(requestId, { resolve, reject })

        // Post to the content-script (isolated world) which relays to background
        window.postMessage(
          {
            __shakkar:  true,
            direction:  'from-page',
            requestId,
            method,
            params:     Array.isArray(params) ? params : (params ? [params] : []),
            origin:     window.location.origin,
          },
          '*',   // target origin '*' is required here (provider ↔ content script)
        )

        // Safety timeout: 5 minutes is industry standard for approval windows.
        // Prevents dApps from hanging forever if the user closes the popup.
        const timer = setTimeout(() => {
          if (!pending.has(requestId)) return
          pending.delete(requestId)
          const err = new Error('Shakkar Wallet: request timed out after 5 minutes.')
          err.code = -32603
          err.name = 'ProviderRpcError'
          reject(err)
        }, 5 * 60 * 1000)

        // If the promise is settled early, clear the timer to avoid noise
        const cleanup = () => clearTimeout(timer)
        pending.set(requestId, {
          resolve: (v) => { cleanup(); resolve(v) },
          reject:  (e) => { cleanup(); reject(e)  },
        })
      })
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Legacy  .send(method, params)   –  both call signatures
    //   1. send(method: string, params: any[]) → Promise
    //   2. send(payload: JsonRpcRequest, callback: Function)  (very old dApps)
    // ──────────────────────────────────────────────────────────────────────────
    send(methodOrPayload, paramsOrCallback) {
      if (typeof methodOrPayload === 'string') {
        return this.request({
          method: methodOrPayload,
          params: Array.isArray(paramsOrCallback) ? paramsOrCallback : [],
        })
      }
      // Payload-style: treat as sendAsync
      if (typeof paramsOrCallback === 'function') {
        return this.sendAsync(methodOrPayload, paramsOrCallback)
      }
      // Fallback – return a promise
      return this.request(methodOrPayload)
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Legacy  .sendAsync(payload, callback)
    // ──────────────────────────────────────────────────────────────────────────
    sendAsync(payload, callback) {
      if (typeof callback !== 'function') {
        return this.request(payload)
      }
      this.request({ method: payload.method, params: payload.params || [] })
        .then((result) => {
          callback(null, { id: payload.id, jsonrpc: '2.0', result })
        })
        .catch((err) => {
          callback(err, null)
        })
    }

    // ──────────────────────────────────────────────────────────────────────────
    // EIP-1102  .enable()   (deprecated but still used by older dApps)
    // ──────────────────────────────────────────────────────────────────────────
    enable() {
      return this.request({ method: 'eth_requestAccounts' })
    }

    // ──────────────────────────────────────────────────────────────────────────
    // EIP-1193  .isConnected()
    // Returns true once the provider has received a chainId from the extension
    // ──────────────────────────────────────────────────────────────────────────
    isConnected() {
      return this.chainId !== null
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Instantiate the singleton provider
  // ─────────────────────────────────────────────────────────────────────────────
  const provider = new ShakkarProvider()

  // ─────────────────────────────────────────────────────────────────────────────
  // EIP-6963  –  Multi-wallet provider announcement
  //
  // Modern dApps (Uniswap v4, Aave v3, etc.) use this standard to discover all
  // installed wallets without conflicting window.ethereum overwrites.
  // ─────────────────────────────────────────────────────────────────────────────
  const EIP6963_INFO = Object.freeze({
    uuid: 'a9f00e8d-3f59-4e5b-8f36-b4c1ee2a2d3a',
    name: 'Shakkar Wallet',
    // Inline SVG data URI: purple rounded rectangle with a 👛 emoji
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%236c47ff'/%3E%3Ctext y='0.9em' font-size='80' text-anchor='middle' x='50'%3E%F0%9F%91%9B%3C/text%3E%3C/svg%3E",
    rdns: 'app.shakkar.wallet',
  })

  function announceProvider() {
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: Object.freeze({ info: EIP6963_INFO, provider }),
      }),
    )
  }

  // Respond to any future eip6963:requestProvider events (e.g. lazy-loading dApps)
  window.addEventListener('eip6963:requestProvider', announceProvider)
  // Announce immediately for dApps already listening
  announceProvider()

  // ─────────────────────────────────────────────────────────────────────────────
  // Legacy window.ethereum injection
  //
  // Use Object.defineProperty with writable:false, configurable:false so that
  // rogue dApp scripts cannot overwrite our provider with a malicious one.
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    Object.defineProperty(window, 'ethereum', {
      value:        provider,
      writable:     false,
      configurable: false,
      enumerable:   false,
    })
  } catch (_) {
    // Some page already froze window.ethereum – best effort fallback
    try { window.ethereum = provider } catch (__) {}
  }

  // Dispatch the legacy init event that some older dApps listen to
  window.dispatchEvent(new Event('ethereum#initialized'))

  console.log('[Shakkar] window.ethereum injected ✓  (EIP-1193 + EIP-6963)')
})()
