'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Tables } from '@/types/database'

type FontRow = Tables<'designer_fonts'>
type PrintMethod = Tables<'designer_print_methods'>

type EditFields = { label: string; value: string }

// Quote a multi-word family for an inline-style fontFamily preview (the DB
// stores bare values like "American Typewriter" that the designer applies via
// Fabric). Leaves already-quoted values alone.
function previewFamily(value: string): string {
  const v = value.trim()
  if (!v) return 'inherit'
  if (v.includes("'") || v.includes('"')) return v
  return /\s/.test(v) ? `'${v}'` : v
}

export default function FontsAdmin() {
  const [fonts, setFonts] = useState<FontRow[]>([])
  const [methods, setMethods] = useState<PrintMethod[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [reordering, setReordering] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [editValues, setEditValues] = useState<Record<string, EditFields>>({})

  const showMessage = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  const seedEditValues = (rows: FontRow[]) => {
    const vals: Record<string, EditFields> = {}
    rows.forEach(row => { vals[row.id] = { label: row.label, value: row.value } })
    setEditValues(vals)
  }

  useEffect(() => {
    Promise.all([
      supabase.from('designer_fonts').select('*').order('print_method_key').order('sort_order').order('label'),
      supabase.from('designer_print_methods').select('*').order('sort_order'),
    ]).then(([f, m]) => {
      if (f.data) { setFonts(f.data); seedEditValues(f.data) }
      if (m.data) setMethods(m.data)
      setLoading(false)
    })
  }, [])

  const rowDirty = (row: FontRow): boolean => {
    const v = editValues[row.id]
    if (!v) return false
    return v.label !== row.label || v.value !== row.value
  }

  const saveRow = async (row: FontRow) => {
    const v = editValues[row.id]
    if (!v.label.trim()) { showMessage('Label is required.', 'error'); return }
    if (!v.value.trim()) { showMessage('Font value (CSS family) is required.', 'error'); return }
    setSaving(row.id)
    const { error } = await supabase
      .from('designer_fonts')
      .update({ label: v.label.trim(), value: v.value.trim() })
      .eq('id', row.id)
    setSaving(null)
    if (error) { showMessage('Error: ' + error.message, 'error'); return }
    showMessage('Saved!')
    setFonts(prev => prev.map(r => r.id === row.id ? { ...r, label: v.label.trim(), value: v.value.trim() } : r))
    setEditValues(prev => ({ ...prev, [row.id]: { label: v.label.trim(), value: v.value.trim() } }))
  }

  const toggleActive = async (row: FontRow) => {
    const { error } = await supabase
      .from('designer_fonts')
      .update({ is_active: !row.is_active })
      .eq('id', row.id)
    if (error) { showMessage('Error: ' + error.message, 'error'); return }
    setFonts(prev => prev.map(r => r.id === row.id ? { ...r, is_active: !r.is_active } : r))
  }

  const deleteRow = async (row: FontRow) => {
    if (!confirm(`Remove "${row.label}" from the designer's font list? This cannot be undone.`)) return
    const { error } = await supabase.from('designer_fonts').delete().eq('id', row.id)
    if (error) { showMessage('Error deleting: ' + error.message, 'error'); return }
    setFonts(prev => prev.filter(r => r.id !== row.id))
    showMessage('Deleted!')
  }

  const byOrder = (a: FontRow, b: FontRow) =>
    (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.label.localeCompare(b.label)

  // Move a font up/down within its method group. Reindexes the group to a clean
  // 0..n-1 sequence and persists only the rows whose sort_order changes.
  const moveFont = async (row: FontRow, direction: 'up' | 'down') => {
    if (reordering) return
    const group = fonts.filter(f => f.print_method_key === row.print_method_key).sort(byOrder)
    const idx = group.findIndex(f => f.id === row.id)
    const swapWith = direction === 'up' ? idx - 1 : idx + 1
    if (swapWith < 0 || swapWith >= group.length) return

    const reordered = [...group]
    ;[reordered[idx], reordered[swapWith]] = [reordered[swapWith], reordered[idx]]
    const updates = reordered
      .map((f, i) => ({ id: f.id, to: i }))
      .filter((u, i) => (reordered[i].sort_order ?? 0) !== u.to)
    if (updates.length === 0) return

    setReordering(true)
    setFonts(prev => prev.map(f => {
      const u = updates.find(x => x.id === f.id)
      return u ? { ...f, sort_order: u.to } : f
    }))
    const results = await Promise.all(
      updates.map(u => supabase.from('designer_fonts').update({ sort_order: u.to }).eq('id', u.id))
    )
    setReordering(false)
    const failed = results.find(r => r.error)
    if (failed?.error) {
      showMessage('Error reordering: ' + failed.error.message, 'error')
      const { data } = await supabase
        .from('designer_fonts').select('*')
        .order('print_method_key').order('sort_order').order('label')
      if (data) setFonts(data)
    }
  }

  const grouped = fonts.reduce((acc, row) => {
    (acc[row.print_method_key ?? ''] ||= []).push(row)
    return acc
  }, {} as Record<string, FontRow[]>)
  const methodKeys = methods.length ? methods.map(m => m.key) : Object.keys(grouped)
  methodKeys.forEach(k => { (grouped[k] ||= []).sort(byOrder) })
  const labelFor = (key: string) => methods.find(m => m.key === key)?.label ?? key.replace('_', ' ')

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-mono font-bold text-black">Fonts</h1>
          <p className="text-gray-600 text-sm font-mono mt-1">
            Manage the fonts shown in the designer, per print method. Use ▲▼ to reorder.
          </p>
        </div>

        {message && (
          <div className={`fixed top-6 right-6 px-4 py-3 rounded font-mono text-sm z-50 ${
            message.type === 'success' ? 'bg-[#dd3333] text-white' : 'bg-red-600 text-white'
          }`}>
            {message.text}
          </div>
        )}

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
          <p className="text-xs text-gray-600 font-mono">
            This screen edits, toggles, reorders, and removes existing fonts. Both
            <span className="text-black"> bundled</span> and <span className="text-black">Google</span> fonts
            need to be wired into the app codebase before they appear here — adding either is a code change,
            not an admin task. Custom font uploads are a later phase.
          </p>
        </div>

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
                </div>

                <div className="flex flex-col gap-2">
                  {grouped[method].map((row, i, arr) => {
                    const v = editValues[row.id] ?? { label: row.label, value: row.value }
                    const isGoogle = !!row.google_font
                    return (
                      <div key={row.id} className={`bg-white border rounded-lg p-3 ${row.is_active ? 'border-gray-200' : 'border-red-300 opacity-60'}`}>
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col shrink-0">
                            <button onClick={() => moveFont(row, 'up')} disabled={i === 0 || reordering}
                              title="Move up"
                              className="px-1 leading-none text-xs text-gray-500 hover:text-[#dd3333] disabled:opacity-25 disabled:hover:text-gray-500 transition-all">▲</button>
                            <button onClick={() => moveFont(row, 'down')} disabled={i === arr.length - 1 || reordering}
                              title="Move down"
                              className="px-1 leading-none text-xs text-gray-500 hover:text-[#dd3333] disabled:opacity-25 disabled:hover:text-gray-500 transition-all">▼</button>
                          </div>

                          {/* Live preview: the label rendered in its own font */}
                          <div className="w-44 shrink-0 border border-gray-100 rounded bg-gray-50 px-3 py-2 overflow-hidden">
                            <div className="text-2xl text-black leading-tight truncate" style={{ fontFamily: previewFamily(v.value) }}>
                              {v.label || 'Sample'}
                            </div>
                            <span className={`inline-block mt-1 text-[9px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded ${
                              isGoogle ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-gray-100 text-gray-600 border border-gray-200'
                            }`}>
                              {isGoogle ? `Google: ${row.google_font}` : 'Bundled'}
                            </span>
                          </div>

                          <div className="flex-1 min-w-0">
                            <label className="text-[10px] text-gray-600 font-mono uppercase">Label (shown to customer)</label>
                            <input
                              value={v.label}
                              onChange={e => setEditValues(prev => ({ ...prev, [row.id]: { ...v, label: e.target.value } }))}
                              className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-sm text-black outline-none focus:border-[#dd3333] font-mono mt-1"
                            />
                            <label className="text-[10px] text-gray-600 font-mono uppercase mt-2 block">CSS font-family value</label>
                            <input
                              value={v.value}
                              onChange={e => setEditValues(prev => ({ ...prev, [row.id]: { ...v, value: e.target.value } }))}
                              className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-xs text-black outline-none focus:border-[#dd3333] font-mono mt-1"
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

                  {grouped[method].length === 0 && (
                    <p className="text-gray-500 font-mono text-xs py-2">No fonts for this method.</p>
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
