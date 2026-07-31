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
  return (
    <header className="flex items-center px-6 h-14 bg-white border-b border-gray-200 shrink-0">
      {/* Equal-width flex-1 sides push the title to the header's TRUE center
          (was justify-between, which parked it left-of-center since the right
          cluster is wider than the wordmark). Flex, not absolute — so it centers
          without ever overlapping the sides. */}
      <div className="flex-1 min-w-0 font-black text-xl tracking-widest">
        TEE<span className="text-[#dd3333]">STUDIO</span>
      </div>
      <div className="text-sm text-gray-800 truncate max-w-xs text-center px-4">{productTitle}</div>
      <div className="flex-1 min-w-0 flex items-center justify-end gap-3">
        <SaveDesignControl onSave={onSave} loggedIn={loggedIn} dirty={dirty} />
        <button
          onClick={onOpenDesigns}
          className="px-3 py-1.5 rounded text-sm text-gray-600 hover:text-[#dd3333] transition-colors whitespace-nowrap"
        >
          My Designs{savedDesignsCount > 0 ? ` (${savedDesignsCount})` : ''}
        </button>
        <CustomerAuthButton variant="quiet" onBeforeLogin={onBeforeLogin} />
        {/* Folded-in price — live per-item cost (blank + print charges), shown
            just left of Next Step. NEUTRAL: a price is info, not an action. */}
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
    </header>
  )
}
