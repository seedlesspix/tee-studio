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
// spreadsheet or notes. HEADER-AWARE: if the first row names its columns (contains "name" & "number"),
// columns are mapped by header so any order works and Title lines up. Otherwise POSITIONAL, matching
// the downloadable template's order: Name, Number, Size, Qty, Title (Title optional last, so a legacy
// 4-column paste still works and a 5-column template paste picks up titles even without the header).
// Also handles a bare "SMITH 12" line (trailing token is the number). Uppercases name + title.
export function parseBulkRoster(text: string, defaultSize = ''): RosterEntry[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '')
  if (!lines.length) return []

  // Column indices — positional default (template order), overridden by a header row if present.
  let idx = { name: 0, number: 1, size: 2, qty: 3, title: 4 }
  let start = 0
  const isHeader = (l: string) => /\bname\b/i.test(l) && /\bnumber\b/i.test(l)
  if (isHeader(lines[0])) {
    const h = lines[0].split(/\t|,/).map(s => s.trim().toLowerCase())
    const find = (kw: string) => h.findIndex(c => c.includes(kw))
    idx = { name: find('name'), number: find('number'), size: find('size'), title: find('title'),
      qty: h.findIndex(c => c.includes('qty') || c.includes('quantity')) }
    start = 1
  }

  const out: RosterEntry[] = []
  for (let li = start; li < lines.length; li++) {
    const line = lines[li]
    if (isHeader(line)) continue // stray repeated header
    const cells = line.split(/\t|,/).map(s => s.trim())
    const at = (i: number) => (i >= 0 && i < cells.length ? cells[i] : '')
    let name = at(idx.name), number = at(idx.number), title = at(idx.title), size = at(idx.size) || defaultSize
    let qty = 1
    const q = parseInt(at(idx.qty) || '', 10)
    if (Number.isFinite(q) && q > 0) qty = q
    // bare "SMITH 12" — a single un-delimited cell with a trailing number (only when unheadered)
    if (start === 0 && cells.length < 2) {
      const m = line.match(/^(.*?)[\s]+(\d+)$/)
      if (m) { name = m[1].trim(); number = m[2] } else { name = line; number = '' }
      title = ''; size = defaultSize
    }
    if (name || number || title) out.push({ name: name.toUpperCase(), number, title: title.toUpperCase(), size, qty })
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

// ── The locked jersey stack ────────────────────────────────────────────────
// Placeholders don't get moved/resized by the customer — they land at canonical jersey positions and
// sizes, computed here as fractions of the print box so the stack SCALES to whatever garment box it's
// on (onesie vs tee). FIXED SLOTS (Denise, seeing it live): NAME pinned at the very top ALWAYS (even
// alone — never re-centered), TITLE tucked just below Name, NUMBER the dominant element at center-mid.
// Adding/removing a field never shuffles the others. Pure — the designer maps the returned per-role
// {left, top (object CENTER), fontSize} straight onto the Fabric objects.

// Font size as a fraction of box height, constant per role (a name is always name-sized).
export const STACK_FONT_FRAC: Record<NnRole, number> = { name: 0.14, number: 0.42, title: 0.075 }
// Fixed center-Y fraction per role — the SAME slot regardless of which other fields are present. A
// COHESIVE jersey block in the upper portion, not three items scattered down the shirt: NAME near the
// top, TITLE right under it, and the big NUMBER directly beneath the title (not floated to mid-shirt).
export const STACK_Y_FRAC: Record<NnRole, number> = { name: 0.06, title: 0.16, number: 0.42 }

export type StackBox = { left: number; top: number; right: number; bottom: number }
export type StackSpot = { left: number; top: number; fontSize: number }

export function jerseyStackLayout(present: NnRole[], box: StackBox): Partial<Record<NnRole, StackSpot>> {
  const w = box.right - box.left, h = box.bottom - box.top
  if (!(w > 0) || !(h > 0)) return {}
  const cx = box.left + w / 2
  const out: Partial<Record<NnRole, StackSpot>> = {}
  for (const role of NN_ROLES) {
    if (!present.includes(role)) continue
    out[role] = { left: cx, top: box.top + h * STACK_Y_FRAC[role], fontSize: Math.max(8, Math.round(h * STACK_FONT_FRAC[role])) }
  }
  return out
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
