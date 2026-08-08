'use client'
import { useEffect, useMemo, useRef, useState } from 'react'

// Shared font picker: a scrollable list where each row renders its OWN name in that font, so you
// preview before choosing (a real font menu, not a native <select> that ignores per-option fonts).
// Used by BOTH the Text panel and the Names & Numbers styling section — one component so the two
// can't drift. `previewText` is what each row renders (the customer's typed text in the Text panel,
// the placeholder sample "NAME"/"00" in N&N).
//
// This version adds, per Denise's font-picker UX ask: a SEARCH box, CATEGORY grouping (from
// designer_fonts.category; sticky headers, "Other" for uncategorized, flat if nothing is categorized),
// and an obvious CURRENT font (a "Current:" line rendered in that font + a Current badge + the list
// auto-scrolls to the chosen font when it opens).
type Font = { label: string; value: string; category?: string | null }

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
  const listRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)
  const didScroll = useRef(false)

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => (q ? fonts.filter(f => f.label.toLowerCase().includes(q)) : fonts), [fonts, q])

  // Group by category, preserving the admin sort order (first-seen). If NOTHING is categorized, one
  // flat group (no headers). Uncategorized fonts fall into "Other", always shown last.
  const hasCategories = useMemo(() => fonts.some(f => f.category && f.category.trim()), [fonts])
  const groups = useMemo(() => {
    if (!hasCategories) return [{ name: null as string | null, items: filtered }]
    const map = new Map<string, Font[]>()
    for (const f of filtered) {
      const key = (f.category && f.category.trim()) || 'Other'
      const arr = map.get(key) ?? []
      arr.push(f)
      map.set(key, arr)
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] === 'Other' ? 1 : 0) - (b[0] === 'Other' ? 1 : 0))
      .map(([name, items]) => ({ name, items }))
  }, [filtered, hasCategories])

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
  const noMatches = groups.every(g => g.items.length === 0)

  return (
    <div className="mt-1">
      {currentLabel && (
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500 shrink-0">Current</span>
          <span style={{ fontFamily: value }} className="text-gray-900 text-base leading-none truncate">{currentLabel}</span>
        </div>
      )}
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search fonts…"
        className="w-full bg-gray-100 border border-gray-200 rounded px-2.5 py-1.5 text-xs text-gray-900 outline-none focus:border-[#dd3333] mb-1 placeholder-gray-400"
      />
      <div ref={listRef} className={`flex flex-col gap-1 ${maxHeightClass} overflow-y-auto pr-1`}>
        {noMatches && <p className="text-[11px] text-gray-500 px-1 py-2">No fonts match “{query}”.</p>}
        {groups.map(group =>
          group.items.length === 0 ? null : (
            <div key={group.name ?? '_flat'} className="flex flex-col gap-1">
              {group.name && (
                <div className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur px-1 pt-1 pb-0.5 text-[10px] font-mono uppercase tracking-widest text-gray-500">
                  {group.name}
                </div>
              )}
              {group.items.map(f => {
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
          ),
        )}
      </div>
    </div>
  )
}
