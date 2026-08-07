'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import type { Tables } from '@/types/database'

type Category = Tables<'clipart_categories'>
type ClipartItem = Tables<'clipart_items'>

export default function ClipartAdmin() {
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [items, setItems] = useState<ClipartItem[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryMethod, setNewCategoryMethod] = useState('screen_print')
  const [newCategoryIsDesign, setNewCategoryIsDesign] = useState(false)
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [tagInputs, setTagInputs] = useState<Record<string, string>>({})
  // Per-item decal-number input (only shown for items in a Designs category), keyed by item.id.
  const [decalInputs, setDecalInputs] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const showMessage = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  useEffect(() => {
    supabase
      .from('clipart_categories')
      .select('*')
      .order('name')
      .then(({ data }) => {
        if (data) {
          setCategories(data)
          if (data.length > 0) setSelectedCategory(data[0].id)
        }
      })
  }, [])

  useEffect(() => {
    if (!selectedCategory) return
    setLoading(true)
    supabase
      .from('clipart_items')
      .select('*')
      .eq('category_id', selectedCategory)
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
        setLoading(false)
      })
  }, [selectedCategory])

  // Whether the currently-selected category is a Designs (decal) category — gates the
  // per-item decal-number field.
  const isDesignCategory = !!categories.find(c => c.id === selectedCategory)?.is_design

  // Saves tags (always) plus, for a Designs category, the decal number — in one update.
  const saveItem = async (itemId: string) => {
    setSaving(itemId)
    const tagString = tagInputs[itemId] || ''
    const tags = tagString.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    const patch: { tags: string[]; decal_number?: number | null } = { tags }
    if (isDesignCategory) {
      const raw = (decalInputs[itemId] || '').trim()
      if (raw && !/^\d+$/.test(raw)) {
        setSaving(null)
        showMessage('Decal number must be a whole number.', 'error')
        return
      }
      patch.decal_number = raw ? parseInt(raw, 10) : null
    }
    const { error } = await supabase
      .from('clipart_items')
      .update(patch)
      .eq('id', itemId)
    setSaving(null)
    if (error) showMessage('Error saving: ' + error.message, 'error')
    else {
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, ...patch } : i))
      showMessage('Saved!')
    }
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

      const { data: newItem, error: insertError } = await supabase
        .from('clipart_items')
        .insert({
          category_id: selectedCategory,
          name: safeName.replace(/_/g, ' '),
          file_url: urlData.publicUrl,
          file_type: ext === 'svg' ? 'svg' : 'image',
          print_method_key: category.print_method_key,
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
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const createCategory = async () => {
    if (!newCategoryName.trim()) return
    const { data, error } = await supabase
      .from('clipart_categories')
      .insert({ name: newCategoryName.trim(), print_method_key: newCategoryMethod, is_design: newCategoryIsDesign, is_active: true, sort_order: categories.length + 1 })
      .select()
      .single()
    if (error) { showMessage('Error: ' + error.message, 'error'); return }
    setCategories(prev => [...prev, data])
    setSelectedCategory(data.id)
    setNewCategoryName('')
    setNewCategoryMethod('screen_print')
    setNewCategoryIsDesign(false)
    setShowNewCategory(false)
    showMessage('Category created!')
  }

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-mono font-bold text-black">Clipart Admin</h1>
          <p className="text-gray-600 text-sm font-mono mt-1">Manage clipart, tags, and uploads</p>
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
          <div className="w-56 shrink-0">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-mono uppercase tracking-widest text-gray-600">Categories</h2>
              <button onClick={() => setShowNewCategory(!showNewCategory)}
                className="text-xs text-[#dd3333] font-mono hover:text-red-700 transition-all">+ New</button>
            </div>

            {showNewCategory && (
              <div className="mb-3 flex flex-col gap-1">
                <div className="flex gap-1">
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
                {/* Which print method this category's clipart is for — the designer only shows a category's
                    items when its method matches the product's active method (embroidery vs print). */}
                <select
                  value={newCategoryMethod}
                  onChange={e => setNewCategoryMethod(e.target.value)}
                  className="bg-white border border-gray-300 rounded px-2 py-1 text-xs text-black outline-none font-mono"
                >
                  <option value="screen_print">Print</option>
                  <option value="embroidery">Embroidery</option>
                </select>
                {/* Clipart vs Designs (decals). A Designs category browses as its own "Designs" section in
                    the designer, and its items each carry a decal number the print shop tracks. */}
                <select
                  value={newCategoryIsDesign ? 'design' : 'clipart'}
                  onChange={e => setNewCategoryIsDesign(e.target.value === 'design')}
                  className="bg-white border border-gray-300 rounded px-2 py-1 text-xs text-black outline-none font-mono"
                >
                  <option value="clipart">Clipart</option>
                  <option value="design">Designs (decals)</option>
                </select>
              </div>
            )}

            <div className="flex flex-col gap-1">
              {categories.map(cat => (
                <button key={cat.id} onClick={() => setSelectedCategory(cat.id)}
                  className={`text-left px-3 py-2 rounded text-xs font-mono transition-all ${
                    selectedCategory === cat.id
                      ? 'bg-[#dd3333] text-white font-bold'
                      : 'bg-gray-100 text-black hover:bg-gray-200'
                  }`}>
                  {cat.name}
                  {cat.print_method_key === 'embroidery' && (
                    <span className={`ml-1.5 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide ${selectedCategory === cat.id ? 'bg-white/25 text-white' : 'bg-indigo-100 text-indigo-700'}`}>
                      Emb
                    </span>
                  )}
                  {cat.is_design && (
                    <span className={`ml-1.5 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide ${selectedCategory === cat.id ? 'bg-white/25 text-white' : 'bg-emerald-100 text-emerald-700'}`}>
                      Design
                    </span>
                  )}
                  <span className={`float-right font-normal ${selectedCategory === cat.id ? 'text-white/80' : 'text-gray-500'}`}>
                    {selectedCategory === cat.id ? items.length : ''}
                  </span>
                </button>
              ))}
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
                    Drop clipart files here or click to upload
                  </p>
                  <p className="text-gray-500 font-mono text-xs mt-1">SVG, PNG, JPG, WEBP supported</p>
                </>
              )}
            </div>

            {/* Items grid */}
            {loading ? (
              <p className="text-gray-600 font-mono text-sm text-center py-12">Loading...</p>
            ) : items.length === 0 ? (
              <p className="text-gray-600 font-mono text-sm text-center py-12">No clipart in this category yet. Upload some above!</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {items.map(item => (
                  <div key={item.id} className={`bg-white border rounded-lg p-3 flex flex-col gap-2 ${
                    item.is_active ? 'border-gray-200' : 'border-red-300 opacity-60'
                  }`}>
                    <div className="bg-gray-50 rounded p-2 flex items-center justify-center h-24 border border-gray-100">
                      <img src={item.file_url} alt={item.name}
                        className="max-w-full max-h-full object-contain" />
                    </div>

                    <p className="text-xs font-mono text-black truncate text-center">{item.name}</p>

                    {isDesignCategory && (
                      <input
                        value={decalInputs[item.id] || ''}
                        onChange={e => setDecalInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && saveItem(item.id)}
                        placeholder="Decal #"
                        inputMode="numeric"
                        className="w-full bg-white border border-emerald-300 rounded px-2 py-1 text-[10px] text-black outline-none focus:border-emerald-500 font-mono placeholder-gray-400"
                      />
                    )}

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
