'use client'

import { useT } from './StringsProvider'

// Stepper — the shared 3-phase progress strip: Build It → Order It → Pick Up /
// Ship. Rendered as a slim strip UNDER the top bar on BOTH the designer
// (current=1) and the order page (current=2). Step 3 (Pick Up / Ship) is the
// Shopify checkout — external, so it's always the muted "upcoming" preview and
// never clickable; it's kept to set the pickup/ship expectation up front.
//
// RED-VOCAB (locked): the ACTIVE step is a QUIET dark treatment, never red — red
// stays for the action buttons (Next Step / Add to Cart). This replaced the order
// page's old inline "1. DESIGN → 2. QUANTITY & SIZES → 3. REVIEW" indicator, which
// had off-spec labels AND a red active step.
//
// Completed steps are clickable-BACK (step 1 → editHref = the designer); forward
// movement stays on the real buttons, which carry the save/validation.
const STEPS = ['Build It', 'Order It', 'Pick Up / Ship']

export default function Stepper({
  current,
  editHref,
}: {
  current: 1 | 2 | 3
  editHref?: string
}) {
  const t = useT()
  return (
    <nav aria-label={t('designer.stepper_aria', 'Progress')} className="flex items-center justify-center bg-white border-b border-gray-200 px-6 py-2.5">
      {STEPS.map((label, i) => {
        const n = i + 1
        const state = n < current ? 'done' : n === current ? 'active' : 'upcoming'
        // Only a completed step 1 links back (to the designer); step 3 is external.
        const href = state === 'done' && n === 1 ? editHref : undefined
        const content = (
          <span className="flex items-center gap-1.5">
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
              state === 'upcoming' ? 'border border-gray-300 text-gray-400' : 'bg-gray-900 text-white'
            }`}>
              {state === 'done' ? '✓' : n}
            </span>
            <span className={`text-xs font-mono ${
              state === 'active' ? 'text-gray-900 font-bold'
                : state === 'done' ? 'text-gray-600'
                : 'text-gray-400'
            }`}>
              {t(`designer.stepper_${n}`, label)}
            </span>
          </span>
        )
        return (
          <div key={label} className="flex items-center">
            {i > 0 && <div className={`mx-2 h-px w-6 sm:mx-3 sm:w-10 ${n <= current ? 'bg-gray-400' : 'bg-gray-200'}`} />}
            {href ? (
              <a href={href} title={t('designer.stepper_back', 'Back to the designer')} className="rounded transition-opacity hover:opacity-70">
                {content}
              </a>
            ) : content}
          </div>
        )
      })}
    </nav>
  )
}
