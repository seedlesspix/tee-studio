'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../components/StringsProvider'
import type { Tables } from '@/types/database'

type FontRow = Tables<'designer_fonts'>
type PrintMethod = Tables<'designer_print_methods'>

type EditFields = { label: string; value: string; category: string }

// The `value` column is already a complete CSS font-family stack, e.g.
// "Cooper, serif" or "Bebas Neue, sans-serif" (unquoted multi-word families
// plus a fallback — valid CSS the browser resolves fine). Apply it verbatim,
// exactly like the designer does (fontFamily: value). Do NOT re-quote it: an
// earlier version wrapped the whole stack in quotes ("'Bebas Neue, sans-serif'"),
// which named one nonexistent family and silently fell back to the inherited
// font — the preview bug this replaces.
function previewFamily(value: string): string {
  return value.trim() || 'inherit'
}

export default function FontsAdmin() {
  const t = useT()
  const [fonts, setFonts] = useState<FontRow[]>([])
  const [methods, setMethods] = useState<PrintMethod[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [reordering, setReordering] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [editValues, setEditValues] = useState<Record<string, EditFields>>({})
  // Upload-a-font form (Font Management Phase A).
  const [upFile, setUpFile] = useState<File | null>(null)
  const [upLabel, setUpLabel] = useState('')
  const [upMethod, setUpMethod] = useState('screen_print')
  const [upCategory, setUpCategory] = useState('')
  const [uploading, setUploading] = useState(false)

  const showMessage = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  const seedEditValues = (rows: FontRow[]) => {
    const vals: Record<string, EditFields> = {}
    rows.forEach(row => { vals[row.id] = { label: row.label, value: row.value, category: row.category ?? '' } })
    setEditValues(vals)
  }

  const baseFamily = (value: string) => value.split(',')[0].trim().replace(/^['"]|['"]$/g, '')

  // Upload a font file → fonts bucket → new designer_fonts row. WE control the family: base(value) =
  // the label, value = "<label>, sans-serif" (admin can refine the fallback afterward). The label is the
  // font's identity (what saved designs + the cut engine key off), so keep it stable once used.
  const handleUploadFont = async () => {
    const label = upLabel.trim()
    if (!upFile) { showMessage('Choose a font file (.ttf/.otf).', 'error'); return }
    if (!label) { showMessage('Font name is required.', 'error'); return }
    if (baseFamily(label) !== label) { showMessage('Font name shouldn’t contain a comma.', 'error'); return }
    setUploading(true)
    const ext = upFile.name.split('.').pop()?.toLowerCase() || 'ttf'
    const safe = label.replace(/[^a-zA-Z0-9]+/g, '-')
    const path = `${safe}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('fonts').upload(path, upFile, { upsert: true, contentType: upFile.type || undefined })
    if (upErr) { setUploading(false); showMessage('Upload failed: ' + upErr.message, 'error'); return }
    const { data: urlData } = supabase.storage.from('fonts').getPublicUrl(path)
    const value = `${label}, sans-serif`
    const maxOrder = fonts.filter(f => f.print_method_key === upMethod).reduce((m, f) => Math.max(m, f.sort_order ?? 0), 0)
    const { data: row, error: insErr } = await supabase.from('designer_fonts').insert({
      label, value, file_url: urlData.publicUrl, print_method_key: upMethod,
      category: upCategory.trim() || null, is_active: true, sort_order: maxOrder + 1,
    }).select().single()
    setUploading(false)
    if (insErr) { showMessage('Save failed: ' + insErr.message, 'error'); return }
    setFonts(prev => [...prev, row])
    setEditValues(prev => ({ ...prev, [row.id]: { label: row.label, value: row.value, category: row.category ?? '' } }))
    setUpFile(null); setUpLabel(''); setUpCategory('')
    showMessage('Font uploaded!')
    // Register it NOW so its preview renders immediately (FontProvider only scans on page load).
    try {
      const face = new FontFace(baseFamily(value), `url("${urlData.publicUrl}")`, { display: 'swap' })
      face.load().then(l => document.fonts.add(l)).catch(() => {})
    } catch { /* ignore */ }
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
    return v.label !== row.label || v.value !== row.value || v.category !== (row.category ?? '')
  }

  const saveRow = async (row: FontRow) => {
    const v = editValues[row.id]
    if (!v.label.trim()) { showMessage('Label is required.', 'error'); return }
    if (!v.value.trim()) { showMessage('Font value (CSS family) is required.', 'error'); return }
    setSaving(row.id)
    const patch = { label: v.label.trim(), value: v.value.trim(), category: v.category.trim() || null }
    const { error } = await supabase.from('designer_fonts').update(patch).eq('id', row.id)
    setSaving(null)
    if (error) { showMessage('Error: ' + error.message, 'error'); return }
    showMessage('Saved!')
    setFonts(prev => prev.map(r => r.id === row.id ? { ...r, ...patch } : r))
    setEditValues(prev => ({ ...prev, [row.id]: { label: patch.label, value: patch.value, category: patch.category ?? '' } }))
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
  const labelFor = (key: string) => {
    const s = t('method.' + key)
    return s.startsWith('method.') ? (methods.find(m => m.key === key)?.label ?? key.replace('_', ' ')) : s
  }

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

        {/* Upload a font — Font Management Phase A. Uploaded fonts render + cut with no code change. */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
          <p className="text-xs font-mono uppercase tracking-widest text-gray-700 mb-3">Upload a font</p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[10px] text-gray-600 font-mono uppercase mb-1">File (.ttf / .otf)</label>
              <input type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf"
                onChange={e => setUpFile(e.target.files?.[0] ?? null)}
                className="text-xs text-black file:mr-2 file:rounded file:border-0 file:bg-[#dd3333] file:px-3 file:py-1.5 file:text-white file:font-mono file:cursor-pointer" />
            </div>
            <div>
              <label className="block text-[10px] text-gray-600 font-mono uppercase mb-1">Font name</label>
              <input value={upLabel} onChange={e => setUpLabel(e.target.value)} placeholder="e.g. Varsity Script"
                className="bg-white border border-gray-300 rounded px-2 py-1.5 text-sm text-black outline-none focus:border-[#dd3333] font-mono" />
            </div>
            <div>
              <label className="block text-[10px] text-gray-600 font-mono uppercase mb-1">Method</label>
              <select value={upMethod} onChange={e => setUpMethod(e.target.value)}
                className="bg-white border border-gray-300 rounded px-2 py-1.5 text-sm text-black outline-none font-mono">
                <option value="screen_print">Print</option>
                <option value="embroidery">Embroidery</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-gray-600 font-mono uppercase mb-1">Category (optional)</label>
              <input value={upCategory} onChange={e => setUpCategory(e.target.value)} placeholder="e.g. Script"
                className="bg-white border border-gray-300 rounded px-2 py-1.5 text-sm text-black outline-none focus:border-[#dd3333] font-mono" />
            </div>
            <button onClick={handleUploadFont} disabled={uploading}
              className="px-4 py-2 rounded text-sm font-mono font-bold bg-[#dd3333] text-white hover:bg-red-700 transition-all disabled:opacity-50">
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
          <p className="text-[11px] text-gray-500 font-mono mt-2">
            The name becomes the font’s identity (what designs remember + what the cut engine uses) — keep it stable once a font is in use.
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
                    const v = editValues[row.id] ?? { label: row.label, value: row.value, category: row.category ?? '' }
                    const isGoogle = !!row.google_font
                    const isUploaded = !!row.file_url
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
                              isUploaded ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : isGoogle ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'bg-gray-100 text-gray-600 border border-gray-200'
                            }`}>
                              {isUploaded ? 'Uploaded' : isGoogle ? `Google: ${row.google_font}` : 'Bundled'}
                            </span>
                          </div>

                          <div className="flex-1 min-w-0">
                            <label className="text-[10px] text-gray-600 font-mono uppercase">Label (shown to customer)</label>
                            <input
                              value={v.label}
                              onChange={e => setEditValues(prev => ({ ...prev, [row.id]: { ...v, label: e.target.value } }))}
                              className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-sm text-black outline-none focus:border-[#dd3333] font-mono mt-1"
                            />
                            <div className="flex gap-2">
                              <div className="flex-1 min-w-0">
                                <label className="text-[10px] text-gray-600 font-mono uppercase mt-2 block">CSS font-family value</label>
                                <input
                                  value={v.value}
                                  onChange={e => setEditValues(prev => ({ ...prev, [row.id]: { ...v, value: e.target.value } }))}
                                  className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-xs text-black outline-none focus:border-[#dd3333] font-mono mt-1"
                                />
                              </div>
                              <div className="w-32 shrink-0">
                                <label className="text-[10px] text-gray-600 font-mono uppercase mt-2 block">Category</label>
                                <input
                                  value={v.category}
                                  onChange={e => setEditValues(prev => ({ ...prev, [row.id]: { ...v, category: e.target.value } }))}
                                  placeholder="—"
                                  className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-xs text-black outline-none focus:border-[#dd3333] font-mono mt-1"
                                />
                              </div>
                            </div>
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
