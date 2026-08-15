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

// Which zones a product actually offers, in canonical order. Front is always present (every garment has a
// front). Back is present if the product has back imagery OR a back print area (matches today's Back-button
// gate, which keys off hasBackImages). Any other zone (sleeves, hat) is present iff it has a print area
// defined — you can't design where there's no box. Deliberately conservative: a zone with no print area is
// never offered, so a half-configured template can't strand the customer on an un-drawable zone.
export function deriveProductZones(opts: {
  areaSides: Iterable<string>       // distinct `side` values from product_template_print_areas
  hasBackImages?: boolean           // a back garment photo exists (legacy signal, still gates Back)
}): string[] {
  const areas = new Set(opts.areaSides)
  const zones = new Set<string>(['front']) // front is universal
  if (opts.hasBackImages || areas.has('back')) zones.add('back')
  // Every non-front/back zone appears only when it has a print area.
  areas.forEach(side => { if (side !== 'front' && side !== 'back') zones.add(side) })
  return orderZones(zones)
}
