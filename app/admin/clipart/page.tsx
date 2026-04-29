'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '../../lib/supabase'

interface Category {
  id: string
  name: string
  print_method_key: string
}

interface ClipartItem {
  id: string
  name: string
  file_url: string
  file_type: string
  category_id: string
  tags: string[]
  is_active: boolean
  sort_order: number
}

export default function ClipartAdmin() {
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [items, setItems] = useState<ClipartItem[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [tagInputs, setTagInputs] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const showMessage = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  // Load categories
  useEffect(() => {
    supabase
      .from('clipart_categories')
      .select('id, name, print_method_key')
      .order('name')
      .then(({ data }) => {
        if (data) {
          setCategories(data)
          if (data.length > 0) setSelectedCategory(data[0].id)
        }
      })
  }, [])

  // Load items when category changes
  useEffect(() => {
    if (!selectedCategory) return
    setLoading(true)
    supabase
      .from('clipart_items')
      .select('id, name, file_url, file_type, category_id, tags, is_active, sort_order')
      .eq('category_id', selectedCategory)
      .order('sort_order')
      .then(({ data }) => {
        setItems(data || [])
        const inputs: Record<string, string> = {}
        data?.forEach(item => {
          inputs[item.id] = (item.tags || []).join(', ')
        })
        setTagInputs(inputs)
        setLoading(false)
      })
  }, [selectedCategory])

  // Save tags for an item
  const saveTags = async (itemId: string) => {
    setSaving(itemId)
    const tagString = tagInputs[itemId] || ''
    const tags = tagString.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    const { error } = await supabase
      .from('clipart_items')
      .update({ tags })
      .eq('id', itemId)
    setSaving(null)
    if (error) showMessage('Error saving tags: ' + error.message, 'error')
    else showMessage('Tags saved!')
  }

  // Toggle active status
  const toggleActive = async (item: ClipartItem) => {
    await supabase
      .from('clipart_items')
      .update({ is_active: !item.is_active })
      .eq('id', item.id)
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_active: !i.is_active } : i))
  }

  // Delete item
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

  // Upload clipart files directly using anon client (storage bucket is open)
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

      // Upload directly to storage (bucket policies allow anon uploads)
      const { error: uploadError } = await supabase.storage
        .from('clipart')
        .upload(path, file, { upsert: true })

      if (uploadError) {
        showMessage(`Error uploading ${file.name}: ${uploadError.message}`, 'error')
        continue
      }

      const { data: urlData } = supabase.storage.from('clipart').getPublicUrl(path)

      // Insert DB row (RLS disabled on clipart_items)
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
        showMessage(`Uploaded ${file.name}!`)
      }
    }

    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Create new category
  const createCategory = async () => {
    if (!newCategoryName.trim()) return
    const { data, error } = await supabase
      .from('clipart_categories')
      .insert({ name: newCategoryName.trim(), print_method_key: 'screen_print', is_active: true, sort_order: categories.length + 1 })
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
    <div className="min-h-screen bg-[#0a0a0a] text-white p-6">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-mono font-bold text-[#dd3333]">Clipart Admin</h1>
            <p className="text-gray-500 text-sm font-mono mt-1">Manage clipart, tags, and uploads</p>
          </div>
          <div className="flex gap-2">
            <a href="/designer?product_id=10043960623420&variant_id=51740953837884&title=Unisex+Heavyweight+T&price=2400"
              className="px-4 py-2 rounded text-xs font-mono bg-[#1e1e1e] border border-[#2a2a2a] text-gray-400 hover:border-[#dd3333] hover:text-white transition-all">
              ← Back to Designer
            </a>
            <button onClick={async () => {
              await fetch('/api/admin-auth', { method: 'DELETE' })
              window.location.href = '/admin-login'
            }}
              className="px-4 py-2 rounded text-xs font-mono bg-[#1e1e1e] border border-[#2a2a2a] text-gray-400 hover:border-red-500 hover:text-red-400 transition-all">
              Logout
            </button>
          </div>
        </div>

        {/* Message toast */}
        {message && (
          <div className={`fixed top-6 right-6 px-4 py-3 rounded font-mono text-sm z-50 ${
            message.type === 'success' ? 'bg-[#dd3333] text-black' : 'bg-red-500 text-white'
          }`}>
            {message.text}
          </div>
        )}

        <div className="flex gap-6">

          {/* Sidebar - Categories */}
          <div className="w-56 shrink-0">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-mono uppercase tracking-widest text-gray-500">Categories</h2>
              <button onClick={() => setShowNewCategory(!showNewCategory)}
                className="text-xs text-[#dd3333] font-mono hover:text-white transition-all">+ New</button>
            </div>

            {showNewCategory && (
              <div className="mb-3 flex gap-1">
                <input
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createCategory()}
                  placeholder="Category name..."
                  className="flex-1 bg-[#1e1e1e] border border-[#dd3333] rounded px-2 py-1 text-xs text-white outline-none font-mono"
                />
                <button onClick={createCategory}
                  className="px-2 py-1 bg-[#dd3333] text-black rounded text-xs font-mono font-bold">
                  Add
                </button>
              </div>
            )}

            <div className="flex flex-col gap-1">
              {categories.map(cat => (
                <button key={cat.id} onClick={() => setSelectedCategory(cat.id)}
                  className={`text-left px-3 py-2 rounded text-xs font-mono transition-all ${
                    selectedCategory === cat.id
                      ? 'bg-[#dd3333] text-white font-bold'
                      : 'bg-[#1a1a1a] text-gray-400 hover:bg-[#222] hover:text-white'
                  }`}>
                  {cat.name}
                  <span className="float-right text-gray-500 font-normal">
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
              className="border-2 border-dashed border-[#2a2a2a] rounded-lg p-6 mb-6 text-center cursor-pointer hover:border-[#dd3333] transition-all group">
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
                  <p className="text-gray-400 font-mono text-sm group-hover:text-white transition-all">
                    Drop clipart files here or click to upload
                  </p>
                  <p className="text-gray-600 font-mono text-xs mt-1">SVG, PNG, JPG, WEBP supported</p>
                </>
              )}
            </div>

            {/* Items grid */}
            {loading ? (
              <p className="text-gray-500 font-mono text-sm text-center py-12">Loading...</p>
            ) : items.length === 0 ? (
              <p className="text-gray-500 font-mono text-sm text-center py-12">No clipart in this category yet. Upload some above!</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {items.map(item => (
                  <div key={item.id} className={`bg-[#111] border rounded-lg p-3 flex flex-col gap-2 ${
                    item.is_active ? 'border-[#2a2a2a]' : 'border-red-900 opacity-60'
                  }`}>
                    {/* Image */}
                    <div className="bg-[#1a1a1a] rounded p-2 flex items-center justify-center h-24">
                      <img src={item.file_url} alt={item.name}
                        className="max-w-full max-h-full object-contain" />
                    </div>

                    {/* Name */}
                    <p className="text-xs font-mono text-gray-300 truncate text-center">{item.name}</p>

                    {/* Tags input */}
                    <input
                      value={tagInputs[item.id] || ''}
                      onChange={e => setTagInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && saveTags(item.id)}
                      placeholder="tags, comma, separated"
                      className="w-full bg-[#0a0a0a] border border-[#333] rounded px-2 py-1 text-[10px] text-gray-400 outline-none focus:border-[#dd3333] font-mono"
                    />

                    {/* Actions */}
                    <div className="flex gap-1">
                      <button onClick={() => saveTags(item.id)}
                        className="flex-1 py-1 rounded text-[10px] font-mono bg-[#dd3333] text-black hover:bg-yellow-300 transition-all">
                        {saving === item.id ? '...' : 'Save'}
                      </button>
                      <button onClick={() => toggleActive(item)}
                        title={item.is_active ? 'Deactivate' : 'Activate'}
                        className={`px-2 py-1 rounded text-[10px] font-mono transition-all ${
                          item.is_active
                            ? 'bg-[#1e1e1e] text-gray-400 hover:bg-green-900 hover:text-green-400'
                            : 'bg-green-900 text-green-400'
                        }`}>
                        {item.is_active ? '●' : '○'}
                      </button>
                      <button onClick={() => deleteItem(item)}
                        className="px-2 py-1 rounded text-[10px] font-mono bg-[#1e1e1e] text-red-500 hover:bg-red-900 transition-all">
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
