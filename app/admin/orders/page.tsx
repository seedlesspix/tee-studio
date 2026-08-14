'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Tables } from '@/types/database'
import { useT } from '../../components/StringsProvider'
import { orderZones, zoneLabel } from '../../lib/zones'

// The full Shopify address shape as captured verbatim by the webhook (both
// billing_address and shipping_address). We surface ALL of it for the print
// shop — data we already hold costs nothing to show.
type Address = {
  first_name?: string
  last_name?: string
  name?: string
  company?: string
  address1?: string
  address2?: string
  city?: string
  province?: string
  province_code?: string
  zip?: string
  country?: string
  country_code?: string
  phone?: string
}

type UploadedFile = {
  name: string
  type: string
  /** The display rendition — for AI/PSD/EPS/PDF this is a flattened PNG. */
  url: string
  /** The file the customer actually uploaded, when it differs from `url`.
   *  Absent on plain photo uploads, where `url` already IS the original. */
  originalUrl?: string
  originalFormat?: string
}

// One entry from the order's captured shipping_lines. `title` is the
// customer-facing method: a pickup LOCATION ("Bucktown") or a carrier
// ("UPS® Ground"). Captured verbatim by the webhook.
type ShippingLine = {
  title?: string
  code?: string
  source?: string
}

type DecalUsed = { number: number; name: string }

type Order = Omit<Tables<'design_orders'>, 'quantities' | 'uploaded_files' | 'shipping_address' | 'billing_address' | 'shipping_lines' | 'decals_used'> & {
  quantities: Record<string, number> | null
  uploaded_files: UploadedFile[] | null
  shipping_address: Address | null
  billing_address: Address | null
  shipping_lines: ShippingLine[] | null
  decals_used: DecalUsed[] | null
}

// Pickup vs ship, derived from REAL order data (verified against #17036 pickup
// / #17035 ship, 2026-07-28):
//   - a pickup order has a shipping_line but NO shipping_address (nothing to
//     ship) — its title is the pickup location;
//   - a ship order has a shipping_address — its title is the carrier.
// shipping_address presence is the semantic discriminator (not the title
// string). Legacy orders captured before shipping_lines existed return null
// here → no badge, never a wrong one.
type Fulfillment = { isPickup: boolean; method: string }
function fulfillmentOf(order: Order): Fulfillment | null {
  const lines = order.shipping_lines
  if (!lines || lines.length === 0) return null
  const method = lines.map(l => l.title).filter(Boolean).join(', ')
  const hasShipTo = !!(order.shipping_address && (order.shipping_address.address1 || order.shipping_address.zip))
  return { isPickup: !hasShipTo, method: method || (hasShipTo ? 'Shipping' : 'Pickup') }
}

// Render a captured address as the print shop needs to read it: recipient name,
// company, both street lines, city/state/zip, country, phone — skipping only
// the fields Shopify didn't send (no guessing, no empty lines).
function AddressBlock({ label, addr }: { label: string; addr: Address }) {
  const recipient = addr.name || [addr.first_name, addr.last_name].filter(Boolean).join(' ')
  const cityLine = [addr.city, [addr.province_code || addr.province, addr.zip].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ')
  return (
    <div className="mt-1 pt-2 border-t border-gray-200">
      <p className="text-gray-600 text-xs mb-1">{label}</p>
      <p className="text-xs text-black leading-relaxed">
        {recipient && <>{recipient}<br /></>}
        {addr.company && <>{addr.company}<br /></>}
        {addr.address1 && <>{addr.address1}<br /></>}
        {addr.address2 && <>{addr.address2}<br /></>}
        {cityLine && <>{cityLine}<br /></>}
        {addr.country && <>{addr.country}<br /></>}
        {addr.phone && <span className="text-gray-600">tel {addr.phone}</span>}
      </p>
    </div>
  )
}

// Phase 4 grouping fix: one Shopify order can hold SEVERAL designs (mixed
// carts) — the webhook stamps every design row with the shared order number.
// The print shop reads "one order, pack together", so rows sharing a
// shopify_order_number render as ONE entry with nested design sections.
// Rows without an order number (drafts / in-cart) stay individual.
type OrderGroup = {
  key: string
  orderNumber: string | null
  rows: Order[]
}

// The soonest (earliest) desired-by date across a group's designs, or null if none set (BETA #30).
const groupDesiredBy = (g: OrderGroup): string | null =>
  g.rows.reduce<string | null>((m, r) => {
    const d = r.desired_by
    if (!d) return m
    return !m || d < m ? d : m
  }, null)

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-200 text-gray-800',
  ordering: 'bg-blue-100 text-blue-800',
  cart_created: 'bg-orange-100 text-orange-800',
  completed: 'bg-green-100 text-green-800',
}

