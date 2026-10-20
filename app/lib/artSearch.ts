// One matcher for art search, shared by the customer Art panel and the Art Library admin so "search"
// means the same thing in both places: case-insensitive substring on the NAME, any TAG, or the DESIGN
// NUMBER (typing a number jumps to that design). Pure; no DB.
export type ArtSearchable = { name: string; tags?: string[] | null; decal_number?: number | null }

export function matchesArtSearch(item: ArtSearchable, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (item.name.toLowerCase().includes(q)) return true
  if (item.decal_number != null && String(item.decal_number).includes(q)) return true
  // "T1641" matches design 1641 too — the T is display-only everywhere else, so honor it here.
  const bare = q.replace(/^t[\s_-]?/, '')
  if (bare !== q && item.decal_number != null && String(item.decal_number).includes(bare)) return true
  return !!item.tags?.some(tag => tag.toLowerCase().includes(q))
}

export type ArtSort = 'newest' | 'oldest' | 'name' | 'design'
export const ART_SORTS: { key: ArtSort; label: string }[] = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'name', label: 'Name A–Z' },
  { key: 'design', label: 'Design #' },
]

type ArtSortable = ArtSearchable & { created_at?: string | null; sort_order?: number | null }

// Stable, null-safe sort. Newest/oldest use created_at (items without one go last), tie-broken by the
// admin's sort_order; Design # puts unnumbered art last, then by name.
export function sortArt<T extends ArtSortable>(items: readonly T[], by: ArtSort): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  const ts = (x: T) => (x.created_at ? Date.parse(x.created_at) : NaN)
  const cmp: Record<ArtSort, (a: T, b: T) => number> = {
    newest: (a, b) => {
      const ta = ts(a), tb = ts(b)
      if (Number.isNaN(ta) !== Number.isNaN(tb)) return Number.isNaN(ta) ? 1 : -1
      if (!Number.isNaN(ta) && ta !== tb) return tb - ta
      return (b.sort_order ?? 0) - (a.sort_order ?? 0) || byName(a, b)
    },
    oldest: (a, b) => {
      const ta = ts(a), tb = ts(b)
      if (Number.isNaN(ta) !== Number.isNaN(tb)) return Number.isNaN(ta) ? 1 : -1
      if (!Number.isNaN(ta) && ta !== tb) return ta - tb
      return (a.sort_order ?? 0) - (b.sort_order ?? 0) || byName(a, b)
    },
    name: byName,
    design: (a, b) => {
      const da = a.decal_number, db = b.decal_number
      if ((da == null) !== (db == null)) return da == null ? 1 : -1
      if (da != null && db != null && da !== db) return da - db
      return byName(a, b)
    },
  }
  return [...items].sort(cmp[by])
}

// "Off means gone" (Denise, 2026-10-20): a piece of art is offered to customers only if at least one of its
// categories is ON. Art whose every category is off disappears from browsing AND search; the admin still
// shows it so it can be re-homed or restored.
export function hasActiveCategory(item: { category_ids?: string[] | null }, activeCategoryIds: ReadonlySet<string>): boolean {
  return (item.category_ids ?? []).some(id => activeCategoryIds.has(id))
}
