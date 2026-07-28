'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Tables } from '@/types/database'

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

type Order = Omit<Tables<'design_orders'>, 'quantities' | 'uploaded_files' | 'shipping_address' | 'billing_address'> & {
  quantities: Record<string, number> | null
  uploaded_files: UploadedFile[] | null
  shipping_address: Address | null
  billing_address: Address | null
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

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-200 text-gray-800',
  ordering: 'bg-blue-100 text-blue-800',
  cart_created: 'bg-orange-100 text-orange-800',
  completed: 'bg-green-100 text-green-800',
}

export default function OrdersAdmin() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
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
    return [...numbered, ...singles].sort((a, b) => newest(b).localeCompare(newest(a)))
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
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase shrink-0 ${STATUS_COLORS[first.status ?? 'draft'] || 'bg-gray-200 text-gray-800'}`}>
                      {first.status === 'cart_created' ? 'in cart' : first.status}
                    </span>
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
                  <span className={`px-3 py-1.5 rounded-full text-xs font-mono uppercase font-bold ${STATUS_COLORS[first.status ?? 'draft'] || 'bg-gray-200 text-gray-800'}`}>
                    {first.status === 'cart_created' ? 'In Cart' : first.status}
                  </span>
                  {first.shopify_cart_url && first.status !== 'completed' && (
                    <a href={first.shopify_cart_url} target="_blank" rel="noreferrer"
                      className="px-3 py-1.5 rounded-full text-xs font-mono bg-[#dd3333] text-white hover:bg-red-700 transition-all">
                      View Cart ↗
                    </a>
                  )}
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
                // Distinct download names when an order has several designs
                const stem = `order-${row.shopify_order_number || row.id.split('-')[0]}${multi ? `-d${i + 1}` : ''}`
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
                        <div className="flex justify-between"><span className="text-gray-600">Print</span><span>{row.print_method?.replace('_', ' ')}</span></div>
                        <div className="flex justify-between"><span className="text-gray-600">Sides</span><span>{row.sides_designed}</span></div>
                        <div className="border-t border-gray-200 pt-2 flex justify-between"><span className="text-gray-600">Blank + Print</span><span>${row.unit_price} + ${row.print_charge}</span></div>
                        <div className="flex justify-between font-bold"><span className="text-black">Total ({row.total_qty} items)</span><span className="text-[#dd3333]">${row.total_price}</span></div>
                      </div>
                    </div>

                    {/* Design Notes (customer printing instructions) */}
                    {row.notes && (
                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                        <p className="text-xs font-mono text-gray-600 uppercase tracking-widest mb-2">Design Notes</p>
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
                            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-2">
                              <img src={row.canvas_png_front} alt="Front" className="w-full object-contain max-h-64" />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => downloadFile(row.canvas_png_front!, `${stem}-front.png`)}
                                className="flex-1 py-1.5 rounded text-xs font-mono bg-[#dd3333] text-white hover:bg-red-700 transition-all text-center">
                                {downloading === `${stem}-front.png` ? '...' : '↓ PNG'}
                              </button>
                              {row.canvas_svg_front && (
                                <button onClick={() => downloadFile(row.canvas_svg_front!, `${stem}-front.svg`)}
                                  className="flex-1 py-1.5 rounded text-xs font-mono bg-[#dd3333] text-white hover:bg-red-700 transition-all text-center">
                                  {downloading === `${stem}-front.svg` ? '...' : '↓ SVG'}
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                        {row.canvas_png_back && (
                          <div>
                            <p className="text-xs font-mono text-gray-600 mb-2">BACK PREVIEW</p>
                            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-2">
                              <img src={row.canvas_png_back} alt="Back" className="w-full object-contain max-h-64" />
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => downloadFile(row.canvas_png_back!, `${stem}-back.png`)}
                                className="flex-1 py-1.5 rounded text-xs font-mono bg-[#dd3333] text-white hover:bg-red-700 transition-all text-center">
                                {downloading === `${stem}-back.png` ? '...' : '↓ PNG'}
                              </button>
                              {row.canvas_svg_back && (
                                <button onClick={() => downloadFile(row.canvas_svg_back!, `${stem}-back.svg`)}
                                  className="flex-1 py-1.5 rounded text-xs font-mono bg-[#dd3333] text-white hover:bg-red-700 transition-all text-center">
                                  {downloading === `${stem}-back.svg` ? '...' : '↓ SVG'}
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
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
