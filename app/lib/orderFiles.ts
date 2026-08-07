// Download filename stem for an order's production files: "<orderNumber>-<LastName>" (e.g. "1042-Smith").
// Denise (BETA item 7): order files should be named with the order number AND the customer's name.
// Drafts have neither a Shopify order number nor a customer name yet, so we fall back to a short id.
// Pure + framework-free so it can be unit-tested and shared by the admin page + the file routes.

type OrderNameInput = {
  id?: string | null
  shopify_order_number?: string | null
  customer_name?: string | null
  // Shopify address JSON — the most reliable last-name source when present.
  shipping_address?: unknown
  billing_address?: unknown
}

// Keep only filename-safe characters (letters/digits); drop apostrophes, spaces, accents-as-punctuation.
const fileSafe = (s: string): string => s.replace(/[^A-Za-z0-9]+/g, '')

function addrLastName(a: unknown): string {
  if (a && typeof a === 'object' && 'last_name' in a) {
    const ln = (a as { last_name?: unknown }).last_name
    if (typeof ln === 'string') return ln.trim()
  }
  return ''
}

// The customer's last name for a filename: prefer the structured address last_name; otherwise take the
// LAST token of the stored full name. Returns '' when nothing usable is present (draft / no customer).
export function orderLastName(o: OrderNameInput): string {
  const fromAddr = addrLastName(o.shipping_address) || addrLastName(o.billing_address)
  if (fromAddr) return fileSafe(fromAddr)
  const full = (o.customer_name || '').trim()
  if (!full) return ''
  return fileSafe(full.split(/\s+/).pop() || '')
}

// "<orderNumber>-<LastName>", e.g. "1042-Smith". Falls back to the order number alone when no name is
// known ("1042"), and to a short id for drafts with no order number yet ("2e5b815c" / "2e5b815c-Smith").
export function orderFileStem(o: OrderNameInput): string {
  const num = (o.shopify_order_number ?? '').toString().trim()
  const base = num || (o.id ? o.id.slice(0, 8) : 'order')
  const last = orderLastName(o)
  return last ? `${base}-${last}` : base
}
