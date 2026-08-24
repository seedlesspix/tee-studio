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

// A filename zone token → canonical zone string, or null if unrecognized. Case- and separator-
// insensitive, so "HatBack", "hatback", "hat-back" all resolve the same.
export function normalizeZone(token: string): string | null {
  const k = token.toLowerCase().replace(/[\s_-]+/g, '')
  return ZONE_ALIASES[k] ?? null
}

// Collapse a color to a comparison key: lowercase, alphanumerics only. So "Columbia Blue",
// "ColumbiaBlue", "columbia_blue", "COLUMBIA BLUE" ALL become "columbiablue". Shared by the batch
// uploader (to canonicalize a filename color to the product's real Shopify color) and the Mockups grid
// (to line a stored mockup up with its color row regardless of how the filename was spelled).
export const normalizeColorKey = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

export type ParsedMockupName = { style: string; color: string; zone: string | null; isOverlay: boolean }

// `2001_White_LeftSleeve.png` → { style: '2001', color: 'White', zone: 'left_sleeve' }.
// FIRST token = style number; the ZONE is the LAST token, OR the last TWO tokens when they combine into a
// recognized zone (so `HatBack` AND `Hat_Back`, `LeftSleeve` AND `Left_Sleeve` all resolve); EVERYTHING
// between style and zone = the color, joined with spaces — so a multi-word color survives written either
// way (`Columbia_Blue` OR `ColumbiaBlue`). The 2-token zone only wins when it's actually a known zone, so
// a multi-word color ending in an ordinary word (`..._Columbia_Blue_Back`) still parses as color
// "Columbia Blue" + zone Back, NOT a bogus "Blue Back" zone. Returns null when there aren't at least 3
// tokens; returns zone:null when the tail isn't a recognized zone (caller surfaces "unknown zone").
export function parseMockupFilename(filename: string): ParsedMockupName | null {
  const base = filename.replace(/\.[a-z0-9]+$/i, '').trim() // strip extension
  let parts = base.split('_').map((s) => s.trim()).filter(Boolean)
  // FOREGROUND OVERLAY (layered mockups): a trailing `_Overlay` token flags a foreground layer (e.g. hoodie
  // drawstrings) that renders ABOVE the customer's art. Strip it, then parse style/color/zone from the rest
  // EXACTLY as a base mockup — so `4001_Military_Front_Overlay` → style 4001, color Military, zone front.
  let isOverlay = false
  if (parts.length && /^overlay$/i.test(parts[parts.length - 1])) { isOverlay = true; parts = parts.slice(0, -1) }
  if (parts.length < 3) return null
  const style = parts[0]
  // Greedy from the end: prefer a 2-token zone (e.g. "Hat"+"Back" → hat_back) when it's recognized,
  // else fall back to the single last token. colorEnd marks where the color slice stops.
  let zone = normalizeZone(parts[parts.length - 1])
  let colorEnd = parts.length - 1
  if (parts.length >= 4) {
    const two = normalizeZone(parts.slice(-2).join(''))
    if (two) { zone = two; colorEnd = parts.length - 2 }
  }
  const color = parts.slice(1, colorEnd).join(' ')
  if (!style || !color) return null
  return { style, color, zone, isOverlay }
}
