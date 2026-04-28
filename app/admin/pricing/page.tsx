'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface PricingRow {
  id: string
  print_method_key: string
  sides: number
  price_add: number
  label: string
  is_active: boolean
}

export default function PricingAdmin() {
  const [pricing, setPricing] = useState<PricingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [editValues, setEditValues] = useState<Record<string, { price_add: string; label: string }>>({})

  const showMessage = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  useEffect(() => {
    supabase
      .from('designer_pricing')
      .select('*')
      .order('print_method_key')
      .order('sides')
      .then(({ data }) => {
        if (data) {
          setPricing(data)
          const vals: Record<string, { price_add: string; label: string }> = {}
          data.forEach((row: PricingRow) => {
            vals[row.id] = { price_add: row.price_add.toString(), label: row.label }
          })
          setEditValues(vals)
        }
        setLoading(false)
      })
  }, [])

  const saveRow = async (row: PricingRow) => {
    setSaving(row.id)
    const vals = editValues[row.id]
    const { error } = await supabase
      .from('designer_pricing')
      .update({ price_add: parseFloat(vals.price_add) || 0, label: vals.label })
      .eq('id', row.id)
    setSaving(null)
    if (error) showMessage('Error: ' + error.message, 'error')
    else {
      showMessage('Saved!')
      setPricing(prev => prev.map(r => r.id === row.id
        ? { ...r, price_add: parseFloat(vals.price_add) || 0, label: vals.label }
        : r))
    }
  }

  const toggleActive = async (row: PricingRow) => {
    await supabase.from('designer_pricing').update({ is_active: !row.is_active }).eq('id', row.id)
    setPricing(prev => prev.map(r => r.id === row.id ? { ...r, is_active: !r.is_active } : r))
  }

  const grouped = pricing.reduce((acc, row) => {
    if (!acc[row.print_method_key]) acc[row.print_method_key] = []
    acc[row.print_method_key].push(row)
    return acc
  }, {} as Record<string, PricingRow[]>)

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-mono font-bold text-[#e8ff47]">Print Pricing</h1>
            <p className="text-gray-500 text-sm font-mono mt-1">Set print charges added to the blank product price</p>
          </div>
          <div className="flex gap-2">
            <a href="/admin/clipart" className="px-4 py-2 rounded text-xs font-mono bg-[#1e1e1e] border border-[#2a2a2a] text-gray-400 hover:border-[#e8ff47] hover:text-white transition-all">Clipart Admin</a>
            <a href="/designer?product_id=10043960623420&variant_id=51740953837884&title=Unisex+Heavyweight+T&price=2400" className="px-4 py-2 rounded text-xs font-mono bg-[#1e1e1e] border border-[#2a2a2a] text-gray-400 hover:border-[#e8ff47] hover:text-white transition-all">← Designer</a>
          </div>
        </div>

        {message && (
          <div className={`fixed top-6 right-6 px-4 py-3 rounded font-mono text-sm z-50 ${message.type === 'success' ? 'bg-[#e8ff47] text-black' : 'bg-red-500 text-white'}`}>
            {message.text}
          </div>
        )}

        <div className="bg-[#111] border border-[#2a2a2a] rounded-lg p-4 mb-6">
          <h2 className="text-xs font-mono uppercase tracking-widest text-gray-500 mb-2">How it works</h2>
          <p className="text-sm text-gray-400 font-mono">
            Print charge is added to the blank product price per item.<br />
            Example: $22.00 blank + $12.00 print (1 side) = <span className="text-[#e8ff47]">$34.00 per item</span>
          </p>
        </div>

        {loading ? (
          <p className="text-gray-500 font-mono text-center py-12">Loading...</p>
        ) : (
          <div className="flex flex-col gap-8">
            {Object.entries(grouped).map(([method, rows]) => (
              <div key={method}>
                <h2 className="text-sm font-mono uppercase tracking-widest text-[#e8ff47] mb-3">{method.replace('_', ' ')}</h2>
                <div className="flex flex-col gap-3">
                  {rows.map(row => (
                    <div key={row.id} className={`bg-[#111] border rounded-lg p-4 ${row.is_active ? 'border-[#2a2a2a]' : 'border-red-900 opacity-60'}`}>
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-[#1e1e1e] flex flex-col items-center justify-center shrink-0">
                          <span className="text-xl font-black text-[#e8ff47]">{row.sides}</span>
                          <span className="text-[9px] text-gray-500 font-mono">side{row.sides > 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex-1">
                          <label className="text-[10px] text-gray-600 font-mono uppercase">Label</label>
                          <input
                            value={editValues[row.id]?.label || ''}
                            onChange={e => setEditValues(prev => ({ ...prev, [row.id]: { ...prev[row.id], label: e.target.value } }))}
                            className="w-full bg-[#0a0a0a] border border-[#333] rounded px-2 py-1 text-sm text-white outline-none focus:border-[#e8ff47] font-mono mt-1"
                          />
                        </div>
                        <div className="w-28">
                          <label className="text-[10px] text-gray-600 font-mono uppercase">Add to price</label>
                          <div className="flex items-center mt-1">
                            <span className="text-gray-400 font-mono text-sm mr-1">$</span>
                            <input
                              type="number" step="0.01" min="0"
                              value={editValues[row.id]?.price_add || ''}
                              onChange={e => setEditValues(prev => ({ ...prev, [row.id]: { ...prev[row.id], price_add: e.target.value } }))}
                              className="w-full bg-[#0a0a0a] border border-[#333] rounded px-2 py-1 text-sm text-white outline-none focus:border-[#e8ff47] font-mono"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => saveRow(row)} className="px-3 py-2 rounded text-xs font-mono bg-[#e8ff47] text-black hover:bg-yellow-300 transition-all">
                            {saving === row.id ? '...' : 'Save'}
                          </button>
                          <button onClick={() => toggleActive(row)} className={`px-3 py-2 rounded text-xs font-mono transition-all ${row.is_active ? 'bg-[#1e1e1e] text-green-400 border border-[#2a2a2a]' : 'bg-red-900 text-red-300'}`}>
                            {row.is_active ? 'Active' : 'Off'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
