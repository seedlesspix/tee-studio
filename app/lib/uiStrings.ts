// UI string registry — the single source of truth for editable customer- AND admin-facing wording
// (BETA item 9, the Language editor). KEYS + DEFAULTS live here (versioned with the code); admin edits
// are stored as SPARSE overrides in the `ui_strings` table. Resolution is `override ?? default`, so an
// unedited string always renders its built-in default, a missing row never breaks anything, and deleting
// a row IS "reset to default".
//
// To make a new string editable: add a key here (with a plain-English `desc` + a `group` for the admin
// Language page) and call t('that.key') where it renders. Nothing else to wire.

export type UiStringDef = { default: string; group: string; desc: string }

export const UI_STRINGS = {
  // ── Methods ────────────────────────────────────────────────────────────────
  // The internal DB keys (screen_print / embroidery) NEVER change; this is DISPLAY only. "Print" is the
  // default so "Screen Print" / "silk screen" can't come back (BETA #15).
  'method.screen_print': { default: 'Print', group: 'Methods', desc: 'Name shown for the print method (customer + admin). Internal key stays "screen_print".' },
  'method.embroidery': { default: 'Embroidery', group: 'Methods', desc: 'Name shown for the embroidery method (customer + admin).' },

  // ── Order page ───────────────────────────────────────────────────────────────
  'order.blank_line': { default: 'Blank product', group: 'Order page', desc: 'Label for the blank-garment line in the order summary (sometimes a hat, not a shirt — BETA #16).' },

  // ── Notifications / confirms ─────────────────────────────────────────────────
  'notify.clear_all_confirm': { default: 'Clear all design elements?', group: 'Notifications', desc: 'Confirmation shown before clearing the whole design (BETA #19, wording).' },

  // ── Admin — Art library ──────────────────────────────────────────────────────
  'admin.design_number': { default: 'Design #', group: 'Admin — Art', desc: 'Label for an art item’s design number in the Art admin (was "Decal #" — BETA #22).' },
  'admin.designs_used': { default: 'Designs Used', group: 'Admin — Orders', desc: 'Heading over the list of design numbers used on an order (was "Decals Used").' },

  // ── Designer (customer) — a starter set of the most-visible labels/notes ─────
  'designer.embroidery_preview_note': { default: 'Preview — final stitching may vary.', group: 'Designer', desc: 'Honesty note shown in embroidery mode next to the design.' },
} as const satisfies Record<string, UiStringDef>

export type UiStringKey = keyof typeof UI_STRINGS

// Resolve a key against a loaded overrides map. Unknown keys fall back to the key itself (visible in dev,
// never a blank), which should never happen for a registered key.
export function resolveString(key: string, overrides: Record<string, string> | null | undefined): string {
  if (overrides && key in overrides) return overrides[key]
  const def = (UI_STRINGS as Record<string, UiStringDef>)[key]
  return def ? def.default : key
}

// Grouped view of the registry for the admin Language page (stable group order = first-seen).
export function groupedStrings(): { group: string; items: { key: string; def: UiStringDef }[] }[] {
  const order: string[] = []
  const byGroup = new Map<string, { key: string; def: UiStringDef }[]>()
  for (const [key, def] of Object.entries(UI_STRINGS) as [string, UiStringDef][]) {
    if (!byGroup.has(def.group)) { byGroup.set(def.group, []); order.push(def.group) }
    byGroup.get(def.group)!.push({ key, def })
  }
  return order.map(group => ({ group, items: byGroup.get(group)! }))
}
