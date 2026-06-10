/**
 * PopupLayout.jsx  –  Shakkar Wallet
 *
 * The top-level shell that constrains the entire UI inside the strict 380x600
 * popup bounding box. Every screen is rendered inside the <main> scrollable zone
 * so content never bleeds outside the frame.
 */

export default function PopupLayout({ children, header, footer, showHeader = true }) {
  return (
    <div className="wallet-app">
      {/* ── Sticky top header ─────────────────────────────────────────── */}
      {showHeader && header}

      {/* ── Scrollable body ───────────────────────────────────────────── */}
      <main className="popup-body">
        {children}
      </main>

      {/* ── Pinned bottom footer (status messages) ────────────────────── */}
      {footer && (
        <div className="popup-footer">
          {footer}
        </div>
      )}
    </div>
  )
}