// Names & Numbers (roster/bulk personalization). Pure, shared logic used by BOTH the designer
// preview and — later — the per-entry cut-file generation (Denise: names/numbers are BAKED INTO THE
// PRINT, so every roster entry is a genuinely different design that must be substituted + outlined).

// A placeholder text object on the canvas is stamped with this custom prop so we know to substitute
// it. Added to CANVAS_CUSTOM_PROPS in DesignerCanvas so it persists through save/restore/export.
export const NN_ROLE_PROP = '_nnRole'
export type NnRole = 'name' | 'number' | 'title'
// Display order of the placeholder roles (top-to-bottom on the classic jersey stack).
export const NN_ROLES: NnRole[] = ['name', 'number', 'title']

export type RosterEntry = { name: string; number: string; title: string; size: string; qty: number }

export const emptyEntry = (size = ''): RosterEntry => ({ name: '', number: '', title: '', size, qty: 1 })

// True when a roster row carries something worth printing/ordering.
export const entryHasContent = (e: RosterEntry): boolean =>
  e.name.trim() !== '' || e.number.trim() !== '' || e.title.trim() !== ''

// The value a role prints for a given roster entry. FORCE UPPERCASE for text (name/title): a mixed
// "Plumb"/"jones"/"PETTER" roster is ambiguous intent the shop would have to phone about — if only
// uppercase is possible, that ambiguity never exists (Denise). Numbers pass through unchanged.
export function rosterValue(entry: RosterEntry, role: NnRole): string {
  const raw = role === 'name' ? entry.name : role === 'title' ? entry.title : entry.number
  return role === 'number' ? raw : raw.toUpperCase()
}

export function rosterShirtCount(roster: RosterEntry[]): number {
  return roster.reduce((n, e) => n + (entryHasContent(e) ? Math.max(0, e.qty || 0) : 0), 0)
}

// Parse a pasted block into roster entries. Tolerant of what customers actually paste from a
// spreadsheet or notes: tab- OR comma-separated "Name, Number, Size, Qty", or a bare "SMITH 12"
// where the trailing token is the number. Skips a header row and blank lines.
export function parseBulkRoster(text: string, defaultSize = ''): RosterEntry[] {
  const out: RosterEntry[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    // header row (e.g. "Name  Number  Size  Qty") — skip it
    if (/\bname\b/i.test(line) && /\bnumber\b/i.test(line)) continue

    let name = '', number = '', size = defaultSize, qty = 1
    const delimited = line.split(/\t|,/).map(s => s.trim())
    if (delimited.length >= 2) {
      ;[name, number, size = defaultSize] = [delimited[0], delimited[1], delimited[2] || defaultSize]
      const q = parseInt(delimited[3] || '', 10)
      if (Number.isFinite(q) && q > 0) qty = q
    } else {
      // single field: "SMITH 12" -> name="SMITH", number="12" (trailing numeric token)
      const m = line.match(/^(.*?)[\s]+(\d+)$/)
      if (m) { name = m[1].trim(); number = m[2] }
      else name = line
    }
    // Title isn't in the positional paste format (name/number/size/qty) — it's a table-only column.
    if (name || number) out.push({ name: name.toUpperCase(), number, title: '', size, qty })
  }
  return out
}

// Aggregate a roster into a size -> count map (the shape design_orders.quantities uses). For an N&N
// order the roster IS the quantity source: each entry is `qty` shirts of its size. Sums content
// entries by size; the grand total equals rosterShirtCount, so the order total stays consistent
// whether it's derived from this map or the shirt count. Empty size buckets under '' (order page
// renders it as an em dash).
export function rosterSizeQuantities(roster: RosterEntry[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of roster) {
    if (!entryHasContent(e)) continue
    const qty = Math.max(0, e.qty || 0)
    if (qty <= 0) continue
    const size = (e.size || '').trim()
    out[size] = (out[size] || 0) + qty
  }
  return out
}

// THE fit rule for substituted placeholder text — shared by the designer preview AND (later) the
// per-entry cut-file generation, so both keep names on the shirt the same way. A jersey nameplate
// keeps its styled HEIGHT (font size / scaleY untouched) and CONDENSES horizontally when the value
// is wider than its box ("DE LA CRUZ", a 3-digit number). Returns the scaleX to apply: the object's
// own base scaleX when it already fits, otherwise the factor that pulls the scaled width down to
// maxWidth. Never widens (base is the ceiling). Pure — pass in a measured natural width.
export function condensedScaleX(naturalWidth: number, maxWidth: number, baseScaleX = 1): number {
  if (!(naturalWidth > 0) || !(maxWidth > 0)) return baseScaleX
  const scaled = naturalWidth * baseScaleX
  return scaled > maxWidth ? maxWidth / naturalWidth : baseScaleX
}

// Substitute one roster entry into a set of canvas objects: every placeholder (_nnRole
// 'name'/'number'/'title') gets its text replaced by the entry's value (uppercased for name/title).
// Returns a NEW array (shallow-cloned changed objects); non-placeholder objects pass through
// unchanged. Handles curved placeholders too (their editable source is _originalText, which the arc
// renderer re-bakes from). Pure — no canvas/DOM.
export function substituteRosterEntry<T extends Record<string, unknown>>(objects: T[], entry: RosterEntry): T[] {
  return objects.map(obj => {
    const role = obj[NN_ROLE_PROP] as NnRole | undefined
    if (role !== 'name' && role !== 'number' && role !== 'title') return obj
    const value = rosterValue(entry, role)
    const next: Record<string, unknown> = { ...obj, text: value }
    if (obj._originalText !== undefined) next._originalText = value // curved-text bake source
    return next as T
  })
}
