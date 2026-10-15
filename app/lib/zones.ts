// Print Zones Z2 — the pure zone MODEL (ordering, classification, and per-product zone derivation),
// separate from mockupFilename.ts (which parses filenames). The designer runtime, order page, and export
// pipeline all lean on this so "which zones does this product have, and in what order" lives in ONE place.
//
// A "zone" is a print area identity: front, back, left_sleeve, right_sleeve, hat_back. It is stored as
// free text in product_template_print_areas.side and design_orders (per-zone), so adding a sixth zone
// later means extending ZONE_ORDER here — no schema change.

import { ZONE_LABELS } from './mockupFilename'

// Canonical display + iteration order. Everything that lists zones (selector, grid, export) uses this so
// Front always precedes Back precedes the sleeves precedes the hat.
export const ZONE_ORDER = ['front', 'back', 'left_sleeve', 'right_sleeve', 'hat_back'] as const

// The two "legacy" zones every garment has had, and the only ones the designer can fall back to a Shopify
// product photo for (sleeves/hat have no Shopify source — they need an uploaded mockup). Mirrors
// PrintAreaEditor's SHOPIFY_FALLBACK_SIDES.
export const FALLBACK_ZONES = new Set<string>(['front', 'back'])

export const SLEEVE_ZONES = new Set<string>(['left_sleeve', 'right_sleeve'])

export const zoneLabel = (zone: string) => ZONE_LABELS[zone] ?? zone

// Customer-facing zone label (N5). A shopper sees a hat's printable back as simply "Back"; admin keeps
// "Hat Back" (zoneLabel) to distinguish it from a shirt's back. The internal key (hat_back) is unchanged.
// Admin surfaces use zoneLabel(); customer surfaces (designer zone bar, order page) use this.
const CUSTOMER_ZONE_LABELS: Record<string, string> = { hat_back: 'Back' }
export const customerZoneLabel = (zone: string) => CUSTOMER_ZONE_LABELS[zone] ?? zoneLabel(zone)
export const isSleeveZone = (zone: string) => SLEEVE_ZONES.has(zone)
export const isFallbackZone = (zone: string) => FALLBACK_ZONES.has(zone)

// Sort an arbitrary set of zone ids into canonical order; unknown zones sort last (stable by name).
export function orderZones(zones: Iterable<string>): string[] {
  const uniq = Array.from(new Set(zones))
  return uniq.sort((a, b) => {
    const ia = ZONE_ORDER.indexOf(a as (typeof ZONE_ORDER)[number])
    const ib = ZONE_ORDER.indexOf(b as (typeof ZONE_ORDER)[number])
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b)
  })
}

// Which zones a product offers IN THE ACTIVE PRINT METHOD, in canonical order. Front is always present
// (every garment has a front). The caller passes the sides of the print areas FOR THE ACTIVE METHOD, so a
// product whose Embroidery areas are front-only drops Back (and any print-only sleeve) the moment the
// customer switches to Embroidery — a zone with no print area in the active method is never offered, so it
// can't be designed, priced, captured, or cut for a method that can't print it.
//
// `isTemplated` distinguishes a real template (drive zones strictly from the active method's areas) from a
// legacy, non-templated Shopify-metafield product (no per-method areas at all) — the latter still falls
// back to the back-photo signal, unchanged, so nothing about those products moves.
export function deriveProductZones(opts: {
  areaSides: Iterable<string>       // `side` values from the ACTIVE method's print areas (empty if none)
  hasBackImages?: boolean           // a back garment photo exists (legacy signal; non-templated only)
  isTemplated?: boolean             // the product has a template with >= 1 print area (any method)
}): string[] {
  const areas = new Set(opts.areaSides)
  const zones = new Set<string>(['front']) // front is universal
  // Back: a templated product must have a back area in the ACTIVE method; a non-templated product has no
  // per-method areas, so it keeps the legacy back-photo gate.
  if (areas.has('back') || (!opts.isTemplated && opts.hasBackImages)) zones.add('back')
  // Every non-front/back zone appears only when it has a print area in the active method.
  areas.forEach(side => { if (side !== 'front' && side !== 'back') zones.add(side) })
  return orderZones(zones)
}
