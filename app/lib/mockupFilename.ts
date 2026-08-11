// Print Zones Z0 — parse a designer-mockup filename in the `stylenumber_color_position` convention
// (Denise, 2026-08-11), e.g. `2001_White_LeftSleeve.png`. Pure + isomorphic so the admin batch uploader
// and its tests share one parser. The caller resolves `style` → a template (via product_templates.style_number)
// and `color` → a product_template_colors.color_name; this only splits the name and canonicalizes the zone.

// Canonical print zones + the filename tokens that map to each. Keys are lowercased with separators
// stripped, so "LeftSleeve", "left_sleeve", "left-sleeve", "left sleeve" all resolve the same.
const ZONE_ALIASES: Record<string, string> = {
  front: 'front', f: 'front',
  back: 'back', b: 'back',
  leftsleeve: 'left_sleeve', lsleeve: 'left_sleeve', leftslv: 'left_sleeve', ls: 'left_sleeve',
  rightsleeve: 'right_sleeve', rsleeve: 'right_sleeve', rightslv: 'right_sleeve', rs: 'right_sleeve',
  hatback: 'hat_back', hatb: 'hat_back',
}

// Human labels for the canonical zones (for admin display).
export const ZONE_LABELS: Record<string, string> = {
  front: 'Front',
  back: 'Back',
  left_sleeve: 'Left Sleeve',
  right_sleeve: 'Right Sleeve',
  hat_back: 'Hat Back',
}

// A filename zone token → canonical zone string, or null if unrecognized.
export function normalizeZone(token: string): string | null {
  const k = token.toLowerCase().replace(/[\s_-]+/g, '')
  return ZONE_ALIASES[k] ?? null
}

export type ParsedMockupName = { style: string; color: string; zone: string | null }

// `2001_White_LeftSleeve.png` → { style: '2001', color: 'White', zone: 'left_sleeve' }.
// FIRST token = style number, LAST token = zone, EVERYTHING BETWEEN = color joined with spaces — so a
// multi-word color survives (`2001_Light_Blue_LeftSleeve.png` → color "Light Blue"). Returns null when
// there aren't at least 3 tokens; returns zone:null when the last token isn't a recognized zone (so the
// caller can surface "unknown zone" rather than silently mis-assigning).
export function parseMockupFilename(filename: string): ParsedMockupName | null {
  const base = filename.replace(/\.[a-z0-9]+$/i, '').trim() // strip extension
  const parts = base.split('_').map((s) => s.trim()).filter(Boolean)
  if (parts.length < 3) return null
  const style = parts[0]
  const zone = normalizeZone(parts[parts.length - 1])
  const color = parts.slice(1, -1).join(' ')
  if (!style || !color) return null
  return { style, color, zone }
}