// DISPLAY-ONLY label for the stored status. The stored value 'completed'
// fires at PAYMENT (webhook), before anything is printed — showing staff
// "Completed" would falsely read as "made and done", so the pill shows
// "Paid". The underlying status value is unchanged and every status check
// (readback rules, filters, cart-link gate, webhook) still keys off the real
// stored strings — this only maps stored → shown text.
const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  ordering: 'Ordering',
  cart_created: 'In Cart',
  completed: 'Paid',
}
const statusLabel = (status: string | null) =>
  STATUS_LABELS[status ?? 'draft'] ?? status ?? 'Draft'

export default function OrdersAdmin() {
  const t = useT()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<'newest' | 'desired'>('newest') // BETA #30: newest ⇄ soonest desired-by
  const [deleting, setDeleting] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('design_orders')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setOrders(data as Order[])
        setLoading(false)
      })
  }, [])

  const rowMatches = (o: Order) => {
    const matchStatus = filter === 'all' || o.status === filter
    const q = search.toLowerCase()
    const matchSearch = !search ||
      (o.product_title?.toLowerCase().includes(q) ?? false) ||
      (o.selected_color?.toLowerCase().includes(q) ?? false) ||
      (o.customer_name?.toLowerCase().includes(q) ?? false) ||
      (o.customer_email?.toLowerCase().includes(q) ?? false) ||
      (o.shopify_order_number?.includes(search) ?? false) ||
      o.id.includes(search)
    return matchStatus && matchSearch
  }

  // Group rows by shopify_order_number (designs within a group oldest-first so
  // "Design 1 / Design 2" numbering is stable); groups sort newest-first.
  const groups: OrderGroup[] = (() => {
    const byNumber = new Map<string, Order[]>()
    const singles: OrderGroup[] = []
    for (const o of orders) {
      if (o.shopify_order_number) {
        const arr = byNumber.get(o.shopify_order_number) ?? []
        arr.push(o)
        byNumber.set(o.shopify_order_number, arr)
      } else {
        singles.push({ key: o.id, orderNumber: null, rows: [o] })
      }
    }
    const numbered: OrderGroup[] = [...byNumber.entries()].map(([num, rows]) => ({
      key: `order-${num}`,
      orderNumber: num,
      rows: [...rows].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '')),
    }))
    const newest = (g: OrderGroup) =>
      g.rows.reduce((m, r) => ((r.created_at ?? '') > m ? (r.created_at ?? '') : m), '')
    const all = [...numbered, ...singles]
    if (sortMode === 'desired') {
      // Soonest desired-by first; orders with NO desired-by fall to the bottom (newest-first among them).
      return all.sort((a, b) => {
        const da = groupDesiredBy(a), db = groupDesiredBy(b)
        if (da && db) return da.localeCompare(db)
        if (da) return -1
        if (db) return 1
        return newest(b).localeCompare(newest(a))
      })
    }
    return all.sort((a, b) => newest(b).localeCompare(newest(a)))
  })()

  // A group shows when ANY of its designs matches — the print shop always
  // sees the whole order, never a fragment of one.
  const filteredGroups = groups.filter(g => g.rows.some(rowMatches))
  const selected = filteredGroups.find(g => g.key === selectedKey) ?? null

  const formatDate = (str: string | null) => {
    if (!str) return ''
    const d = new Date(str)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const money = (n: number) => `$${n.toFixed(2)}`
  const groupTotal = (g: OrderGroup) => g.rows.reduce((s, r) => s + Number(r.total_price ?? 0), 0)
  const groupQty = (g: OrderGroup) => g.rows.reduce((s, r) => s + (r.total_qty ?? 0), 0)

  // Download a file (still used by the customer-uploads / originals section below; the design-preview
  // PNG/SVG and per-side cut-file quick-grabs were removed for beta — item 29).
  const downloadFile = async (url: string, filename: string) => {
    setDownloading(filename)
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(a.href)
    } catch {
      alert('Download failed. Try again.')
    }
    setDownloading(null)
  }

  // Delete an entire order group (all designs sharing the order number, or a single draft). Admins are
  // authorized by the design_orders_admin_all RLS policy. ⚠ design_orders → saved_designs is ON DELETE
  // CASCADE, so this also removes any customer "My Designs" library entry for these rows — the confirm
  // spells that out. Drafts especially are safe to clear; completed orders are kept for records unless
  // deliberately removed.
  const deleteOrder = async (group: OrderGroup) => {
    const ids = group.rows.map(r => r.id)
    const label = group.orderNumber ? `Order #${group.orderNumber}` : 'this draft order'
    const n = ids.length
    // Guard the saved_designs cascade: check (via an admin route — saved_designs is service-role-only)
    // whether any of these rows back a customer's "My Designs" entry. If so, warn SPECIFICALLY (deleting
    // destroys their saved work); if verified none, don't cry wolf; if the check fails, fall back to the
    // generic caution.
    let savedCount: number | null = null
    try {
      const res = await fetch('/api/admin/orders/saved-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
      })
      if (res.ok) savedCount = (await res.json()).savedCount ?? 0
    } catch { /* leave null → generic caution */ }
    const savedWarn =
      savedCount === null
        ? `\n\nIf a customer saved any of these to "My Designs", that saved entry is removed too.`
        : savedCount > 0
          ? `\n\n🚨 ${savedCount} of these ${savedCount > 1 ? "are customers'" : "is a customer's"} SAVED design${savedCount > 1 ? 's' : ''} (My Designs) — deleting will PERMANENTLY DESTROY their saved work.`
          : ''
    if (!confirm(
      `Permanently delete ${label} (${n} design${n > 1 ? 's' : ''})?${savedWarn}\n\n` +
      `This cannot be undone.`
    )) return
    setDeleting(true)
    const { error } = await supabase.from('design_orders').delete().in('id', ids)
    setDeleting(false)
    if (error) { alert('Delete failed: ' + error.message); return }
    setOrders(prev => prev.filter(o => !ids.includes(o.id)))
    setSelectedKey(null)
  }

  const orderCounts = {
    all: orders.length,
    completed: orders.filter(o => o.status === 'completed').length,
    cart_created: orders.filter(o => o.status === 'cart_created').length,
    draft: orders.filter(o => o.status === 'draft').length,
  }

  return (
    <div className="flex h-[calc(100vh-56px)]" style={{ fontFamily: 'DM Sans, sans-serif' }}>
      {/* Left: Orders List */}
      <div className="w-[400px] shrink-0 border-r border-gray-200 flex flex-col bg-white">
        <div className="p-4 border-b border-gray-200 flex flex-col gap-3">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email, order #..."
            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-black outline-none focus:border-[#dd3333] font-mono placeholder-gray-400" />
          <div className="flex gap-1 flex-wrap">
            {[
              { key: 'all', label: `All (${orderCounts.all})` },
              { key: 'completed', label: `Paid (${orderCounts.completed})` },
              { key: 'cart_created', label: `In Cart (${orderCounts.cart_created})` },
              { key: 'draft', label: `Draft (${orderCounts.draft})` },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setFilter(key)}
                className={`px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wide transition-all border ${
                  filter === key
                    ? 'bg-[#dd3333] text-white font-bold border-[#dd3333]'
                    : 'bg-white text-black hover:bg-gray-100 border-gray-300'
                }`}>
                {label}
              </button>
            ))}
          </div>
          {/* Sort toggle (BETA #30) — newest vs soonest desired-by, for scheduling. */}
          <div className="flex gap-1">
            {([['newest', 'Newest'], ['desired', 'Desired by ↑']] as const).map(([key, label]) => (
              <button key={key} onClick={() => setSortMode(key)}
                className={`px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wide transition-all border ${
                  sortMode === key
                    ? 'bg-gray-900 text-white font-bold border-gray-900'
                    : 'bg-white text-black hover:bg-gray-100 border-gray-300'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-gray-500 font-mono text-sm">Loading...</div>
          ) : filteredGroups.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-500 font-mono text-sm">No orders found</div>
          ) : filteredGroups.map(group => {
            const first = group.rows[0]
            const multi = group.rows.length > 1
            return (
              <div key={group.key} onClick={() => setSelectedKey(group.key)}
                className={`flex gap-3 p-4 border-b border-gray-100 cursor-pointer transition-all hover:bg-gray-50 ${
                  selectedKey === group.key ? 'bg-gray-50 border-l-2 border-l-[#dd3333]' : ''
                }`}>
                {/* Thumbnails: up to two designs peek; more get a count badge */}
                <div className="relative w-14 h-14 shrink-0">
                  {group.rows.slice(0, 2).map((r, i) => (
                    <div key={r.id}
                      className={`absolute w-12 h-12 rounded-lg overflow-hidden bg-gray-100 border border-gray-200 ${
                        i === 0 ? 'top-0 left-0 z-10' : 'bottom-0 right-0'
                      }`}>
                      {(r.canvas_png_front || r.canvas_png_back) ? (
                        <img src={r.canvas_png_front || r.canvas_png_back!} alt="Design" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400 text-[8px] font-mono">No preview</div>
                      )}
                    </div>
                  ))}
                  {group.rows.length > 2 && (
                    <span className="absolute -bottom-1 -right-1 z-20 bg-[#dd3333] text-white text-[9px] font-mono rounded-full px-1.5 py-0.5">
                      +{group.rows.length - 2}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    {group.orderNumber ? (
                      <span className="text-xs font-black text-[#dd3333]">
                        #{group.orderNumber}
                        {multi && <span className="ml-1 font-mono font-normal text-gray-600">· {group.rows.length} designs</span>}
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono text-gray-500">{first.id.split('-')[0]}...</span>
                    )}
                    <div className="flex items-center gap-1 shrink-0">
                      {(() => {
                        const lf = fulfillmentOf(first)
                        return lf ? (
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase font-bold ${
                            lf.isPickup ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                          }`}>
                            {lf.isPickup ? 'pickup' : 'ship'}
                          </span>
                        ) : null
                      })()}
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase ${STATUS_COLORS[first.status ?? 'draft'] || 'bg-gray-200 text-gray-800'}`}>
                        {statusLabel(first.status)}
                      </span>
                    </div>
                  </div>
                  {first.customer_name && (
                    <p className="text-sm font-medium text-black truncate">{first.customer_name}</p>
                  )}
                  {first.customer_email && (
                    <p className="text-xs text-gray-600 truncate">{first.customer_email}</p>
                  )}
                  {!first.customer_name && (
                    <p className="text-sm text-black truncate">
                      {multi ? group.rows.map(r => r.product_title).join(' · ') : first.product_title}
                    </p>
                  )}
                  {groupDesiredBy(group) && (
                    <div className="mt-1">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-100 text-amber-800">
                        ⏰ {t('admin.desired_by_label', 'Desired by')} {new Date(groupDesiredBy(group) + 'T00:00:00').toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-[10px] text-gray-500 font-mono">{formatDate(first.created_at)}</span>
                    <span className="text-sm font-bold text-black">{money(groupTotal(group))}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Right: Order Detail */}
      <div className="flex-1 overflow-y-auto bg-white">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 font-mono">
            <div className="text-5xl mb-3">👕</div>
            <p className="text-sm">Select an order to view details</p>
          </div>
        ) : (() => {
          const first = selected.rows[0]
          const multi = selected.rows.length > 1
          const fulfillment = fulfillmentOf(first)
          return (
            <div className="p-6 flex flex-col gap-5 max-w-4xl">
              {/* Order header — once per ORDER, not per design */}
              <div className="flex items-start justify-between">
                <div>
                  {selected.orderNumber ? (
                    <h2 className="text-2xl font-black text-black">
                      Order #{selected.orderNumber}
                      {multi && <span className="ml-2 text-base font-bold text-gray-600">— {selected.rows.length} designs, pack together</span>}
                    </h2>
                  ) : (
                    <h2 className="text-xl font-bold text-black">Draft Order</h2>
                  )}
                  {!multi && <p className="text-xs font-mono text-gray-600 mt-0.5">{first.id}</p>}
                  {first.shopify_order_id && (
                    <p className="text-xs font-mono text-gray-500 mt-0.5">Shopify order {first.shopify_order_id}</p>
                  )}
                  <p className="text-xs text-gray-500 mt-0.5">{formatDate(first.created_at)}</p>
                </div>
                <div className="flex gap-2 items-center">
                  {/* Fulfillment badge — the first thing the team needs on a
                      pickup-heavy shop. Purple = PICKUP, blue = SHIP. */}
                  {fulfillment && (
                    <span className={`px-3 py-1.5 rounded-full text-xs font-mono uppercase font-black ${
                      fulfillment.isPickup ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white'
                    }`}>
                      {fulfillment.isPickup ? '🏬 Pickup' : '📦 Ship'}
                    </span>
                  )}
                  <span className={`px-3 py-1.5 rounded-full text-xs font-mono uppercase font-bold ${STATUS_COLORS[first.status ?? 'draft'] || 'bg-gray-200 text-gray-800'}`}>
                    {statusLabel(first.status)}
                  </span>
                  {first.shopify_cart_url && first.status !== 'completed' && (
                    <a href={first.shopify_cart_url} target="_blank" rel="noreferrer"
                      className="px-3 py-1.5 rounded-full text-xs font-mono bg-[#dd3333] text-white hover:bg-red-700 transition-all">
                      View Cart ↗
                    </a>
                  )}
                  {/* Delete this order (all its designs). Destructive → a true red action. */}
                  <button onClick={() => deleteOrder(selected)} disabled={deleting}
                    title="Delete this order"
                    className="px-3 py-1.5 rounded-full text-xs font-mono border border-red-300 text-red-600 hover:bg-red-50 hover:border-red-500 transition-all disabled:opacity-40">
                    {deleting ? 'Deleting…' : '🗑 Delete'}
                  </button>
                </div>
              </div>

              {/* Customer + Order totals side by side */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <p className="text-xs font-mono text-gray-600 uppercase tracking-widest mb-3">Customer</p>
                  {first.customer_name || first.customer_email ? (
                    <div className="flex flex-col gap-2 text-sm text-black">
                      {first.customer_name && (
                        <div className="flex justify-between"><span className="text-gray-600">Name</span><span className="font-medium">{first.customer_name}</span></div>
                      )}
                      {first.customer_email && (
                        <div className="flex justify-between"><span className="text-gray-600">Email</span>
                          <a href={`mailto:${first.customer_email}`} className="text-[#dd3333] hover:underline">{first.customer_email}</a>
                        </div>
                      )}
                      {first.customer_phone && (
                        <div className="flex justify-between"><span className="text-gray-600">Phone</span><span>{first.customer_phone}</span></div>
                      )}
                      {fulfillment && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">{fulfillment.isPickup ? 'Pickup at' : 'Ship via'}</span>
                          <span className="font-semibold">{fulfillment.method}</span>
                        </div>
                      )}
                      {first.shipping_address && <AddressBlock label="Ship to" addr={first.shipping_address} />}
                      {first.billing_address && <AddressBlock label="Bill to" addr={first.billing_address} />}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 italic">No customer info yet — order not completed</p>
                  )}
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <p className="text-xs font-mono text-gray-600 uppercase tracking-widest mb-3">Order Total</p>
                  <div className="flex flex-col gap-2 text-sm text-black">
                    {selected.rows.map((r, i) => (
                      <div key={r.id} className="flex justify-between">
                        <span className="text-gray-600 truncate">{multi ? `${i + 1}. ` : ''}{r.product_title} ({r.total_qty ?? 0})</span>
                        <span className="shrink-0">{money(Number(r.total_price ?? 0))}</span>
                      </div>
                    ))}
                    <div className="border-t border-gray-200 pt-2 flex justify-between font-bold">
                      <span className="text-black">Total ({groupQty(selected)} items)</span>
                      <span className="text-[#dd3333]">{money(groupTotal(selected))}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* One section per design */}
              {selected.rows.map((row, i) => {
                return (
                  <div key={row.id} className={multi ? 'border border-gray-300 rounded-2xl p-4 flex flex-col gap-4' : 'flex flex-col gap-5'}>
                    {multi && (
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-black text-black uppercase tracking-wide">
                          Design {i + 1} — {row.product_title}
                        </h3>
                        <span className="text-[10px] font-mono text-gray-500">{row.id}</span>
                      </div>
                    )}

                    {/* Product summary */}
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                      <p className="text-xs font-mono text-gray-600 uppercase tracking-widest mb-3">{multi ? 'Design Summary' : 'Order Summary'}</p>
                      <div className="flex flex-col gap-2 text-sm text-black">
                        <div className="flex justify-between"><span className="text-gray-600">Product</span><span className="text-right text-xs">{row.product_title}</span></div>
                        <div className="flex justify-between"><span className="text-gray-600">Color</span><span>{row.selected_color}</span></div>
                        <div className="flex justify-between"><span className="text-gray-600">Print</span><span>{(() => { const mk = 'method.' + (row.print_method || 'screen_print'); const s = t(mk); return s === mk ? (row.print_method || '').replace('_', ' ') : s })()}</span></div>
                        <div className="flex justify-between"><span className="text-gray-600">Sides</span><span>{row.sides_designed}</span></div>
                        {row.desired_by && (
                          <div className="flex justify-between font-bold text-amber-800"><span>⏰ {t('admin.desired_by_label', 'Desired by')}</span><span>{new Date(row.desired_by + 'T00:00:00').toLocaleDateString()}</span></div>
                        )}
                        {row.design_acknowledged_at && (
                          <div className="flex justify-between text-emerald-700"><span>✓ {t('admin.acknowledged_label', 'Design acknowledged')}</span><span>{new Date(row.design_acknowledged_at).toLocaleString()}</span></div>
                        )}
                        <div className="border-t border-gray-200 pt-2 flex justify-between"><span className="text-gray-600">Blank + Print</span><span>${row.unit_price} + ${row.print_charge}</span></div>
                        <div className="flex justify-between font-bold"><span className="text-black">Total ({row.total_qty} items)</span><span className="text-[#dd3333]">${row.total_price}</span></div>
                      </div>
                    </div>

                    {/* Design Notes (customer printing instructions) */}
                    {row.notes && (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                        <p className="text-xs font-mono text-gray-600 uppercase tracking-widest mb-2">{t('admin.design_notes_heading', 'Design Notes')}</p>
                        <p className="text-sm text-black whitespace-pre-wrap">{row.notes}</p>
                      </div>
                    )}

                    {/* Sizes */}
                    {row.quantities && Object.values(row.quantities).some(v => v > 0) && (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                        <p className="text-xs font-mono text-gray-600 uppercase tracking-widest mb-3">Sizes</p>
                        <div className="flex gap-3 flex-wrap">
                          {Object.entries(row.quantities).filter(([, qty]) => qty > 0).map(([size, qty]) => (
                            <div key={size} className="bg-white border border-gray-200 rounded-lg px-4 py-2 text-center min-w-[60px]">
                              <p className="text-xs font-mono text-gray-600">{size}</p>
                              <p className="text-2xl font-black text-[#dd3333]">{qty}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Design Files */}
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                      <p className="text-xs font-mono text-gray-600 uppercase tracking-widest mb-4">Design Files</p>
                      <div className="grid grid-cols-2 gap-4">
                        {row.canvas_png_front && (
                          <div>
                            <p className="text-xs font-mono text-gray-600 mb-2">FRONT PREVIEW</p>
                            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                              <img src={row.canvas_png_front} alt="Front" className="w-full object-contain max-h-64" />
                            </div>
                          </div>
                        )}
                        {row.canvas_png_back && (
                          <div>
                            <p className="text-xs font-mono text-gray-600 mb-2">BACK PREVIEW</p>
                            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                              <img src={row.canvas_png_back} alt="Back" className="w-full object-contain max-h-64" />
                            </div>
                          </div>
                        )}
                        {/* Print Zones: extra-zone previews (sleeves/hat) from the zones jsonb. */}
                        {(() => {
                          const zm = (row.zones && typeof row.zones === 'object' && !Array.isArray(row.zones))
                            ? (row.zones as Record<string, { canvas_png?: string | null }>) : {}
                          return orderZones(Object.keys(zm)).filter(z => z !== 'front' && z !== 'back').map(z => {
                            const png = zm[z]?.canvas_png
                            return png ? (
                              <div key={z}>
                                <p className="text-xs font-mono text-gray-600 mb-2">{zoneLabel(z).toUpperCase()} PREVIEW</p>
                                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                                  <img src={png} alt={zoneLabel(z)} className="w-full object-contain max-h-64" />
                                </div>
                              </div>
                            ) : null
                          })
                        })()}
                      </div>

                      {/* Production bundle (Stage 3) — ONE ZIP with everything the print shop
                          needs for this order: the outlined cut file per side (true physical
                          size, colors as named layers), the placed uploads + untouched
                          originals, and a MANIFEST. Generated fresh on download (nothing
                          stored, always reproducible). Cookie-authed GET → plain link, no JS.
                          Red = primary action (get everything); the per-side links below are
                          the secondary "one piece at a time" option. */}
                      {(row.canvas_png_front || row.canvas_png_back || (row.uploaded_files && row.uploaded_files.length > 0)) && (
                        <div className="mt-4 pt-3 border-t border-gray-200">
                          <p className="text-xs font-mono text-gray-600 mb-2">PRODUCTION BUNDLE</p>
                          <a href={`/api/admin/production-bundle?order=${row.id}`}
                            className="block w-full py-2 rounded text-xs font-mono bg-[#dd3333] text-white hover:bg-[#c02020] transition-all text-center">
                            ⬇ Download production bundle (.zip)
                          </a>
                          <p className="text-[10px] text-gray-500 mt-1">OrderInfo · Cut Files (normal + mirrored) · Layout · Previews · Originals</p>
                        </div>
                      )}

                      {/* Item 29 (beta): the individual PNG/SVG + per-side cut-file quick-grabs were
                          removed — the Production Bundle above is the single source for beta so the
                          bench can't grab a stale/partial piece. Bring one back deliberately if the
                          team misses it. (The /api/admin/cut-file route still exists, just unlinked.) */}
                    </div>

                    {/* Customer uploaded files */}
                    {row.uploaded_files && row.uploaded_files.length > 0 && (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                        <p className="text-xs font-mono text-gray-600 uppercase tracking-widest mb-3">Customer Uploaded Files</p>
                        <div className="flex flex-col gap-2">
                          {row.uploaded_files.map((f, j) => (
                            <div key={j} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="text-lg">📎</span>
                                <div>
                                  <p className="text-sm font-mono text-black">{f.name}</p>
                                  <p className="text-xs text-gray-600">
                                    {f.originalUrl
                                      ? `${f.originalFormat?.toUpperCase() || 'original'} — preview is a flattened PNG`
                                      : f.type}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {/* Vector/PDF uploads are flattened for the canvas. The print
                                    shop needs the file the customer actually gave us, so when
                                    an original exists it's the PRIMARY action. */}
                                {f.originalUrl && (
                                  <button onClick={() => downloadFile(f.originalUrl!, f.name)}
                                    className="px-3 py-1.5 rounded text-xs font-mono bg-[#dd3333] text-white hover:bg-red-700 transition-all whitespace-nowrap">
                                    {downloading === f.name ? 'Downloading...' : `↓ Original${f.originalFormat ? ` (.${f.originalFormat})` : ''}`}
                                  </button>
                                )}
                                <button onClick={() => downloadFile(f.url, f.originalUrl ? `${f.name}.png` : f.name)}
                                  className={`px-3 py-1.5 rounded text-xs font-mono transition-all whitespace-nowrap ${
                                    f.originalUrl
                                      ? 'bg-white text-gray-800 border border-gray-300 hover:border-[#dd3333]'
                                      : 'bg-[#dd3333] text-white hover:bg-red-700'
                                  }`}>
                                  {f.originalUrl ? '↓ PNG' : (downloading === f.name ? 'Downloading...' : '↓ Download')}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Decals used (Designs section) — sell-through record + print-shop reference. */}
                    {row.decals_used && row.decals_used.length > 0 && (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                        <p className="text-xs font-mono text-gray-600 uppercase tracking-widest mb-3">{t('admin.designs_used')}</p>
                        <div className="flex flex-wrap gap-2">
                          {row.decals_used.map((d, j) => (
                            <span key={j} className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
                              <span className="text-xs font-mono font-bold text-emerald-800">#{d.number}</span>
                              <span className="text-xs font-mono text-gray-700">{d.name}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
