'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Tables } from '@/types/database'

type Category = Pick<Tables<'clipart_categories'>, 'id' | 'name'>
type ClipartItem = Pick<Tables<'clipart_items'>, 'id' | 'name' | 'file_url' | 'file_type' | 'category_id' | 'tags'>

interface Props {
  printMethod: string
  onSelect: (url: string, fileType: string) => void
}

export default function ClipartPanel({ printMethod, onSelect }: Props) {
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [items, setItems] = useState<ClipartItem[]>([])
  const [allItems, setAllItems] = useState<ClipartItem[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  // Load categories
  useEffect(() => {
    if (!printMethod) return
    supabase
      .from('clipart_categories')
      .select('id, name')
      .eq('print_method_key', printMethod)
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        if (data && data.length > 0) {
          setCategories(data)
          setSelectedCategory(data[0].id)
        }
      })
  }, [printMethod])

  // Load ALL items once for search (including tags)
  useEffect(() => {
    if (!printMethod) return
    supabase
      .from('clipart_items')
      .select('id, name, file_url, file_type, category_id, tags')
      .eq('print_method_key', printMethod)
      .eq('is_active', true)
      .then(({ data }) => {
        setAllItems(data || [])
      })
  }, [printMethod])

  // Load items when category changes
  useEffect(() => {
    if (!selectedCategory) return
    setLoading(true)
    supabase
      .from('clipart_items')
      .select('id, name, file_url, file_type, category_id, tags')
      .eq('category_id', selectedCategory)
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        setItems(data || [])
        setLoading(false)
      })
  }, [selectedCategory])

  // Search matches name OR tags
  const filtered = search.trim()
    ? allItems.filter(item =>
        item.name.toLowerCase().includes(search.toLowerCase()) ||
        (item.tags && item.tags.some((tag: string) => tag.toLowerCase().includes(search.toLowerCase())))
      )
    : items

  const selectedCategoryName = categories.find(c => c.id === selectedCategory)?.name || ''

  return (
    <div className="flex flex-col gap-2">
      {/* Search */}
      <input
        type="text"
        placeholder="Search all clipart..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full bg-white border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 outline-none focus:border-[#dd3333]"
      />

      {/* Category dropdown - hidden when searching */}
      {!search.trim() && (
        <select
          value={selectedCategory}
          onChange={e => setSelectedCategory(e.target.value)}
          className="w-full bg-white border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 outline-none focus:border-[#dd3333] font-mono cursor-pointer"
        >
          {categories.map(cat => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
      )}

      {/* Search results label */}
      {search.trim() && (
        <p className="text-xs text-gray-600 font-mono">
          {filtered.length} result{filtered.length !== 1 ? 's' : ''} for &ldquo;{search}&rdquo;
        </p>
      )}

      {/* Clipart grid */}
      {loading ? (
        <p className="text-xs text-gray-600 text-center py-4">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-gray-600 text-center py-4">No clipart found</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 max-h-96 overflow-y-auto pr-1">
          {filtered.map(item => (
            <button
              key={item.id}
              onClick={() => onSelect(item.file_url, item.file_type ?? 'image')}
              title={item.name}
              className="bg-white border border-gray-200 rounded-lg p-2 hover:border-[#dd3333] transition-all flex flex-col items-center gap-1"
            >
              <img
                src={item.file_url}
                alt={item.name}
                className="w-12 h-12 object-contain"
                decoding="async"
              />
              <span className="text-[9px] text-gray-600 font-mono text-center leading-tight truncate w-full">
                {item.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
