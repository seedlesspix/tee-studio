'use client'
import { useState } from 'react'
import { CustomerAuthButton } from './CustomerAuthButton'
import SaveDesignControl from './SaveDesignControl'

// ActionBar — the designer's top action bar.
//
// D0 restructure step 1a (move-not-rewrite): extracted VERBATIM from
// DesignerCanvas's <header> — identical markup, the same two child components
// (SaveDesignControl, CustomerAuthButton), same classes. Every handler stays in
// the parent and arrives as a thin prop; the Next Step handler in particular is
// lifted UNCHANGED into the parent's handleNextStep and passed as onNextStep, and
// its `data-cart-btn` global DOM-query still finds the button here. Behavior is
// unchanged — verified by the human backstop; the parity harness stays green only
// as a geometry guardrail (this touches no canvas geometry).
//
// Phase 2 progress: the Build It → Order It → Pick Up/Ship stepper now renders as
// its own strip under this bar (Stepper.tsx); the per-item PRICE is folded in here
// (neutral, just left of Next Step); the title is centered via equal flex-1 sides.
// Still queued: the top→BOTTOM action-bar move (sealed "price + Save + Next" bottom
// bar — deferred, overlaps mobile) and replacing the `data-cart-btn` DOM-mutation
// with an `isSubmitting` prop.
export default function ActionBar({
  productTitle,
  onSave,
  loggedIn,
  dirty,
  savedDesignsCount,
  onOpenDesigns,
  onBeforeLogin,
  onNextStep,
  pricePerItem,
}: {
  productTitle: string
  onSave: () => Promise<{ restoreUrl: string } | null>
  loggedIn: boolean
  dirty: boolean
  savedDesignsCount: number
  onOpenDesigns: () => void
  onBeforeLogin: () => Promise<string | null>
  onNextStep: () => void
  pricePerItem?: number
}) {
  // Mobile (BLOCKER-2 condensed-top-bar pass): the wordmark/title/Save/My Designs/
  // Log-in collapse into a ☰ menu below the lg breakpoint; price + Next Step stay
  // always-visible so the checkout path can never be clipped. Desktop is byte-
  // identical — every desktop element is `hidden lg:*` (shows ≥1024 exactly as
  // before) and every mobile element is `lg:hidden` (display:none on desktop).
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <header className="sticky lg:relative top-0 lg:top-auto z-30 lg:z-auto flex items-center px-6 h-14 bg-white border-b border-gray-200 shrink-0">
      {/* Mobile ☰ (never on desktop) */}
      <button
        type="button"
        onClick={() => setMenuOpen(o => !o)}
        aria-label="Menu"
        aria-expanded={menuOpen}
        className="lg:hidden -ml-2 mr-1 flex h-9 w-9 items-center justify-center rounded text-gray-800 hover:bg-gray-100"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 5h14M3 10h14M3 15h14" />
        </svg>
      </button>

      {/* Desktop wordmark + centered title (hidden on mobile). Equal-width flex-1
          sides keep the title centered on desktop, exactly as before. */}
      <div className="hidden lg:block flex-1 min-w-0 font-black text-xl tracking-widest">
        TEE<span className="text-[#dd3333]">STUDIO</span>
      </div>
      <div className="hidden lg:block text-sm text-gray-800 truncate max-w-xs text-center px-4">{productTitle}</div>

      <div className="flex-1 min-w-0 flex items-center justify-end gap-3">
        {/* Desktop-only controls — these live in the ☰ menu on mobile */}
        <div className="hidden lg:flex items-center gap-3">
          <SaveDesignControl onSave={onSave} loggedIn={loggedIn} dirty={dirty} />
          <button
            onClick={onOpenDesigns}
            className="px-3 py-1.5 rounded text-sm text-gray-600 hover:text-[#dd3333] transition-colors whitespace-nowrap"
          >
            My Designs{savedDesignsCount > 0 ? ` (${savedDesignsCount})` : ''}
          </button>
          <CustomerAuthButton variant="quiet" onBeforeLogin={onBeforeLogin} />
        </div>
        {/* Always visible: folded-in price (neutral — info, not action) + Next Step */}
        {pricePerItem != null && (
          <span className="text-sm font-bold text-gray-900 whitespace-nowrap tabular-nums">
            ${pricePerItem.toFixed(2)} <span className="font-normal text-gray-500">each</span>
          </span>
        )}
        <button
          onClick={onNextStep}
          data-cart-btn
          className="bg-[#dd3333] text-white px-5 py-2 rounded text-sm font-bold tracking-wide hover:opacity-80 transition-opacity">
          Next Step →
        </button>
      </div>

      {/* Mobile ☰ menu (lg:hidden). Full-screen backdrop closes it on tap. */}
      {menuOpen && (
        <>
          <div className="lg:hidden fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="lg:hidden absolute left-4 top-14 z-50 w-60 rounded-lg border border-gray-200 bg-white py-2 shadow-lg">
            <p className="truncate border-b border-gray-100 px-4 pb-2 pt-1 font-mono text-xs text-gray-500">{productTitle || 'Your design'}</p>
            <div className="px-4 py-2" onClick={() => setMenuOpen(false)}>
              <SaveDesignControl onSave={onSave} loggedIn={loggedIn} dirty={dirty} />
            </div>
            <button
              onClick={() => { onOpenDesigns(); setMenuOpen(false) }}
              className="block w-full px-4 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
            >
              My Designs{savedDesignsCount > 0 ? ` (${savedDesignsCount})` : ''}
            </button>
            <div className="px-4 py-2" onClick={() => setMenuOpen(false)}>
              <CustomerAuthButton variant="quiet" onBeforeLogin={onBeforeLogin} />
            </div>
          </div>
        </>
      )}
    </header>
  )
}
