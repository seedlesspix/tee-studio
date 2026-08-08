'use client'
import { useEffect, useMemo, useRef, useState } from 'react'

// Shared font picker: a scrollable list where each row renders its OWN name in that font, so you
// preview before choosing (a real font menu, not a native <select> that ignores per-option fonts).
// Used by BOTH the Text panel and the Names & Numbers styling section — one component so the two
// can't drift. `previewText` is what each row renders (the customer's typed text in the Text panel,
// the placeholder sample "NAME"/"00" in N&N).
//
// Per Denise's UX: a CATEGORY DROPDOWN ("All" default) filters the list to one category (not headers in
// one long scroll), a SEARCH box narrows within that, the CURRENT font is obvious (a "Current" line
// rendered in that font + a Current badge, and the list auto-scrolls to it on open).
type Font = { label: string; value: string; category?: string | null }

const OTHER = 'Other'
const catOf = (f: Font) => (f.category && f.category.trim()) || OTHER

export default function FontPicker({
  fonts,
  value,
  onChange,
  previewText,
  maxHeightClass = 'max-h-48',
}: {
  fonts: Font[]
  value: string
  onChange: (value: string) => void
  previewText: string
  maxHeightClass?: string
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const listRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)
  const didScroll = useRef(false)

  // Distinct categories present (in first-seen / admin sort order), "Other" always last. Only offered
  // when at least one font is actually categorized — otherwise the dropdown is pointless, so hide it.
  const categories = useMemo(() => {
    const seen: string[] = []
    for (const f of fonts) { const c = catOf(f); if (!seen.includes(c)) seen.push(c) }
    return seen.sort((a, b) => (a === OTHER ? 1 : 0) - (b === OTHER ? 1 : 0))
  }, [fonts])
  const hasCategories = categories.some(c => c !== OTHER)

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => fonts.filter(f => (category === 'All' || catOf(f) === category) && (!q || f.label.toLowerCase().includes(q))),
    [fonts, category, q],
  )

  // Open with the current font visible: scroll the list (not the page) so the selected row is centered.
  // Once only, after fonts + selection are ready; NOT on every pick (that would jump the list on click).
  useEffect(() => {
    if (didScroll.current || !fonts.length) return
    const el = selectedRef.current, list = listRef.current
    if (!el || !list) return
    const er = el.getBoundingClientRect(), lr = list.getBoundingClientRect()
    list.scrollTop += er.top - lr.top - (list.clientHeight - el.clientHeight) / 2
    didScroll.current = true
  }, [fonts, value])

  const currentLabel = fonts.find(f => f.value === value)?.label

  return (
    <div className="mt-1">
      {currentLabel && (
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500 shrink-0">Current</span>
          <span style={{ fontFamily: value }} className="text-gray-900 text-base leading-none truncate">{currentLabel}</span>
        </div>
      )}
      <div className="flex gap-2 mb-1">
        {hasCategories && (
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="shrink-0 bg-gray-100 border border-gray-200 rounded px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-[#dd3333] font-mono"
            aria-label="Filter fonts by category"
          >
            <option value="All">All</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search fonts…"
          className="min-w-0 flex-1 bg-gray-100 border border-gray-200 rounded px-2.5 py-1.5 text-xs text-gray-900 outline-none focus:border-[#dd3333] placeholder-gray-400"
        />
      </div>
      <div ref={listRef} className={`flex flex-col gap-1 ${maxHeightClass} overflow-y-auto pr-1`}>
        {filtered.length === 0 && (
          <p className="text-[11px] text-gray-500 px-1 py-2">No fonts match{q ? ` “${query}”` : ''}.</p>
        )}
        {filtered.map(f => {
          const selected = value === f.value
          return (
            <button
              key={f.value}
              ref={selected ? selectedRef : undefined}
              type="button"
              onClick={() => onChange(f.value)}
              className={`w-full text-left px-3 py-2 rounded border transition-all ${
                selected ? 'border-gray-800 bg-white ring-1 ring-gray-800' : 'border-gray-200 bg-gray-100 hover:border-[#444]'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-xs text-gray-800 font-mono truncate">{f.label}</span>
                {selected && (
                  <span className="shrink-0 text-[9px] font-mono uppercase tracking-wide text-gray-900 bg-gray-200 rounded px-1.5 py-0.5">
                    Current
                  </span>
                )}
              </div>
              <div style={{ fontFamily: f.value, fontSize: '18px', color: '#161616', lineHeight: 1.2 }}>
                {previewText || f.label}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
