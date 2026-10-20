// The VISIBLE line item properties a design carries into the Shopify cart (Denise, 2026-10-20): the
// customer's desired-by date and design notes, so staff see them under each design line on the Shopify
// order page / packing slip / confirmation email, and the customer sees them in the cart. PURE + tested.
// Per LINE on purpose: a cart holding two designs with different dates shows each under its own product
// (a cart attribute would be one value per cart, with "earliest" math and staleness on line removal).

export const DESIRED_BY_PROPERTY = 'Desired by'
export const DESIGN_NOTES_PROPERTY = 'Design notes'
export const NOTES_PROPERTY_MAX = 500 // the full text stays on design_orders.notes; the cart line gets a readable excerpt

// 'YYYY-MM-DD' → 'Sat, Nov 1, 2026' (built from parts, so no timezone shift). Anything else → null.
export function formatDesiredBy(iso: string | null | undefined): string | null {
  const m = typeof iso === 'string' ? iso.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(d.getTime()) || d.getDate() !== Number(m[3])) return null
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export function visibleLineProps(input: { desiredBy?: string | null; notes?: string | null }): Record<string, string> {
  const props: Record<string, string> = {}
  const date = formatDesiredBy(input.desiredBy)
  if (date) props[DESIRED_BY_PROPERTY] = date
  const notes = (input.notes ?? '').replace(/\s+/g, ' ').trim()
  if (notes) props[DESIGN_NOTES_PROPERTY] = notes.length > NOTES_PROPERTY_MAX ? notes.slice(0, NOTES_PROPERTY_MAX - 1).trimEnd() + '…' : notes
  return props
}
