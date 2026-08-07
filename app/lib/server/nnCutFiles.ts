// Names & Numbers — per-entry cut-file generation (Phase 4). A team order is one design × N
// personalized shirts, so the bench needs:
//   • a SHARED base cut file per side, produced ONCE = every non-placeholder object (logo, common
//     art) — so the shared art isn't cut N times.
//   • ONE personalization file per roster entry = only the placeholders (_nnRole), substituted with
//     that player's values, outlined, positioned in the SAME print-area space so it overlays the base.
// Reuses the Phase-5 outlining engine untouched: we just hand collectCutPaths a re-serialized object
// set (base-minus-placeholders, or substituted-placeholders-only). The jersey condense that keeps long
// names in the box on screen is re-applied here from an opentype advance-width measurement, in the
// same 680×850 space boxFromSnapshot uses.
import * as opentype from 'opentype.js'
import { getFontBuffer, toArrayBuffer, baseFamily } from './fontBuffer'
import { boxFromSnapshot, isSnapshot } from './cutFileGeometry'
import { collectCutPaths, type CutPathsResult } from './generateCutFile'
import {
  type RosterEntry, NN_ROLE_PROP, substituteRosterEntry, condensedScaleX, entryHasContent, rosterValue,
} from '../namesNumbers'

const isPlaceholder = (o: Record<string, unknown>) => !!o[NN_ROLE_PROP]

// Re-serialize a side's canvas JSON with a different object set (keeps version + any other top-level
// fields collectCutPaths/prepareSide might read).
function reserialize(canvasJson: string, objects: unknown[]): string {
  const parsed = JSON.parse(canvasJson) as Record<string, unknown>
  return JSON.stringify({ ...parsed, objects })
}

// Squeeze each substituted placeholder to fit the print box width (keep height, condense width — the
// jersey rule, `condensedScaleX`). Mutates scaleX in place. Uses opentype's advance width at the
// object's fontSize, which is in the same 680×850 canvas space as boxFromSnapshot's box.
async function condensePlaceholders(
  placeholders: Record<string, unknown>[], boxWidth: number, cache: Map<string, opentype.Font>,
) {
  for (const p of placeholders) {
    const family = baseFamily(String(p.fontFamily ?? 'Impact'))
    const weight = (p.fontWeight === 'bold' || p.fontWeight === 700) ? 700 : 400
    const key = `${family}-${weight}`
    let font = cache.get(key)
    if (!font) {
      try {
        const f = opentype.parse(toArrayBuffer(await getFontBuffer(family, weight)))
        if (f.supported) { font = f; cache.set(key, f) }
      } catch { /* leave scaleX as-is; outlineVectorObject will loud-fail on this font anyway */ }
    }
    if (!font) continue
    const text = String(p.text ?? '')
    const fontSize = Number(p.fontSize ?? 40)
    // GSUB-safe: font.getAdvanceWidth runs stringToGlyphs, which throws on fonts with unsupported GSUB
    // lookups (e.g. Roboto). Fall back to per-character advances (base glyphs) — same as the outliner.
    let advance: number
    try {
      advance = font.getAdvanceWidth(text, fontSize)
    } catch {
      const s = fontSize / font.unitsPerEm
      advance = Array.from(text).reduce((w, ch) => w + (font.charToGlyph(ch).advanceWidth ?? 0) * s, 0)
    }
    p.scaleX = condensedScaleX(advance, boxWidth * 0.96, 1)
  }
}

// Bench filename for one entry: 01-SMITH-12.svg (title lives INSIDE the file, per Denise).
export function nnEntryFilename(index: number, entry: RosterEntry): string {
  const idx = String(index).padStart(2, '0')
  const namePart = rosterValue(entry, 'name').replace(/[^A-Z0-9]+/gi, '').slice(0, 24)
  const numPart = String(entry.number ?? '').replace(/[^0-9A-Za-z]+/g, '')
  return [idx, namePart, numPart].filter(Boolean).join('-') + '.svg'
}

export type NnCutResult = {
  base: CutPathsResult                                                     // shared, this side, no placeholders
  entries: Array<{ entry: RosterEntry; index: number; result: CutPathsResult }> // per-player personalization
}

// Produce the shared base + per-entry cut paths for a side that carries placeholders. Returns null
// when the side has no placeholders (so the caller falls back to the normal whole-side cut file — e.g.
// the FRONT logo of a back-personalized jersey).
export async function collectNnCutPaths(
  canvasJson: string | null | undefined, snap: unknown, roster: RosterEntry[],
): Promise<NnCutResult | null> {
  if (!canvasJson || !isSnapshot(snap)) return null
  let parsed: { objects?: Record<string, unknown>[] }
  try { parsed = JSON.parse(canvasJson) } catch { return null }
  const objects = parsed.objects ?? []
  const placeholders = objects.filter(isPlaceholder)
  if (!placeholders.length) return null

  const box = boxFromSnapshot(snap as Parameters<typeof boxFromSnapshot>[0])
  const cache = new Map<string, opentype.Font>()

  // SHARED base — this side minus the placeholders (may be "no-vector" for a names-only side).
  const base = await collectCutPaths(reserialize(canvasJson, objects.filter(o => !isPlaceholder(o))), snap)

  // PER-ENTRY — only the placeholders that get a value for this entry, substituted + condensed.
  const entries: NnCutResult['entries'] = []
  const content = roster.filter(entryHasContent)
  for (let i = 0; i < content.length; i++) {
    const entry = content[i]
    const subbed = (substituteRosterEntry(placeholders, entry) as Record<string, unknown>[])
      .filter(o => String(o.text ?? '').trim() !== '') // drop a role with no value (e.g. no number for a name-only row)
    if (!subbed.length) {
      entries.push({ entry, index: i + 1, result: { ok: false, reason: 'no-vector', message: 'no personalization for this entry' } })
      continue
    }
    await condensePlaceholders(subbed, box.width, cache)
    const result = await collectCutPaths(reserialize(canvasJson, subbed), snap)
    entries.push({ entry, index: i + 1, result })
  }
  return { base, entries }
}
