// Grab 'n Go deep links (2026-10-16) — PURE, isomorphic helpers shared by the resolver route, the
// designer entry, and their tests. No DOM, no DB.
//
// The Shopify theme links a Grab 'n Go design page to the designer with the design pre-placed:
//
//   https://create.tshirtdeli.com/designer?design=T2491[&garment=3001][&color=Black]
//   https://create.tshirtdeli.com/?design=T2491            (root alias — forwards to /designer)
//
//   design   The Art library DESIGN NUMBER (clipart_items.decal_number). "T2491" on the site means
//            decal_number 2491 — the T is display-only (Denise, 2026-10-16). Tolerant: T2491 / t2491 /
//            2491 / T-2491 / T 2491 / 002491. Unknown or inactive → the designer opens normally.
//   garment  A product template's STYLE NUMBER (product_templates.style_number, e.g. "3001" — the
//            same token the mockup-filename convention uses). Also accepts a template uuid or a
//            Shopify product id (bare numeric or gid://). Unknown → default garment + picker.
//   color    Already supported by the designer (?color= exact Shopify color name).

// A design number as the theme writes it → the integer the DB stores, or null when unparseable.
// Accepts an optional leading T/t with an optional separator, ignores surrounding whitespace and
// leading zeros, and caps at 9 digits (Postgres integer).
export function parseDesignNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const m = String(raw).trim().match(/^[tT]?[\s_-]?0*(\d{1,9})$/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

// The site-facing form of a design number ("T2491"). Display only — never stored.
export function formatDesignNumber(n: number): string {
  return `T${n}`
}

export type GarmentRef =
  | { kind: 'style'; token: string }      // normalized style token, e.g. "3001", "3413Y"
  | { kind: 'template'; id: string }      // product_templates.id (uuid)
  | { kind: 'product'; gid: string }      // gid://shopify/Product/<n>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Collapse a style number to a comparison token: uppercase alphanumerics only. "3413 Y" → "3413Y".
export function normalizeStyleToken(s: string): string {
  return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// Every token a stored style_number answers to. Admins write combined numbers like "3413Y & 3413T" or
// "3001T&Y"; each &/,/|/-separated part is its own token (so ?garment=3413Y matches), plus the whole
// string collapsed. Parts under 2 characters are dropped (the stray "Y" in "3001T&Y" is not a style).
export function styleTokensOf(styleNumber: string | null | undefined): string[] {
  if (!styleNumber) return []
  const whole = normalizeStyleToken(styleNumber)
  const parts = styleNumber.split(/[&,|/]+/).map(normalizeStyleToken).filter(p => p.length >= 2)
  return Array.from(new Set([whole, ...parts].filter(Boolean)))
}

export function matchesStyle(styleNumber: string | null | undefined, token: string): boolean {
  const t = normalizeStyleToken(token)
  return !!t && styleTokensOf(styleNumber).includes(t)
}

// What the theme put in ?garment= → how to look it up. A uuid is a template id; a gid or a long
// all-digit string (Shopify product ids are 13+ digits) is a Shopify product; everything else is a
// style token. Empty / whitespace → null.
export function parseGarmentRef(raw: string | null | undefined): GarmentRef | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  if (UUID_RE.test(s)) return { kind: 'template', id: s.toLowerCase() }
  const gid = s.match(/^gid:\/\/shopify\/Products?\/(\d+)$/i)
  if (gid) return { kind: 'product', gid: `gid://shopify/Product/${gid[1]}` }
  if (/^\d{10,}$/.test(s)) return { kind: 'product', gid: `gid://shopify/Product/${s}` }
  const token = normalizeStyleToken(s)
  return token ? { kind: 'style', token } : null
}

// Can this garment produce this art? Art carries supported_methods (Print / Embroidery toggles in the
// Art admin); a template carries supported_print_methods. Either side empty/unknown → compatible
// (fail OPEN — a data gap must not hide every garment). Decision 6 (Denise, 2026-10-16): hide garments
// that can't produce the design, same philosophy as the unavailable-products filter.
export function methodsCompatible(
  artMethods: readonly string[] | null | undefined,
  templateMethods: readonly string[] | null | undefined,
): boolean {
  if (!artMethods?.length || !templateMethods?.length) return true
  return artMethods.some(m => templateMethods.includes(m))
}

// The deep-link parameters, so the designer can strip them from the address once the design is
// placed (a refresh must never place a second copy — same trick the ?restore= login round-trip uses).
export const DEEP_LINK_PARAMS = ['design', 'garment'] as const

export function stripDeepLinkParams(url: URL): URL {
  for (const k of DEEP_LINK_PARAMS) url.searchParams.delete(k)
  return url
}

// The order-stable tie-break used wherever "first template" is picked (default garment, a style token
// matching several templates): the admin's picker order first, then oldest first. Deterministic even
// when several templates share a sort_order (8 did on 2026-10-16).
export function compareTemplates<T extends { sort_order?: number | null; created_at?: string | null; name?: string | null }>(a: T, b: T): number {
  const so = (a.sort_order ?? 0) - (b.sort_order ?? 0)
  if (so !== 0) return so
  const ca = a.created_at ?? '', cb = b.created_at ?? ''
  if (ca !== cb) return ca < cb ? -1 : 1
  return (a.name ?? '').localeCompare(b.name ?? '')
}

// The bare numeric a Shopify GID ends in ("gid://shopify/Product/123" → "123"). The designer's
// ?product_id= has always been the bare form.
export function bareProductId(gid: string): string {
  return (gid || '').split('/').pop() || ''
}

// ── Landing color (Denise, 2026-10-17) ───────────────────────────────────────────────────────────────
// Which color a deep-linked garment opens in. Rule 1: the ADMIN's first color on the template (Templates →
// Colors order), never Shopify's first option value (which landed the Cotton T on Columbia Blue by
// accident). Rule 2: a design flagged "light artwork" opens on the garment's DARKEST color (by hex
// luminance) so a white design is never invisible on arrival — the same rule Build 2 uses for its
// catalog render (light art → black tee). A theme ?color= overrides both (handled by the caller).

// Relative luminance of a #rrggbb hex (0 = black, 1 = white), or null when unparseable.
export function hexLuminance(hex: string | null | undefined): number | null {
  const h = (hex || '').trim().replace(/^#/, '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  if (!/^[0-9a-f]{6}$/i.test(full)) return null
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export type TemplateColor = { color_name: string; hex: string | null; sort_order?: number | null }

// The color name to land on, or null when the template has no colors (caller keeps today's fallback).
// lightArt → darkest by luminance (ties → admin order); else → the admin's first color. Colors with an
// unparseable hex are treated as mid-grey so a bad hex can never win "darkest" by accident.
export function pickLandingColor(colors: readonly TemplateColor[] | null | undefined, lightArt: boolean): string | null {
  const ordered = [...(colors ?? [])]
    .filter(c => !!c.color_name)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  if (!ordered.length) return null
  if (!lightArt) return ordered[0].color_name
  let best = ordered[0], bestL = hexLuminance(ordered[0].hex) ?? 0.5
  for (const c of ordered.slice(1)) {
    const L = hexLuminance(c.hex) ?? 0.5
    if (L < bestL) { best = c; bestL = L }
  }
  return best.color_name
}
