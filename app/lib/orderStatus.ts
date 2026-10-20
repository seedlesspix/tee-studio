// Admin display status for a design_orders row. A Shopify cancellation does NOT change the stored status
// (the row stays 'completed' = paid, so every rule keyed on 'completed' — admin-only access, no cart link,
// not re-orderable — keeps applying); it stamps cancelled_at + cancel_reason. The admin DERIVES the label.
export type DisplayStatusKey = 'draft' | 'ordering' | 'cart_created' | 'completed' | 'cancelled'

export function displayStatusKey(o: { status?: string | null; cancelled_at?: string | null }): DisplayStatusKey {
  if (o.cancelled_at) return 'cancelled'
  const s = o.status ?? 'draft'
  return (['draft', 'ordering', 'cart_created', 'completed'] as readonly string[]).includes(s) ? (s as DisplayStatusKey) : 'draft'
}

// Shopify's cancel_reason values → plain words for staff.
export const CANCEL_REASON_LABELS: Record<string, string> = {
  customer: 'customer changed their mind',
  fraud: 'fraudulent order',
  inventory: 'items unavailable',
  declined: 'payment declined',
  staff: 'staff error',
  other: 'other',
}
export const cancelReasonLabel = (r: string | null | undefined) => (r ? CANCEL_REASON_LABELS[r] ?? r : 'no reason given')
