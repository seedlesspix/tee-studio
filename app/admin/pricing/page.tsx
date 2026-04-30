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
    <div className="p-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-mono font-bold text-black">Print Pricing</h1>
          <p className="text-gray-600 text-sm font-mono mt-1">Set print charges added to the blank product price</p>
        </div>

        {message && (
          <div className={`fixed top-6 right-6 px-4 py-3 rounded font-mono text-sm z-50 ${
            message.type === 'success' ? 'bg-[#dd3333] text-white' : 'bg-red-600 text-white'
          }`}>
            {message.text}
          </div>
        )}

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
          <h2 className="text-xs font-mono uppercase tracking-widest text-gray-600 mb-2">How it works</h2>
          <p className="text-sm text-black font-mono">
            Print charge is added to the blank product price per item.<br />
            Example: $22.00 blank + $12.00 print (1 side) = <span className="text-[#dd3333]">$34.00 per item</span>
          </p>
        </div>

        {loading ? (
          <p className="text-gray-600 font-mono text-center py-12">Loading...</p>
        ) : (
          <div className="flex flex-col gap-8">
            {Object.entries(grouped).map(([method, rows]) => (
              <div key={method}>
                <h2 className="text-sm font-mono uppercase tracking-widest text-[#dd3333] mb-3">{method.replace('_', ' ')}</h2>
                <div className="flex flex-col gap-3">
                  {rows.map(row => (
                    <div key={row.id} className={`bg-white border rounded-lg p-4 ${row.is_active ? 'border-gray-200' : 'border-red-300 opacity-60'}`}>
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-gray-100 flex flex-col items-center justify-center shrink-0">
                          <span className="text-xl font-black text-[#dd3333]">{row.sides}</span>
                          <span className="text-[9px] text-gray-600 font-mono">side{row.sides > 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex-1">
                          <label className="text-[10px] text-gray-600 font-mono uppercase">Label</label>
                          <input
                            value={editValues[row.id]?.label || ''}
                            onChange={e => setEditValues(prev => ({ ...prev, [row.id]: { ...prev[row.id], label: e.target.value } }))}
                            className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-sm text-black outline-none focus:border-[#dd3333] font-mono mt-1"
                          />
                        </div>
                        <div className="w-28">
                          <label className="text-[10px] text-gray-600 font-mono uppercase">Add to price</label>
                          <div className="flex items-center mt-1">
                            <span className="text-black font-mono text-sm mr-1">$</span>
                            <input
                              type="number" step="0.01" min="0"
                              value={editValues[row.id]?.price_add || ''}
                              onChange={e => setEditValues(prev => ({ ...prev, [row.id]: { ...prev[row.id], price_add: e.target.value } }))}
                              className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-sm text-black outline-none focus:border-[#dd3333] font-mono"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => saveRow(row)} className="px-3 py-2 rounded text-xs font-mono bg-[#dd3333] text-white hover:bg-red-700 transition-all">
                            {saving === row.id ? '...' : 'Save'}
                          </button>
                          <button onClick={() => toggleActive(row)} className={`px-3 py-2 rounded text-xs font-mono transition-all border ${row.is_active ? 'bg-white text-green-700 border-green-300' : 'bg-red-50 text-red-700 border-red-300'}`}>
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
