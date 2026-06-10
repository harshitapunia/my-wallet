# 🧁 Shakkar Wallet

**A fast, secure, and non-custodial Web3 browser extension wallet.**

Shakkar Wallet is a Manifest V3 Chrome Extension built to provide a seamless Web3 experience. It acts as a bridge between decentralized applications (dApps) and blockchains, allowing users to securely manage their accounts and sign transactions directly from their browser.

## ✨ Key Features

* **🦊 Native Dual-Mode Architecture:** Mimics the industry-standard experience. Opens as a quick attached dropdown for everyday browsing, and launches a secure, perfectly scaled standalone side-window for dApp transaction approvals.
* **🔌 Seamless dApp Integration:** Automatically injects the `window.ethereum` provider into websites, allowing instant compatibility with standard Web3 libraries (ethers.js, viem, wagmi).
* **⛓️ Multi-Chain Support:** Built-in network switching for **Ethereum Sepolia**, **Base Sepolia**, and **Monad Testnet**.
* **🔐 Non-Custodial & Secure:** Keys are generated client-side and encrypted locally. You own your keys and your crypto.
* **🎨 Modern UI/UX:** Built with a mobile-first philosophy using Tailwind CSS to ensure the UI perfectly fits the extension bounding box without clipping or scrolling issues.

## 🛠️ Tech Stack

* **Frontend Framework:** React 18, Vite
* **Styling:** Tailwind CSS
* **Web3 Engine:** Ethers.js / Viem
* **Extension API:** Chrome Manifest V3 (Service Workers, Isolated Content Scripts)

## 🧠 Architecture Overview

Shakkar Wallet utilizes a modern MV3 architecture to ensure security and performance:
* **`background.js`:** The persistent service worker. Manages a queue of incoming dApp requests, coordinates window spawning, and maintains a connection to the React UI.
* **`contentScript.js`:** The isolated middleman that securely passes messages between the webpage and the background worker.
* **`provider.js`:** Injected directly into the webpage's DOM to establish the global `window.ethereum` API for dApps.

---
*Built for the Wallet Expo Hackathon* 🚀
