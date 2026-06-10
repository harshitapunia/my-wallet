/**
 * contentScript.js  –  Shakkar Wallet  (ISOLATED WORLD broker)
 *
 * Chrome loads this script in the ISOLATED world on every tab at
 * document_start.  It cannot read/write to window.ethereum directly, but
 * it CAN:
 *   • Inject a <script> tag that runs provider.js in the MAIN world
 *   • Listen to window.postMessage and relay messages to the extension runtime
 *   • Listen to chrome.runtime.onMessage and forward events back to the page
 *
 * ─── Message flow overview ─────────────────────────────────────────────────
 *
 *   dApp code  ──postMessage(from-page)──►  CS  ──sendMessage──►  background.js
 *                                                                        │
 *                                                                 (user approves)
 *                                                                        │
 *   dApp code  ◄──postMessage(from-extension)──  CS  ◄──sendResponse────┘
 *
 *   background.js  ──tabs.sendMessage──►  CS  ──postMessage(provider-event)──►  provider.js
 *
 * ─── Security notes ────────────────────────────────────────────────────────
 *   • We validate event.source === window before trusting any postMessage
 *   • We check the __shakkar sentinel and direction fields on every message
 *   • We do NOT relay arbitrary messages; only our own typed protocol
 */

;(function () {
  'use strict'

  // ─────────────────────────────────────────────────────────────────────────
  // 1.  Inject provider.js into the page's MAIN world
  //
  // Chrome MV3 content scripts run in an ISOLATED world and cannot modify
  // window.ethereum.  The only way to reach the MAIN world is to inject a
  // <script> element that Chrome loads from the extension's web-accessible
  // resources.
  //
  // We insert it as the FIRST child of <head> (or <html> if head doesn't
  // exist yet at document_start) so that window.ethereum is ready before any
  // dApp scripts load.
  // ─────────────────────────────────────────────────────────────────────────
  function injectProvider() {
    try {
      const script   = document.createElement('script')
      script.src     = chrome.runtime.getURL('provider.js')
      script.type    = 'text/javascript'
      script.async   = false   // must run synchronously relative to page scripts

      // Insert at the very top of the document
      const target = document.head || document.documentElement
      target.insertBefore(script, target.firstChild)

      // Remove the <script> DOM node after it executes (keeps DevTools clean)
      script.addEventListener('load', () => script.remove(), { once: true })
      script.addEventListener('error', (e) => {
        console.error('[Shakkar CS] Failed to load provider.js:', e)
        script.remove()
      }, { once: true })
    } catch (err) {
      console.error('[Shakkar CS] provider injection failed:', err)
    }
  }

  injectProvider()

  // ─────────────────────────────────────────────────────────────────────────
  // 2.  page → extension  (relay dApp RPC request to background.js)
  //
  // provider.js fires window.postMessage with direction:'from-page'.
  // We pick it up here (isolated world can hear main-world postMessages)
  // and forward it to background.js via chrome.runtime.sendMessage.
  //
  // KEY: We must return true from the sendMessage response to keep the
  // async channel alive, but that's handled by background.js.  Here we
  // await the response and pipe it back to the page.
  // ─────────────────────────────────────────────────────────────────────────
  window.addEventListener('message', async (event) => {
    // Strict source check: only accept messages from this tab's page
    if (event.source !== window) return

    const msg = event.data
    if (!msg || msg.__shakkar !== true) return
    if (msg.direction !== 'from-page') return

    let response
    try {
      // Forward to background service worker; await the approval result
      response = await chrome.runtime.sendMessage({
        type:      'SHAKKAR_REQUEST',
        requestId: msg.requestId,
        method:    msg.method,
        params:    msg.params,
        origin:    msg.origin,
      })
    } catch (err) {
      // Extension runtime error (service worker restarting, extension disabled…)
      response = {
        result: null,
        error:  { code: -32603, message: err?.message || 'Internal extension error' },
      }
    }

    // Route the result back to provider.js in the main world
    window.postMessage(
      {
        __shakkar:  true,
        direction:  'from-extension',
        requestId:  msg.requestId,
        result:     response?.result  ?? null,
        error:      response?.error   ?? null,
      },
      // Use '*' as the target origin because provider.js is injected into
      // any origin page.  The __shakkar sentinel prevents spoofing.
      '*',
    )
  })

  // ─────────────────────────────────────────────────────────────────────────
  // 3.  extension → page  (relay push events to provider.js)
  //
  // When the user switches accounts or networks inside the wallet UI,
  // background.js calls chrome.tabs.sendMessage() on all tabs.
  // We receive that here and forward it to the provider via postMessage.
  // ─────────────────────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'SHAKKAR_EVENT') return

    window.postMessage(
      {
        __shakkar:  true,
        direction:  'provider-event',
        eventName:  msg.eventName,
        eventData:  msg.eventData,
      },
      '*',
    )
  })

})()
