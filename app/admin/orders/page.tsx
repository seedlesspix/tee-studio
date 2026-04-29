'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface Order {
  id: string
  product_title: string
  selected_color: string
  print_method: string
  sides_designed: number
  status: string
  total_qty: number
  total_price: string
  unit_price: string
  print_charge: string
  shopify_order_id: string | null
  shopify_order_number: string | null
  shopify_cart_url: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  shipping_address: any
  canvas_png_front: string | null
  canvas_png_back: string | null
  canvas_svg_front: string | null
  canvas_svg_back: string | null
  uploaded_files: any[]
  quantities: Record<string, number>
  created_at: string
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-700 text-gray-300',
  pending: 'bg-yellow-900 text-yellow-300',
  ordering: 'bg-blue-900 text-blue-300',
  cart_created: 'bg-orange-900 text-orange-300',
  completed: 'bg-green-900 text-green-300',
}

export default function OrdersAdmin() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Order | null>(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('design_orders')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setOrders(data)
        setLoading(false)
      })
  }, [])

  const filtered = orders.filter(o => {
    const matchStatus = filter === 'all' || o.status === filter
    const matchSearch = !search ||
      o.product_title?.toLowerCase().includes(search.toLowerCase()) ||
      o.selected_color?.toLowerCase().includes(search.toLowerCase()) ||
      o.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
      o.customer_email?.toLowerCase().includes(search.toLowerCase()) ||
      o.shopify_order_number?.includes(search) ||
      o.id.includes(search)
    return matchStatus && matchSearch
  })

  const formatDate = (str: string) => {
    const d = new Date(str)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  // Force download a file by fetching as blob
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
    } catch (e) {
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
    <div className="min-h-screen bg-[#0a0a0a] text-white" style={{ fontFamily: 'DM Sans, sans-serif' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 h-14 bg-[#161616] border-b border-[#2a2a2a]">
        <div className="font-black text-xl tracking-widest">
          TEE<span className="text-[#dd3333]">STUDIO</span>
          <span className="text-gray-500 font-mono text-sm ml-3">/ Orders</span>
        </div>
        <div className="flex gap-2">
          <a href="/admin/clipart" className="px-3 py-1.5 rounded text-xs font-mono bg-[#1e1e1e] border border-[#2a2a2a] text-gray-400 hover:text-white transition-all">Clipart</a>
          <a href="/admin/pricing" className="px-3 py-1.5 rounded text-xs font-mono bg-[#1e1e1e] border border-[#2a2a2a] text-gray-400 hover:text-white transition-all">Pricing</a>
          <a href="/designer?product_id=10043960623420&variant_id=51740953837884&title=Unisex+Heavyweight+T&price=2400" className="px-3 py-1.5 rounded text-xs font-mono bg-[#1e1e1e] border border-[#2a2a2a] text-gray-400 hover:text-white transition-all">← Designer</a>
        </div>
      </header>

      <div className="flex h-[calc(100vh-56px)]">
        {/* Left: Orders List */}
        <div className="w-[400px] shrink-0 border-r border-[#2a2a2a] flex flex-col">
          <div className="p-4 border-b border-[#2a2a2a] flex flex-col gap-3">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, email, order #..."
              className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[#dd3333] font-mono placeholder-gray-600" />
            <div className="flex gap-1 flex-wrap">
              {[
                { key: 'all', label: `All (${orderCounts.all})` },
                { key: 'completed', label: `Paid (${orderCounts.completed})` },
                { key: 'cart_created', label: `In Cart (${orderCounts.cart_created})` },
                { key: 'draft', label: `Draft (${orderCounts.draft})` },
              ].map(({ key, label }) => (
                <button key={key} onClick={() => setFilter(key)}
                  className={`px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wide transition-all ${
                    filter === key ? 'bg-[#dd3333] text-white font-bold' : 'bg-[#1e1e1e] text-gray-400 hover:text-white border border-[#2a2a2a]'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-32 text-gray-600 font-mono text-sm">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-gray-600 font-mono text-sm">No orders found</div>
            ) : filtered.map(order => (
              <div key={order.id} onClick={() => setSelected(order)}
                className={`flex gap-3 p-4 border-b border-[#1a1a1a] cursor-pointer transition-all hover:bg-[#111] ${
                  selected?.id === order.id ? 'bg-[#161616] border-l-2 border-l-[#dd3333]' : ''
                }`}>
                <div className="w-14 h-14 rounded-lg overflow-hidden bg-[#1e1e1e] shrink-0 border border-[#2a2a2a]">
                  {order.canvas_png_front ? (
                    <img src={order.canvas_png_front} alt="Design" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-700 text-[9px] font-mono">No preview</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    {order.shopify_order_number ? (
                      <span className="text-xs font-black text-[#dd3333]">#{order.shopify_order_number}</span>
                    ) : (
                      <span className="text-[10px] font-mono text-gray-600">{order.id.split('-')[0]}...</span>
                    )}
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase shrink-0 ${STATUS_COLORS[order.status] || 'bg-gray-700 text-gray-300'}`}>
                      {order.status === 'cart_created' ? 'in cart' : order.status}
                    </span>
                  </div>
                  {order.customer_name && (
                    <p className="text-sm font-medium truncate">{order.customer_name}</p>
                  )}
                  {order.customer_email && (
                    <p className="text-xs text-gray-500 truncate">{order.customer_email}</p>
                  )}
                  {!order.customer_name && (
                    <p className="text-sm text-gray-400 truncate">{order.product_title}</p>
                  )}
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-[10px] text-gray-600 font-mono">{formatDate(order.created_at)}</span>
                    <span className="text-sm font-bold text-white">${order.total_price}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Order Detail */}
        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-700 font-mono">
              <div className="text-5xl mb-3">👕</div>
              <p className="text-sm">Select an order to view details</p>
            </div>
          ) : (
            <div className="p-6 flex flex-col gap-5 max-w-4xl">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  {selected.shopify_order_number ? (
                    <h2 className="text-2xl font-black">Order #{selected.shopify_order_number}</h2>
                  ) : (
                    <h2 className="text-xl font-bold">Draft Order</h2>
                  )}
                  <p className="text-xs font-mono text-gray-500 mt-0.5">{selected.id}</p>
                  <p className="text-xs text-gray-600 mt-0.5">{formatDate(selected.created_at)}</p>
                </div>
                <div className="flex gap-2 items-center">
                  <span className={`px-3 py-1.5 rounded-full text-xs font-mono uppercase font-bold ${STATUS_COLORS[selected.status] || 'bg-gray-700 text-gray-300'}`}>
                    {selected.status === 'cart_created' ? 'In Cart' : selected.status}
                  </span>
                  {selected.shopify_cart_url && (
                    <a href={selected.shopify_cart_url} target="_blank" rel="noreferrer"
                      className="px-3 py-1.5 rounded-full text-xs font-mono bg-[#1e1e1e] border border-[#2a2a2a] text-gray-400 hover:border-[#dd3333] hover:text-white transition-all">
                      View Cart ↗
                    </a>
                  )}
                </div>
              </div>

              {/* Customer + Product Info side by side */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#111] border border-[#2a2a2a] rounded-xl p-4">
                  <p className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-3">Customer</p>
                  {selected.customer_name || selected.customer_email ? (
                    <div className="flex flex-col gap-2 text-sm">
                      {selected.customer_name && (
                        <div className="flex justify-between"><span className="text-gray-400">Name</span><span className="font-medium">{selected.customer_name}</span></div>
                      )}
                      {selected.customer_email && (
                        <div className="flex justify-between"><span className="text-gray-400">Email</span>
                          <a href={`mailto:${selected.customer_email}`} className="text-[#dd3333] hover:underline">{selected.customer_email}</a>
                        </div>
                      )}
                      {selected.customer_phone && (
                        <div className="flex justify-between"><span className="text-gray-400">Phone</span><span>{selected.customer_phone}</span></div>
                      )}
                      {selected.shipping_address && (
                        <div className="mt-1 pt-2 border-t border-[#2a2a2a]">
                          <p className="text-gray-400 text-xs mb-1">Ship to</p>
                          <p className="text-xs text-gray-300 leading-relaxed">
                            {selected.shipping_address.address1}<br />
                            {selected.shipping_address.city}, {selected.shipping_address.province} {selected.shipping_address.zip}<br />
                            {selected.shipping_address.country}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-600 italic">No customer info yet — order not completed</p>
                  )}
                </div>
                <div className="bg-[#111] border border-[#2a2a2a] rounded-xl p-4">
                  <p className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-3">Order Summary</p>
                  <div className="flex flex-col gap-2 text-sm">
                    <div className="flex justify-between"><span className="text-gray-400">Product</span><span className="text-right text-xs">{selected.product_title}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Color</span><span>{selected.selected_color}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Print</span><span>{selected.print_method?.replace('_', ' ')}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Sides</span><span>{selected.sides_designed}</span></div>
                    <div className="border-t border-[#2a2a2a] pt-2 flex justify-between"><span className="text-gray-400">Blank + Print</span><span>${selected.unit_price} + ${selected.print_charge}</span></div>
                    <div className="flex justify-between font-bold"><span>Total ({selected.total_qty} items)</span><span className="text-[#dd3333]">${selected.total_price}</span></div>
                  </div>
                </div>
              </div>

              {/* Sizes */}
              {selected.quantities && Object.values(selected.quantities).some(v => v > 0) && (
                <div className="bg-[#111] border border-[#2a2a2a] rounded-xl p-4">
                  <p className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-3">Sizes</p>
                  <div className="flex gap-3 flex-wrap">
                    {Object.entries(selected.quantities).filter(([,qty]) => qty > 0).map(([size, qty]) => (
                      <div key={size} className="bg-[#1e1e1e] border border-[#2a2a2a] rounded-lg px-4 py-2 text-center min-w-[60px]">
                        <p className="text-xs font-mono text-gray-400">{size}</p>
                        <p className="text-2xl font-black text-[#dd3333]">{qty}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Design Files */}
              <div className="bg-[#111] border border-[#2a2a2a] rounded-xl p-4">
                <p className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-4">Design Files</p>
                <div className="grid grid-cols-2 gap-4">
                  {/* Front */}
                  {selected.canvas_png_front && (
                    <div>
                      <p className="text-xs font-mono text-gray-500 mb-2">FRONT PREVIEW</p>
                      <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg overflow-hidden mb-2">
                        <img src={selected.canvas_png_front} alt="Front" className="w-full object-contain max-h-64" />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => downloadFile(selected.canvas_png_front!, `order-${selected.shopify_order_number || selected.id.split('-')[0]}-front.png`)}
                          className="flex-1 py-1.5 rounded text-xs font-mono bg-[#1e1e1e] border border-[#2a2a2a] text-gray-400 hover:border-[#dd3333] hover:text-white transition-all text-center">
                          {downloading?.includes('front.png') ? '...' : '↓ PNG'}
                        </button>
                        {selected.canvas_svg_front && (
                          <button onClick={() => downloadFile(selected.canvas_svg_front!, `order-${selected.shopify_order_number || selected.id.split('-')[0]}-front.svg`)}
                            className="flex-1 py-1.5 rounded text-xs font-mono bg-[#1e1e1e] border border-[#2a2a2a] text-gray-400 hover:border-[#dd3333] hover:text-white transition-all text-center">
                            {downloading?.includes('front.svg') ? '...' : '↓ SVG'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {/* Back */}
                  {selected.canvas_png_back && (
                    <div>
                      <p className="text-xs font-mono text-gray-500 mb-2">BACK PREVIEW</p>
                      <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg overflow-hidden mb-2">
                        <img src={selected.canvas_png_back} alt="Back" className="w-full object-contain max-h-64" />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => downloadFile(selected.canvas_png_back!, `order-${selected.shopify_order_number || selected.id.split('-')[0]}-back.png`)}
                          className="flex-1 py-1.5 rounded text-xs font-mono bg-[#1e1e1e] border border-[#2a2a2a] text-gray-400 hover:border-[#dd3333] hover:text-white transition-all text-center">
                          ↓ PNG
                        </button>
                        {selected.canvas_svg_back && (
                          <button onClick={() => downloadFile(selected.canvas_svg_back!, `order-${selected.shopify_order_number || selected.id.split('-')[0]}-back.svg`)}
                            className="flex-1 py-1.5 rounded text-xs font-mono bg-[#1e1e1e] border border-[#2a2a2a] text-gray-400 hover:border-[#dd3333] hover:text-white transition-all text-center">
                            ↓ SVG
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Customer uploaded files */}
              {selected.uploaded_files?.length > 0 && (
                <div className="bg-[#111] border border-[#2a2a2a] rounded-xl p-4">
                  <p className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-3">Customer Uploaded Files</p>
                  <div className="flex flex-col gap-2">
                    {selected.uploaded_files.map((f: any, i: number) => (
                      <div key={i} className="flex items-center justify-between bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">📎</span>
                          <div>
                            <p className="text-sm font-mono text-white">{f.name}</p>
                            <p className="text-xs text-gray-600">{f.type}</p>
                          </div>
                        </div>
                        <button onClick={() => downloadFile(f.url, f.name)}
                          className="px-3 py-1.5 rounded text-xs font-mono bg-[#1e1e1e] border border-[#2a2a2a] text-gray-400 hover:border-[#dd3333] hover:text-white transition-all">
                          {downloading === f.name ? 'Downloading...' : '↓ Download'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
