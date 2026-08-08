'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useT } from './StringsProvider'
import type { Tables } from '@/types/database'

type Category = Pick<Tables<'clipart_categories'>, 'id' | 'name'>
type ClipartItem = Pick<Tables<'clipart_items'>, 'id' | 'name' | 'file_url' | 'file_type' | 'tags' | 'decal_number' | 'category_ids' | 'supported_methods'>

// Decal metadata carried to placement/capture when an art carries a decal number.
export type DecalMeta = { number: number; name: string }
// Metadata stamped on a placed art: its decal number (if any) + which print methods it supports (so a
// method switch can KEEP art that's available in the new method instead of removing it).
export type ArtMeta = { decal?: DecalMeta; supportedMethods?: string[] }

interface Props {
  printMethod: string
  onSelect: (url: string, fileType: string, meta?: ArtMeta) => void
  // Mobile band layout: category CHIPS + one horizontal thumbnail row instead of
  // the desktop dropdown + vertical grid. Defaults false → desktop is byte-identical.
  horizontal?: boolean
  // Hide the search box (mobile band, when edit controls need the room). Default
  // true → desktop and browse-mode unchanged.
  showSearch?: boolean
}

// ClipartPanel — the unified "Art" browser. Art carries its own supported_methods and can live in
// several categories (category_ids). One method-scoped fetch drives BOTH the category browse and the
// search, so an embroidery product only ever sees embroidery-capable art. Customers find art by
// category or by searching a name / Decal #.
export default function ClipartPanel({ printMethod, onSelect, horizontal = false, showSearch = true }: Props) {
  const t = useT() // admin-editable wording (Language editor)
  const [categories, setCategories] = useState<Category[]>([])
  const [allItems, setAllItems] = useState<ClipartItem[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  // Category names (labels). Art references categories by id (category_ids); we map id → name here.
  useEffect(() => {
    supabase
      .from('clipart_categories')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setCategories(data || []))
  }, [])

  // All art available for the product's current method — one fetch drives category browse + search.
  useEffect(() => {
    if (!printMethod) return
    setLoading(true)
    supabase
      .from('clipart_items')
      .select('id, name, file_url, file_type, tags, decal_number, category_ids, supported_methods')
      .contains('supported_methods', [printMethod])
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        setAllItems(data || [])
        setLoading(false)
      })
  }, [printMethod])

  // Only show categories that actually contain art for this method — no empty buckets.
  const usedCategoryIds = new Set<string>()
  allItems.forEach(i => (i.category_ids || []).forEach(id => usedCategoryIds.add(id)))
  const visibleCategories = categories.filter(c => usedCategoryIds.has(c.id))

  // Keep a valid selection without an effect: fall back to the first visible category.
  const effectiveCategory = visibleCategories.some(c => c.id === selectedCategory)
    ? selectedCategory
    : (visibleCategories[0]?.id ?? '')

  // Search matches name, tags, OR Decal # (type a number to jump to that design).
  const q = search.trim().toLowerCase()
  const filtered = q
    ? allItems.filter(i =>
        i.name.toLowerCase().includes(q) ||
        (i.decal_number != null && String(i.decal_number).includes(q)) ||
        (i.tags && i.tags.some((tag: string) => tag.toLowerCase().includes(q)))
      )
    : allItems.filter(i => (i.category_ids || []).includes(effectiveCategory))

  // Metadata to stamp on a placement: decal number (for order sell-through, when the art has one) +
  // which methods the art supports (so a method switch keeps art that's valid in the new method).
  const metaFor = (item: ClipartItem): ArtMeta => ({
    decal: item.decal_number != null ? { number: item.decal_number, name: item.name } : undefined,
    supportedMethods: item.supported_methods ?? undefined,
  })

  return (
    <div className={horizontal ? 'flex h-full flex-col gap-2' : 'flex flex-col gap-2'}>
      {/* Search */}
      {showSearch && (
        <input
          type="text"
          placeholder={t('designer.art.search_placeholder', 'Search art or Decal #...')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className={horizontal
            ? 'w-full shrink-0 bg-white border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 outline-none focus:border-[#dd3333]'
            : 'w-full bg-white border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 outline-none focus:border-[#dd3333]'}
        />
      )}

      {/* Category selector — chips (mobile) / dropdown (desktop); hidden when searching */}
      {!search.trim() && (
        horizontal ? (
          <div className="flex shrink-0 gap-1.5 overflow-x-auto pb-0.5">
            {visibleCategories.map(cat => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-mono transition-colors ${
                  effectiveCategory === cat.id
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-300'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        ) : (
          <select
            value={effectiveCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            className="w-full bg-white border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 outline-none focus:border-[#dd3333] font-mono cursor-pointer"
          >
            {visibleCategories.map(cat => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        )
      )}

      {/* Search results label */}
      {search.trim() && (
        <p className={horizontal ? 'shrink-0 text-xs text-gray-600 font-mono' : 'text-xs text-gray-600 font-mono'}>
          {filtered.length} result{filtered.length !== 1 ? 's' : ''} for &ldquo;{search}&rdquo;
        </p>
      )}

      {/* Art tiles — horizontal row (mobile) / vertical grid (desktop) */}
      {loading ? (
        <p className="text-xs text-gray-600 text-center py-4">{t('designer.art.loading', 'Loading...')}</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-gray-600 text-center py-4">{t('designer.art.empty', 'No art found')}</p>
      ) : horizontal ? (
        <div className="flex min-h-0 flex-1 items-center gap-2 overflow-x-auto pb-1">
          {filtered.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.file_url, item.file_type ?? 'image', metaFor(item))}
              title={item.name}
              className="flex w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white p-1.5"
            >
              <img src={item.file_url} alt={item.name} className="h-10 w-10 object-contain" decoding="async" />
              <span className="w-full truncate text-center font-mono text-[8px] leading-tight text-gray-500">{item.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 max-h-96 overflow-y-auto pr-1">
          {filtered.map(item => (
            <button
              key={item.id}
              onClick={() => onSelect(item.file_url, item.file_type ?? 'image', metaFor(item))}
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
