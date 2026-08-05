// Names & Numbers (roster/bulk personalization). Pure, shared logic used by BOTH the designer
// preview and — later — the per-entry cut-file generation (Denise: names/numbers are BAKED INTO THE
// PRINT, so every roster entry is a genuinely different design that must be substituted + outlined).

// A placeholder text object on the canvas is stamped with this custom prop so we know to substitute
// it. Added to CANVAS_CUSTOM_PROPS in DesignerCanvas so it persists through save/restore/export.
export const NN_ROLE_PROP = '_nnRole'
export type NnRole = 'name' | 'number'

export type RosterEntry = { name: string; number: string; size: string; qty: number }

export const emptyEntry = (size = ''): RosterEntry => ({ name: '', number: '', size, qty: 1 })

// True when a roster row carries something worth printing/ordering.
export const entryHasContent = (e: RosterEntry): boolean => e.name.trim() !== '' || e.number.trim() !== ''

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
    if (name || number) out.push({ name, number, size, qty })
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

// Substitute one roster entry into a set of canvas objects: every placeholder (_nnRole 'name'/'number')
// gets its text replaced by the entry's value. Returns a NEW array (shallow-cloned changed objects);
// non-placeholder objects pass through unchanged. Handles curved placeholders too (their editable
// source is _originalText, which the arc renderer re-bakes from). Pure — no canvas/DOM.
export function substituteRosterEntry<T extends Record<string, unknown>>(objects: T[], entry: RosterEntry): T[] {
  return objects.map(obj => {
    const role = obj[NN_ROLE_PROP] as NnRole | undefined
    if (role !== 'name' && role !== 'number') return obj
    const value = role === 'name' ? entry.name : entry.number
    const next: Record<string, unknown> = { ...obj, text: value }
    if (obj._originalText !== undefined) next._originalText = value // curved-text bake source
    return next as T
  })
}
