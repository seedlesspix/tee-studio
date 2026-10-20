'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../components/StringsProvider'
import type { Tables } from '@/types/database'
import { matchesArtSearch, sortArt, ART_SORTS, type ArtSort } from '../../lib/artSearch'

type Category = Tables<'clipart_categories'>
const BTN_CAT = 'px-1 leading-none text-[11px] hover:text-[#dd3333] disabled:opacity-25 transition-all'
type ClipartItem = Tables<'clipart_items'>

const METHODS: { key: string; label: string }[] = [
  { key: 'screen_print', label: 'Print' },
  { key: 'embroidery', label: 'Embroidery' },
]

export default function ClipartAdmin() {
  const t = useT()
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [items, setItems] = useState<ClipartItem[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [tagInputs, setTagInputs] = useState<Record<string, string>>({})
  // Per-item decal-number input (every art can carry a number), keyed by item.id.
  const [decalInputs, setDecalInputs] = useState<Record<string, string>>({})
  // Which item's category checklist is expanded (one at a time).
  const [openCategoriesFor, setOpenCategoriesFor] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Find things fast (Denise, 2026-10-20): search this category by name / tag / Design # (the same matcher
  // the customer Art panel uses) and sort it. Default NEWEST FIRST so a freshly uploaded batch lands at the
  // top instead of under hundreds of older tiles; the chosen sort sticks across reloads (this browser).
  const SORT_KEY = 'admin.art.sort'
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<ArtSort>(() => {
    try {
      const v = typeof window !== 'undefined' ? window.localStorage.getItem(SORT_KEY) : null
      return ART_SORTS.some(s => s.key === v) ? (v as ArtSort) : 'newest'
    } catch { return 'newest' }
  })
  const changeSort = (v: ArtSort) => {
    setSortBy(v)
    try { window.localStorage.setItem(SORT_KEY, v) } catch { /* private mode etc. — just don't persist */ }
  }
  const visibleItems = sortArt(items.filter(i => matchesArtSearch(i, search)), sortBy)

  const showMessage = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  useEffect(() => {
    supabase
      .from('clipart_categories')
      .select('*')
      .order('sort_order')
      .order('name')
      .then(({ data }) => {
        if (data) {
          setCategories(data)
          if (data.length > 0) setSelectedCategory(data[0].id)
        }
      })
    void refreshCatStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Art in the selected category — matched by category_ids (an art can be in several categories).
  useEffect(() => {
    if (!selectedCategory) { setItems([]); return }
    setLoading(true)
    supabase
      .from('clipart_items')
      .select('*')
      .contains('category_ids', [selectedCategory])
      .order('sort_order')
      .then(({ data }) => {
        setItems(data || [])
        const inputs: Record<string, string> = {}
        const decals: Record<string, string> = {}
        data?.forEach(item => {
          inputs[item.id] = (item.tags || []).join(', ')
          decals[item.id] = item.decal_number != null ? String(item.decal_number) : ''
        })
        setTagInputs(inputs)
        setDecalInputs(decals)
        setOpenCategoriesFor(null)
        setLoading(false)
      })
  }, [selectedCategory])

  // Save the text fields (tags + Decal #) in one update. Whole-number validation on the Decal #.
  const saveItem = async (itemId: string) => {
    setSaving(itemId)
    const tagString = tagInputs[itemId] || ''
    const tags = tagString.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    const raw = (decalInputs[itemId] || '').trim()
    if (raw && !/^\d+$/.test(raw)) {
      setSaving(null)
      showMessage('Decal number must be a whole number.', 'error')
      return
    }
    const patch = { tags, decal_number: raw ? parseInt(raw, 10) : null }
    const { error } = await supabase.from('clipart_items').update(patch).eq('id', itemId)
    setSaving(null)
    // 23505 = unique violation: design numbers are unique (Grab 'n Go deep links + sell-through treat the
    // number as the art's identity), so say WHICH number is taken instead of echoing the DB error.
    if (error?.code === '23505') showMessage(`Design #${raw} is already used by another item — pick a different number.`, 'error')
    else if (error) showMessage('Error saving: ' + error.message, 'error')
    else {
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...patch } : i))
      showMessage('Saved!')
    }
  }

  // Method toggle (Print / Embroidery) — persists immediately. An art must keep at least one method,
  // else it would be invisible everywhere (use the active toggle to hide instead).
  const toggleMethod = async (item: ClipartItem, method: string) => {
    const current = item.supported_methods || []
    const next = current.includes(method) ? current.filter(m => m !== method) : [...current, method]
    if (next.length === 0) { showMessage('Art needs at least one method (Print or Embroidery).', 'error'); return }
    const { error } = await supabase.from('clipart_items').update({ supported_methods: next }).eq('id', item.id)
    if (error) showMessage('Error: ' + error.message, 'error')
    else setItems(prev => prev.map(i => i.id === item.id ? { ...i, supported_methods: next } : i))
  }

  // "Light artwork" flag (Denise, 2026-10-17) — persists immediately. A flagged design opens a Grab 'n Go
  // landing on the garment's DARKEST color (else the admin's first color) so white art is never invisible
  // on arrival; Build 2 renders it on a black tee. Human-set on purpose: 4 of 398 items qualify today and
  // the borderline ones (half-white flags) are judgment calls.
  const toggleLight = async (item: ClipartItem) => {
    const next = !item.is_light
    const { error } = await supabase.from('clipart_items').update({ is_light: next }).eq('id', item.id)
    if (error) showMessage('Error: ' + error.message, 'error')
    else setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_light: next } : i))
  }

  // Category membership toggle — persists immediately. Removing the CURRENTLY selected category drops
  // the art from this list (it now lives elsewhere).
  const toggleCategory = async (item: ClipartItem, catId: string) => {
    const current = item.category_ids || []
    const next = current.includes(catId) ? current.filter(c => c !== catId) : [...current, catId]
    // Keep at least one category, so art stays findable in this admin (which browses by category only).
    if (next.length === 0) { showMessage('Art must be in at least one category.', 'error'); return }
    const { error } = await supabase.from('clipart_items').update({ category_ids: next }).eq('id', item.id)
    if (error) { showMessage('Error: ' + error.message, 'error'); return }
    setItems(prev => prev
      .map(i => i.id === item.id ? { ...i, category_ids: next } : i)
      .filter(i => (i.category_ids || []).includes(selectedCategory))
    )
    void refreshCatStats()
  }

  const toggleActive = async (item: ClipartItem) => {
    await supabase
      .from('clipart_items')
      .update({ is_active: !item.is_active })
      .eq('id', item.id)
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_active: !i.is_active } : i))
  }

  const deleteItem = async (item: ClipartItem) => {
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return
    const { error } = await supabase
      .from('clipart_items')
      .delete()
      .eq('id', item.id)
    if (error) { showMessage('Error deleting: ' + error.message, 'error'); return }
    setItems(prev => prev.filter(i => i.id !== item.id))
    showMessage('Deleted!')
    void refreshCatStats()
  }

  const handleUpload = async (files: FileList | null) => {
    if (!files || !selectedCategory) return
    setUploading(true)
    const category = categories.find(c => c.id === selectedCategory)
    if (!category) return

    const maxOrder = items.length > 0 ? Math.max(...items.map(i => i.sort_order || 0)) : 0

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const ext = file.name.split('.').pop()?.toLowerCase()
      const safeName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_')
      const path = `${category.name}/${safeName}_${Date.now()}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('clipart')
        .upload(path, file, { upsert: true })

      if (uploadError) {
        showMessage(`Error uploading ${file.name}: ${uploadError.message}`, 'error')
        continue
      }

      const { data: urlData } = supabase.storage.from('clipart').getPublicUrl(path)

      // New art defaults to Print-only (embroidery is a deliberate per-art opt-in — it has to be
      // stitch-appropriate) and joins the selected category. More categories/methods are set per-item.
      const { data: newItem, error: insertError } = await supabase
        .from('clipart_items')
        .insert({
          name: safeName.replace(/_/g, ' '),
          file_url: urlData.publicUrl,
          file_type: ext === 'svg' ? 'svg' : 'image',
          category_ids: [selectedCategory],
          supported_methods: ['screen_print'],
          is_active: true,
          sort_order: maxOrder + i + 1,
          tags: []
        })
        .select()
        .single()

      if (insertError) {
        showMessage(`Error saving ${file.name}: ${insertError.message}`, 'error')
      } else if (newItem) {
        setItems(prev => [...prev, newItem])
        setTagInputs(prev => ({ ...prev, [newItem.id]: '' }))
        setDecalInputs(prev => ({ ...prev, [newItem.id]: '' }))
        showMessage(`Uploaded ${file.name}!`)
      }
    }

    setUploading(false)
    void refreshCatStats()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Category management (Denise, 2026-10-20): rename / on-off / reorder / delete-when-empty ──
  // Per-category art counts drive the "N pieces live only here" confirm before turning one off and the
  // delete-only-when-empty rule. One light fetch (id + category_ids for every item), refreshed after any
  // change to category membership.
  const [catStats, setCatStats] = useState<{ count: Record<string, number>; onlyHere: Record<string, number> }>({ count: {}, onlyHere: {} })
  const refreshCatStats = async () => {
    const { data } = await supabase.from('clipart_items').select('id, category_ids')
    const count: Record<string, number> = {}, onlyHere: Record<string, number> = {}
    for (const it of data ?? []) {
      const ids = it.category_ids ?? []
      for (const id of ids) count[id] = (count[id] ?? 0) + 1
      if (ids.length === 1) onlyHere[ids[0]] = (onlyHere[ids[0]] ?? 0) + 1
    }
    setCatStats({ count, onlyHere })
  }
  const [editingCat, setEditingCat] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const cancelRenameRef = useRef(false) // Escape = discard; the save happens exactly once, on blur
  const [catBusy, setCatBusy] = useState(false)

  // Rename — LIVE for customers the moment it saves (Denise: no publish step). Art points at categories by
  // id, so design numbers, links and orders are untouched.
  const renameCategory = async (cat: Category) => {
    const cancelled = cancelRenameRef.current
    cancelRenameRef.current = false
    const name = editName.trim()
    setEditingCat(null)
    if (cancelled || !name || name === cat.name) return
    const { error } = await supabase.from('clipart_categories').update({ name }).eq('id', cat.id)
    if (error) { showMessage('Error renaming: ' + error.message, 'error'); return }
    setCategories(prev => prev.map(c => c.id === cat.id ? { ...c, name } : c))
    showMessage('Renamed — live for customers now.')
  }

  // On/off. OFF MEANS GONE for customers (hidden from browsing AND search); the admin keeps everything.
  // Say how many pieces have no other home before hiding them.
  const toggleCategoryActive = async (cat: Category) => {
    const turningOff = !!cat.is_active
    const stranded = catStats.onlyHere[cat.id] ?? 0
    if (turningOff && !confirm(
      `Turn off "${cat.name}"?\n\nCustomers will no longer see this category — or ${stranded === 0 ? 'any art that lives only here (none today)' : `the ${stranded} piece${stranded === 1 ? '' : 's'} of art that live${stranded === 1 ? 's' : ''} only here`} — in browsing or search. Nothing is deleted; the admin still shows it all, and you can turn it back on any time.`
    )) return
    const { error } = await supabase.from('clipart_categories').update({ is_active: !cat.is_active }).eq('id', cat.id)
    if (error) { showMessage('Error: ' + error.message, 'error'); return }
    setCategories(prev => prev.map(c => c.id === cat.id ? { ...c, is_active: !cat.is_active } : c))
    showMessage(turningOff ? 'Category turned off — hidden from customers.' : 'Category turned on.')
  }

  // Reorder (⤒ ▲ ▼ ⤓) — the customer Art panel follows this order. Same move → resequence → persist only the
  // changed rows pattern as colors / fonts / templates.
  const moveCategory = async (cat: Category, dir: 'up' | 'down' | 'top' | 'bottom') => {
    if (catBusy) return
    const idx = categories.findIndex(c => c.id === cat.id)
    const target = dir === 'up' ? idx - 1 : dir === 'down' ? idx + 1 : dir === 'top' ? 0 : categories.length - 1
    if (idx < 0 || target === idx || target < 0 || target >= categories.length) return
    const arr = [...categories]
    arr.splice(idx, 1)
    arr.splice(target, 0, categories[idx])
    const next = arr.map((c, i) => ({ ...c, sort_order: i }))
    const toPersist = next.filter(c => (categories.find(o => o.id === c.id)?.sort_order ?? -1) !== c.sort_order)
    setCatBusy(true)
    setCategories(next) // optimistic
    const results = await Promise.all(toPersist.map(c => supabase.from('clipart_categories').update({ sort_order: c.sort_order }).eq('id', c.id)))
    setCatBusy(false)
    const err = results.find(r => r.error)?.error
    if (err) {
      showMessage('Error reordering: ' + err.message, 'error')
      const { data } = await supabase.from('clipart_categories').select('*').order('sort_order').order('name')
      if (data) setCategories(data)
    }
  }

  // Delete — only an EMPTY category. Art references categories by id in a plain list, so deleting one that
  // still has art would leave invisible broken references on every piece; turn it off instead.
  const deleteCategory = async (cat: Category) => {
    if ((catStats.count[cat.id] ?? 0) > 0) { showMessage('This category still has art — turn it off instead, or move the art first.', 'error'); return }
    if (!confirm(`Delete the empty category "${cat.name}"? This cannot be undone.`)) return
    const { error } = await supabase.from('clipart_categories').delete().eq('id', cat.id)
    if (error) { showMessage('Error deleting: ' + error.message, 'error'); return }
    setCategories(prev => prev.filter(c => c.id !== cat.id))
    if (selectedCategory === cat.id) setSelectedCategory(categories.find(c => c.id !== cat.id)?.id ?? '')
    showMessage('Category deleted.')
  }

  const createCategory = async () => {
    if (!newCategoryName.trim()) return
    const nextOrder = categories.length ? Math.max(...categories.map(c => c.sort_order ?? 0)) + 1 : 0
    const { data, error } = await supabase
      .from('clipart_categories')
      .insert({ name: newCategoryName.trim(), is_active: true, sort_order: nextOrder })
      .select()
      .single()
    if (error) { showMessage('Error: ' + error.message, 'error'); return }
    setCategories(prev => [...prev, data])
    setSelectedCategory(data.id)
    setNewCategoryName('')
    setShowNewCategory(false)
    showMessage('Category created!')
  }

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-mono font-bold text-black">Art Library</h1>
          <p className="text-gray-600 text-sm font-mono mt-1">Manage art, categories, methods, and {t('admin.design_number')}s</p>
        </div>

        {message && (
          <div className={`fixed top-6 right-6 px-4 py-3 rounded font-mono text-sm z-50 ${
            message.type === 'success' ? 'bg-[#dd3333] text-white' : 'bg-red-600 text-white'
          }`}>
            {message.text}
          </div>
        )}

        <div className="flex gap-6">

          {/* Sidebar - Categories */}
          <div className="w-80 shrink-0">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-mono uppercase tracking-widest text-gray-600">Categories</h2>
              <button onClick={() => setShowNewCategory(!showNewCategory)}
                className="text-xs text-[#dd3333] font-mono hover:text-red-700 transition-all">+ New</button>
            </div>

            {showNewCategory && (
              <div className="mb-3 flex gap-1">
                <input
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createCategory()}
                  placeholder="Category name..."
                  className="flex-1 bg-white border border-[#dd3333] rounded px-2 py-1 text-xs text-black outline-none font-mono"
                />
                <button onClick={createCategory}
                  className="px-2 py-1 bg-[#dd3333] text-white rounded text-xs font-mono font-bold hover:bg-red-700 transition-all">
                  Add
                </button>
              </div>
            )}

            {/* One row per category: ⤒▲▼⤓ order (customers follow it) · name (click = browse; ✎ = rename,
                live immediately) · art count · ●/○ on-off (off = hidden from customers entirely) · 🗑 only
                when empty. Off categories render dimmed, like off art. */}
            <div className="flex flex-col gap-1">
              {categories.map((cat, i) => {
                const selected = selectedCategory === cat.id
                const count = catStats.count[cat.id] ?? 0
                return (
                  <div key={cat.id} className={`flex items-center gap-1 rounded pr-1 ${selected ? 'bg-[#dd3333] text-white' : 'bg-gray-100 text-black'} ${cat.is_active ? '' : 'opacity-60'}`}>
                    <div className={`flex flex-col shrink-0 pl-1 ${selected ? 'text-white/80' : ''}`}>
                      <div className="flex">
                        <button onClick={() => moveCategory(cat, 'top')} disabled={i === 0 || catBusy} title="Move to top" className={BTN_CAT}>⤒</button>
                        <button onClick={() => moveCategory(cat, 'up')} disabled={i === 0 || catBusy} title="Move up" className={BTN_CAT}>▲</button>
                      </div>
                      <div className="flex">
                        <button onClick={() => moveCategory(cat, 'bottom')} disabled={i === categories.length - 1 || catBusy} title="Move to bottom" className={BTN_CAT}>⤓</button>
                        <button onClick={() => moveCategory(cat, 'down')} disabled={i === categories.length - 1 || catBusy} title="Move down" className={BTN_CAT}>▼</button>
                      </div>
                    </div>
                    {editingCat === cat.id ? (
                      <input
                        autoFocus
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') e.currentTarget.blur()                                  // save once, via blur
                          if (e.key === 'Escape') { cancelRenameRef.current = true; e.currentTarget.blur() } // discard
                        }}
                        onBlur={() => renameCategory(cat)}
                        className="min-w-0 flex-1 rounded border border-[#dd3333] bg-white px-2 py-1 text-xs font-mono text-black outline-none"
                      />
                    ) : (
                      <button onClick={() => setSelectedCategory(cat.id)}
                        className={`min-w-0 flex-1 truncate px-2 py-2 text-left text-xs font-mono transition-all ${selected ? 'font-bold' : 'hover:text-[#dd3333]'}`}>
                        {cat.name}{cat.is_active ? '' : ' (off)'}
                      </button>
                    )}
                    <span className={`shrink-0 text-[10px] font-mono tabular-nums ${selected ? 'text-white/80' : 'text-gray-500'}`} title="Art in this category">{count}</span>
                    <button onClick={() => { setEditingCat(cat.id); setEditName(cat.name) }} title="Rename (live for customers immediately)"
                      className={`shrink-0 px-1 text-[11px] ${selected ? 'text-white/80 hover:text-white' : 'text-gray-500 hover:text-[#dd3333]'}`}>✎</button>
                    <button onClick={() => toggleCategoryActive(cat)} title={cat.is_active ? 'Turn off — hides this category and any art that lives only here from customers' : 'Turn on'}
                      className={`shrink-0 px-1 text-[11px] ${selected ? 'text-white/80 hover:text-white' : cat.is_active ? 'text-gray-700 hover:text-[#dd3333]' : 'text-gray-400 hover:text-[#dd3333]'}`}>{cat.is_active ? '●' : '○'}</button>
                    <button onClick={() => deleteCategory(cat)} disabled={count > 0} title={count > 0 ? 'Only an empty category can be deleted — turn it off instead' : 'Delete this empty category'}
                      className={`shrink-0 px-1 text-[11px] disabled:opacity-25 ${selected ? 'text-white/80 hover:text-white' : 'text-gray-500 hover:text-[#dd3333]'}`}>🗑</button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Main content */}
          <div className="flex-1">

            {/* Upload area */}
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleUpload(e.dataTransfer.files) }}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-6 mb-6 text-center cursor-pointer hover:border-[#dd3333] transition-all group bg-gray-50">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".svg,.png,.jpg,.jpeg,.webp"
                className="hidden"
                onChange={e => handleUpload(e.target.files)}
              />
              {uploading ? (
                <p className="text-[#dd3333] font-mono text-sm">Uploading...</p>
              ) : (
                <>
                  <p className="text-black font-mono text-sm group-hover:text-[#dd3333] transition-all">
                    Drop art files here or click to upload
                  </p>
                  <p className="text-gray-500 font-mono text-xs mt-1">
                    SVG, PNG, JPG, WEBP · new art starts as Print-only, in this category
                  </p>
                  <p className="text-gray-400 font-mono text-[11px] mt-1 leading-snug">
                    Best quality: <b>SVG preferred</b> (stays crisp at any size — keep the file tiny).
                    PNG/JPG: <b>~1024px on the longest side</b> (screen crispness only; the bench prints from
                    the original in the decal folder). No need for print resolution here.
                  </p>
                </>
              )}
            </div>

            {/* Search + sort (this category) */}
            {items.length > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[14rem]">
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search this category — name, tag, or Design #"
                    className="w-full bg-white border border-gray-300 rounded px-3 py-1.5 pr-8 text-sm text-black outline-none focus:border-[#dd3333] font-mono placeholder-gray-400"
                  />
                  {search && (
                    <button type="button" onClick={() => setSearch('')} aria-label="Clear search"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded text-gray-500 hover:bg-gray-100">✕</button>
                  )}
                </div>
                <label className="flex items-center gap-2 text-xs font-mono text-gray-600">
                  Sort
                  <select value={sortBy} onChange={e => changeSort(e.target.value as ArtSort)}
                    className="bg-white border border-gray-300 rounded px-2 py-1.5 text-sm text-black outline-none focus:border-[#dd3333]">
                    {ART_SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </label>
                <span className="text-xs font-mono text-gray-500 tabular-nums">
                  {search.trim() ? `${visibleItems.length} of ${items.length}` : `${items.length} items`}
                </span>
              </div>
            )}

            {/* Items grid */}
            {loading ? (
              <p className="text-gray-600 font-mono text-sm text-center py-12">Loading...</p>
            ) : items.length === 0 ? (
              <p className="text-gray-600 font-mono text-sm text-center py-12">No art in this category yet. Upload some above!</p>
            ) : visibleItems.length === 0 ? (
              <p className="text-gray-600 font-mono text-sm text-center py-12">No art in this category matches &ldquo;{search.trim()}&rdquo;.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {visibleItems.map(item => (
                  <div key={item.id} className={`bg-white border rounded-lg p-3 flex flex-col gap-2 ${
                    item.is_active ? 'border-gray-200' : 'border-red-300 opacity-60'
                  }`}>
                    <div className="bg-gray-50 rounded p-2 flex items-center justify-center h-24 border border-gray-100">
                      <img src={item.file_url} alt={item.name}
                        className="max-w-full max-h-full object-contain" />
                    </div>

                    <p className="text-xs font-mono text-black truncate text-center">{item.name}</p>

                    {/* Methods — Print / Embroidery (persists on click; Print-only by default) */}
                    <div className="flex gap-1">
                      {METHODS.map(m => {
                        const on = (item.supported_methods || []).includes(m.key)
                        return (
                          <button key={m.key} onClick={() => toggleMethod(item, m.key)}
                            className={`flex-1 py-1 rounded text-[10px] font-mono border transition-all ${
                              on
                                ? 'bg-gray-900 text-white border-gray-900'
                                : 'bg-white text-gray-400 border-gray-300 hover:border-gray-500'
                            }`}>
                            {m.label}
                          </button>
                        )
                      })}
                    </div>

                    {/* Decal # */}
                    <input
                      value={decalInputs[item.id] || ''}
                      onChange={e => setDecalInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && saveItem(item.id)}
                      placeholder={t('admin.design_number')}
                      inputMode="numeric"
                      className="w-full bg-white border border-emerald-300 rounded px-2 py-1 text-[10px] text-black outline-none focus:border-emerald-500 font-mono placeholder-gray-400"
                    />

                    {/* Light artwork → deep links land on the garment's darkest color; Build 2 renders on black. */}
                    <label
                      title="Tick for white or very light designs. A Grab 'n Go link then opens the garment in its darkest color so the design is visible on arrival, and the catalog image renders it on a black tee."
                      className="flex items-center gap-1.5 text-[10px] font-mono text-black cursor-pointer">
                      <input type="checkbox" checked={!!item.is_light} onChange={() => toggleLight(item)} className="accent-[#dd3333]" />
                      {t('admin.light_artwork', 'Light artwork — show on a dark garment')}
                    </label>

                    {/* Categories — an art can be in several. Click to expand the checklist. */}
                    <button
                      onClick={() => setOpenCategoriesFor(openCategoriesFor === item.id ? null : item.id)}
                      className="w-full py-1 rounded text-[10px] font-mono bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200 transition-all">
                      Categories ({(item.category_ids || []).length}) {openCategoriesFor === item.id ? '▴' : '▾'}
                    </button>
                    {openCategoriesFor === item.id && (
                      <div className="max-h-32 overflow-y-auto rounded border border-gray-200 bg-white p-1.5 flex flex-col gap-1">
                        {categories.map(cat => (
                          <label key={cat.id} className="flex items-center gap-1.5 text-[10px] font-mono text-black cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(item.category_ids || []).includes(cat.id)}
                              onChange={() => toggleCategory(item, cat.id)}
                              className="accent-[#dd3333]"
                            />
                            {cat.name}
                          </label>
                        ))}
                      </div>
                    )}

                    {/* Tags (search keywords) */}
                    <input
                      value={tagInputs[item.id] || ''}
                      onChange={e => setTagInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && saveItem(item.id)}
                      placeholder="tags, comma, separated"
                      className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-[10px] text-black outline-none focus:border-[#dd3333] font-mono placeholder-gray-400"
                    />

                    <div className="flex gap-1">
                      <button onClick={() => saveItem(item.id)}
                        className="flex-1 py-1 rounded text-[10px] font-mono bg-[#dd3333] text-white hover:bg-red-700 transition-all">
                        {saving === item.id ? '...' : 'Save'}
                      </button>
                      <button onClick={() => toggleActive(item)}
                        title={item.is_active ? 'Deactivate' : 'Activate'}
                        className={`px-2 py-1 rounded text-[10px] font-mono transition-all border ${
                          item.is_active
                            ? 'bg-white text-green-700 border-green-300 hover:bg-green-50'
                            : 'bg-red-50 text-red-700 border-red-300'
                        }`}>
                        {item.is_active ? '●' : '○'}
                      </button>
                      <button onClick={() => deleteItem(item)}
                        className="px-2 py-1 rounded text-[10px] font-mono bg-white text-red-600 border border-gray-300 hover:bg-red-50 hover:border-red-300 transition-all">
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
