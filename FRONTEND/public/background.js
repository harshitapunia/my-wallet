/**
 * background.js  –  Shakkar Wallet  (Manifest V3 service worker)
 */

'use strict'

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

const pendingRequests = new Map()
let popupPort = null
let walletWindowId = null

// ─────────────────────────────────────────────────────────────────────────────
// Port connection from the React UI
// ─────────────────────────────────────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'wallet-expo-channel') return

  popupPort = port
  console.log('[Shakkar BG] Popup connected on wallet-expo-channel')

  const [firstKey] = pendingRequests.keys()
  if (firstKey) {
    const req = pendingRequests.get(firstKey)
    port.postMessage({
      type:      'SHAKKAR_PENDING_REQUEST',
      requestId: firstKey,
      method:    req.method,
      params:    req.params,
      origin:    req.origin,
    })
  }

  port.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'SHAKKAR_RESPONSE':
        resolveRequest(msg.requestId, msg.result, msg.error)
        break
      case 'SHAKKAR_ACCOUNTS_CHANGED':
        broadcastEvent('accountsChanged', msg.accounts)
        break
      case 'SHAKKAR_CHAIN_CHANGED':
        broadcastEvent('chainChanged', msg.chainId)
        break
      default:
        break
    }
  })

  port.onDisconnect.addListener(() => {
    popupPort = null
    walletWindowId = null
    console.log('[Shakkar BG] Popup disconnected')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// EVENT: Incoming dApp RPC request from a content-script
//
// chrome.runtime.sendMessage from contentScript.js lands here.
// We store the request and route it to the popup (open or to be opened).
// ─────────────────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'SHAKKAR_REQUEST') return false

  const { requestId, method, params, origin } = msg
  const tabId = sender.tab?.id

  console.log(`[Shakkar BG] Incoming dApp request: ${method} (${requestId}) from ${origin}`)

  pendingRequests.set(requestId, {
    tabId,
    origin,
    method,
    params:       params || [],
    sendResponse,
  })

  if (popupPort) {
    try {
      popupPort.postMessage({
        type:      'SHAKKAR_PENDING_REQUEST',
        requestId,
        method,
        params,
        origin,
      })
    } catch (err) {
      console.warn('[Shakkar BG] Port.postMessage failed:', err.message)
      popupPort = null
      openWalletWindow()
    }
  } else {
    openWalletWindow()
  }

  return true
})

// ─────────────────────────────────────────────────────────────────────────────
// resolveRequest  –  settle a pending request and send the result back
// ─────────────────────────────────────────────────────────────────────────────
function resolveRequest(requestId, result, error) {
  const req = pendingRequests.get(requestId)
  if (!req) {
    console.warn(`[Shakkar BG] resolveRequest: unknown requestId ${requestId}`)
    return
  }

  pendingRequests.delete(requestId)

  try {
    req.sendResponse({
      result: result ?? null,
      error:  error  ?? null,
    })
  } catch (err) {
    console.warn('[Shakkar BG] Could not send response (tab may be closed):', err.message)
  }

  if (pendingRequests.size === 0 && walletWindowId !== null) {
    chrome.windows.remove(walletWindowId).catch(() => {})
    walletWindowId = null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// openWalletWindow  –  the single, unified launcher for the wallet side-popup.
// ─────────────────────────────────────────────────────────────────────────────
const POPUP_WIDTH = 360
const EDGE_MARGIN = 8

function openWalletWindow() {
  if (walletWindowId !== null) {
    chrome.windows.update(walletWindowId, { focused: true }).catch(() => {
      walletWindowId = null
      openWalletWindow()
    })
    return
  }

  function _createWindow(availLeft, availTop, availWidth, availHeight) {
    const left = Math.max(0, Math.round(availLeft + availWidth - POPUP_WIDTH - EDGE_MARGIN))
    const top  = Math.max(0, Math.round(availTop))
    const height = Math.max(400, Math.round(availHeight))

    console.log(
      `[Shakkar BG] Opening wallet: left=${left} top=${top} w=${POPUP_WIDTH} h=${height}`,
    )

    chrome.windows.create(
      {
        url:     chrome.runtime.getURL('index.html'),
        type:    'popup',
        width:   POPUP_WIDTH,
        height:  height,
        left,
        top,
        focused: true,
      },
      (win) => {
        if (chrome.runtime.lastError || !win) {
          console.error(
            '[Shakkar BG] Could not open wallet window:',
            chrome.runtime.lastError?.message,
          )
          for (const [id] of [...pendingRequests]) {
            resolveRequest(id, null, {
              code:    -32603,
              message: 'Could not open wallet window.',
            })
          }
          return
        }

        walletWindowId = win.id
        console.log(`[Shakkar BG] Wallet window opened (id=${win.id})`)

        const onWindowRemoved = (windowId) => {
          if (windowId !== walletWindowId) return
          chrome.windows.onRemoved.removeListener(onWindowRemoved)
          walletWindowId = null

          for (const [id] of [...pendingRequests]) {
            resolveRequest(id, null, {
              code:    4001,
              message: 'User rejected the request.',
            })
          }
        }
        chrome.windows.onRemoved.addListener(onWindowRemoved)
      },
    )
  }

  if (chrome.system?.display?.getInfo) {
    chrome.system.display.getInfo({ singleUnified: false }, (displays) => {
      if (chrome.runtime.lastError || !displays?.length) {
        console.warn('[Shakkar BG] system.display failed – using window fallback')
        _fallbackViaWindow()
        return
      }
      const primary = displays.find((d) => d.isPrimary) ?? displays[0]
      const wa = primary.workArea 
      _createWindow(wa.left, wa.top, wa.width, wa.height)
    })
  } else {
    _fallbackViaWindow()
  }

  function _fallbackViaWindow() {
    chrome.windows.getLastFocused({ populate: false }, (currentWindow) => {
      const monitorRight = (currentWindow?.left ?? 0) + (currentWindow?.width ?? 1280)
      const monitorTop   = 0 
      const estimatedHeight = 900 
      _createWindow(
        (currentWindow?.left ?? 0),
        monitorTop,
        (currentWindow?.width ?? 1280),
        estimatedHeight,
      )
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// broadcastEvent 
// ─────────────────────────────────────────────────────────────────────────────
async function broadcastEvent(eventName, eventData) {
  let tabs
  try {
    tabs = await chrome.tabs.query({})
  } catch (err) {
    console.warn('[Shakkar BG] tabs.query failed:', err.message)
    return
  }

  const message = { type: 'SHAKKAR_EVENT', eventName, eventData }

  for (const tab of tabs) {
    if (!tab.id || tab.id < 0) continue
    if (tab.url?.startsWith('chrome-extension://')) continue

    chrome.tabs.sendMessage(tab.id, message).catch(() => {})
  }
}