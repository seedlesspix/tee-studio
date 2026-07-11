'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Tables } from '@/types/database'

type ColorRow = Tables<'designer_colors'>
type PrintMethod = Tables<'designer_print_methods'>

type EditFields = { label: string; hex: string }
type NewFields = { label: string; hex: string }
const EMPTY_NEW: NewFields = { label: '', hex: '#000000' }

const HEX_RE = /^#[0-9a-f]{6}$/

// Accepts "#abc", "abc", "#aabbcc", "aabbcc" (any case) and returns a
// canonical lowercase #rrggbb, or null if it isn't a valid hex color.
function normalizeHex(input: string): string | null {
  let v = input.trim().toLowerCase()
  if (!v.startsWith('#')) v = '#' + v
  if (/^#[0-9a-f]{3}$/.test(v)) {
    v = '#' + v.slice(1).split('').map(c => c + c).join('')
  }
  return HEX_RE.test(v) ? v : null
}

export default function ColorsAdmin() {
  const [colors, setColors] = useState<ColorRow[]>([])
  const [methods, setMethods] = useState<PrintMethod[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [editValues, setEditValues] = useState<Record<string, EditFields>>({})

  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [newColor, setNewColor] = useState<NewFields>(EMPTY_NEW)
  const [creating, setCreating] = useState(false)

  const showMessage = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  const seedEditValues = (rows: ColorRow[]) => {
    const vals: Record<string, EditFields> = {}
    rows.forEach(row => { vals[row.id] = { label: row.label, hex: row.hex } })
    setEditValues(vals)
  }

  useEffect(() => {
    Promise.all([
      supabase.from('designer_colors').select('*').order('print_method_key').order('sort_order').order('label'),
      supabase.from('designer_print_methods').select('*').order('sort_order'),
    ]).then(([c, m]) => {
      if (c.data) { setColors(c.data); seedEditValues(c.data) }
      if (m.data) setMethods(m.data)
      setLoading(false)
    })
  }, [])

  // A row is dirty when its edit fields differ from what's persisted. Drives
  // the "Unsaved" marker + Save button state (same pattern as pricing admin).
  const rowDirty = (row: ColorRow): boolean => {
    const v = editValues[row.id]
    if (!v) return false
    return v.label !== row.label || (normalizeHex(v.hex) ?? v.hex) !== row.hex
  }

  const saveRow = async (row: ColorRow) => {
    const v = editValues[row.id]
    const hex = normalizeHex(v.hex)
    if (!hex) { showMessage(`"${v.hex}" isn't a valid hex color (e.g. #1a2b3c).`, 'error'); return }
    if (!v.label.trim()) { showMessage('Label is required.', 'error'); return }
    setSaving(row.id)
    const { error } = await supabase
      .from('designer_colors')
      .update({ label: v.label.trim(), hex })
      .eq('id', row.id)
    setSaving(null)
    if (error) { showMessage('Error: ' + error.message, 'error'); return }
    showMessage('Saved!')
    setColors(prev => prev.map(r => r.id === row.id ? { ...r, label: v.label.trim(), hex } : r))
    setEditValues(prev => ({ ...prev, [row.id]: { label: v.label.trim(), hex } }))
  }

  const toggleActive = async (row: ColorRow) => {
    const { error } = await supabase
      .from('designer_colors')
      .update({ is_active: !row.is_active })
      .eq('id', row.id)
    if (error) { showMessage('Error: ' + error.message, 'error'); return }
    setColors(prev => prev.map(r => r.id === row.id ? { ...r, is_active: !r.is_active } : r))
  }

  const deleteRow = async (row: ColorRow) => {
    if (!confirm(`Delete "${row.label}"? This cannot be undone.`)) return
    const { error } = await supabase.from('designer_colors').delete().eq('id', row.id)
    if (error) { showMessage('Error deleting: ' + error.message, 'error'); return }
    setColors(prev => prev.filter(r => r.id !== row.id))
    showMessage('Deleted!')
  }

  const openAdd = (methodKey: string) => {
    setAddingFor(methodKey)
    setNewColor(EMPTY_NEW)
  }

  const createColor = async (methodKey: string) => {
    const hex = normalizeHex(newColor.hex)
    if (!hex) { showMessage(`"${newColor.hex}" isn't a valid hex color (e.g. #1a2b3c).`, 'error'); return }
    if (!newColor.label.trim()) { showMessage('Label is required.', 'error'); return }
    setCreating(true)
    const maxOrder = colors
      .filter(c => c.print_method_key === methodKey)
      .reduce((max, c) => Math.max(max, c.sort_order ?? 0), 0)
    const { data, error } = await supabase
      .from('designer_colors')
      .insert({
        print_method_key: methodKey,
        label: newColor.label.trim(),
        hex,
        is_active: true,
        sort_order: maxOrder + 1,
      })
      .select()
      .single()
    setCreating(false)
    if (error) { showMessage('Error: ' + error.message, 'error'); return }
    if (data) {
      setColors(prev => [...prev, data])
      setEditValues(prev => ({ ...prev, [data.id]: { label: data.label, hex: data.hex } }))
      setAddingFor(null)
      showMessage('Color added!')
    }
  }

  const grouped = colors.reduce((acc, row) => {
    (acc[row.print_method_key ?? ''] ||= []).push(row)
    return acc
  }, {} as Record<string, ColorRow[]>)
  const methodKeys = methods.length ? methods.map(m => m.key) : Object.keys(grouped)
  methodKeys.forEach(k => { grouped[k] ||= [] })
  const labelFor = (key: string) => methods.find(m => m.key === key)?.label ?? key.replace('_', ' ')

  return (
    <div className="p-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-mono font-bold text-black">Colors</h1>
          <p className="text-gray-600 text-sm font-mono mt-1">Manage the color palette shown in the designer, per print method</p>
        </div>

        {message && (
          <div className={`fixed top-6 right-6 px-4 py-3 rounded font-mono text-sm z-50 ${
            message.type === 'success' ? 'bg-[#dd3333] text-white' : 'bg-red-600 text-white'
          }`}>
            {message.text}
          </div>
        )}

        {loading ? (
          <p className="text-gray-600 font-mono text-center py-12">Loading...</p>
        ) : (
          <div className="flex flex-col gap-8">
            {methodKeys.map(method => (
              <div key={method}>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-mono uppercase tracking-widest text-[#dd3333]">
                    {labelFor(method)}
                    <span className="text-gray-400 ml-2">{grouped[method].length}</span>
                  </h2>
                  {addingFor !== method && (
                    <button onClick={() => openAdd(method)}
                      className="text-xs text-[#dd3333] font-mono hover:text-red-700 transition-all">+ Add color</button>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  {grouped[method].map(row => {
                    const v = editValues[row.id] ?? { label: row.label, hex: row.hex }
                    const pickerHex = normalizeHex(v.hex) ?? '#000000'
                    return (
                      <div key={row.id} className={`bg-white border rounded-lg p-3 ${row.is_active ? 'border-gray-200' : 'border-red-300 opacity-60'}`}>
                        <div className="flex items-center gap-3">
                          <input
                            type="color"
                            value={pickerHex}
                            onChange={e => setEditValues(prev => ({ ...prev, [row.id]: { ...v, hex: e.target.value } }))}
                            title="Pick color"
                            className="w-10 h-10 rounded border border-gray-300 bg-white cursor-pointer shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <label className="text-[10px] text-gray-600 font-mono uppercase">Label</label>
                            <input
                              value={v.label}
                              onChange={e => setEditValues(prev => ({ ...prev, [row.id]: { ...v, label: e.target.value } }))}
                              className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-sm text-black outline-none focus:border-[#dd3333] font-mono mt-1"
                            />
                          </div>
                          <div className="w-28 shrink-0">
                            <label className="text-[10px] text-gray-600 font-mono uppercase">Hex</label>
                            <input
                              value={v.hex}
                              onChange={e => setEditValues(prev => ({ ...prev, [row.id]: { ...v, hex: e.target.value } }))}
                              placeholder="#1a2b3c"
                              className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-sm text-black outline-none focus:border-[#dd3333] font-mono mt-1 placeholder-gray-400"
                            />
                          </div>
                          <div className="flex flex-col gap-2 shrink-0">
                            {rowDirty(row) && (
                              <span className="text-[10px] font-mono text-amber-600 text-center">● Unsaved</span>
                            )}
                            <button
                              onClick={() => saveRow(row)}
                              disabled={saving !== row.id && !rowDirty(row)}
                              className={`px-3 py-2 rounded text-xs font-mono transition-all ${
                                rowDirty(row) ? 'bg-[#dd3333] text-white hover:bg-red-700' : 'bg-gray-100 text-gray-400 cursor-default'
                              }`}
                            >
                              {saving === row.id ? '...' : rowDirty(row) ? 'Save' : 'Saved ✓'}
                            </button>
                            <button onClick={() => toggleActive(row)}
                              className={`px-3 py-2 rounded text-xs font-mono transition-all border ${
                                row.is_active ? 'bg-white text-green-700 border-green-300' : 'bg-red-50 text-red-700 border-red-300'
                              }`}>
                              {row.is_active ? 'Active' : 'Off'}
                            </button>
                            <button onClick={() => deleteRow(row)}
                              className="px-3 py-2 rounded text-xs font-mono bg-white text-red-600 border border-gray-300 hover:bg-red-50 hover:border-red-300 transition-all">
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {grouped[method].length === 0 && addingFor !== method && (
                    <p className="text-gray-500 font-mono text-xs py-2">No colors yet. Use “+ Add color”.</p>
                  )}

                  {addingFor === method && (
                    <div className="bg-white border border-[#dd3333] rounded-lg p-3">
                      <div className="flex items-end gap-3 flex-wrap">
                        <div className="shrink-0">
                          <label className="text-[10px] text-gray-600 font-mono uppercase block mb-1">Pick</label>
                          <input
                            type="color"
                            value={normalizeHex(newColor.hex) ?? '#000000'}
                            onChange={e => setNewColor(prev => ({ ...prev, hex: e.target.value }))}
                            className="w-10 h-10 rounded border border-gray-300 bg-white cursor-pointer"
                          />
                        </div>
                        <div className="flex-1 min-w-[8rem]">
                          <label className="text-[10px] text-gray-600 font-mono uppercase">Label</label>
                          <input
                            value={newColor.label}
                            onChange={e => setNewColor(prev => ({ ...prev, label: e.target.value }))}
                            placeholder="e.g. Navy"
                            className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-sm text-black outline-none focus:border-[#dd3333] font-mono mt-1 placeholder-gray-400"
                          />
                        </div>
                        <div className="w-28">
                          <label className="text-[10px] text-gray-600 font-mono uppercase">Hex</label>
                          <input
                            value={newColor.hex}
                            onChange={e => setNewColor(prev => ({ ...prev, hex: e.target.value }))}
                            placeholder="#1a2b3c"
                            className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-sm text-black outline-none focus:border-[#dd3333] font-mono mt-1 placeholder-gray-400"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => createColor(method)} disabled={creating}
                            className="px-3 py-2 rounded text-xs font-mono bg-[#dd3333] text-white hover:bg-red-700 transition-all disabled:opacity-60">
                            {creating ? '...' : 'Add'}
                          </button>
                          <button onClick={() => setAddingFor(null)}
                            className="px-3 py-2 rounded text-xs font-mono bg-white text-black border border-gray-300 hover:bg-gray-50 transition-all">
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
