'use client'
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
// Phase 2 (sealed target, NOT now): reshape to the "price + Save + Next" bottom
// bar + the Build It → Order It → Pick Up/Ship stepper, and fold in the
// price/order column. Also queued: replace the `data-cart-btn` DOM-mutation with
// an `isSubmitting` prop (deferred so this step is a pure move, not move+change).
export default function ActionBar({
  productTitle,
  onSave,
  loggedIn,
  dirty,
  savedDesignsCount,
  onOpenDesigns,
  onBeforeLogin,
  onNextStep,
}: {
  productTitle: string
  onSave: () => Promise<{ restoreUrl: string } | null>
  loggedIn: boolean
  dirty: boolean
  savedDesignsCount: number
  onOpenDesigns: () => void
  onBeforeLogin: () => Promise<string | null>
  onNextStep: () => void
}) {
  return (
    <header className="flex items-center justify-between px-6 h-14 bg-white border-b border-gray-200 shrink-0">
      <div className="font-black text-xl tracking-widest">
        TEE<span className="text-[#dd3333]">STUDIO</span>
      </div>
      <div className="text-sm text-gray-800 truncate max-w-xs">{productTitle}</div>
      <div className="flex items-center gap-3">
        <SaveDesignControl onSave={onSave} loggedIn={loggedIn} dirty={dirty} />
        <button
          onClick={onOpenDesigns}
          className="px-3 py-1.5 rounded text-sm text-gray-600 hover:text-[#dd3333] transition-colors whitespace-nowrap"
        >
          My Designs{savedDesignsCount > 0 ? ` (${savedDesignsCount})` : ''}
        </button>
        <CustomerAuthButton variant="quiet" onBeforeLogin={onBeforeLogin} />
        <button
          onClick={onNextStep}
          data-cart-btn
          className="bg-[#dd3333] text-white px-5 py-2 rounded text-sm font-bold tracking-wide hover:opacity-80 transition-opacity">
          Next Step →
        </button>
      </div>
    </header>
  )
}
