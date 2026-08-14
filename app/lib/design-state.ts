// Shared serialization between the designer's canvas snapshot and a
// design_orders row. Used by BOTH /api/designs/draft (the login round-trip
// snapshot) and /api/designs (My Designs saves) so the two write paths can't
// drift apart when a column is added.

import type { RosterEntry } from './namesNumbers'

export type UploadedFile = { name: string; url: string; type: string }

export type DesignState = {
  schemaVersion?: number
  productId?: string
  variantId?: string
  productTitle?: string
  productPrice?: number
  selectedColor?: string
  shirtView?: 'front' | 'back'
  printMethod?: string
  quantities?: Record<string, number>
  sidesDesigned?: number
  front?: unknown
  back?: unknown
  zones?: Record<string, unknown> // Print Zones Z3: extra zones (sleeves/hat) only; front/back stay in front/back above
  uploadedFiles?: UploadedFile[]
  roster?: RosterEntry[] // Names & Numbers (Phase 1: auto-draft only; no DB column until Phase 2)
  // Frozen print-area geometry — the box this design was made against. Persisted so a saved design
  // carries its OWN source box (D2 Design Portability re-fits FROM it when the design is opened onto a
  // different product). Without this a saved-design row had NULL print_area_* and the port fell through
  // to a no-op (no re-fit). The order path already stamps these on design_orders; saves now match it.
  // printArea* are the product_template_print_areas rows (JSONB) — isSnapshot()-shaped.
  templateId?: string
  printAreaFrontId?: string
  printAreaBackId?: string
  printAreaFront?: unknown
  printAreaBack?: unknown
}

// The columns rowToDesignState needs — keep in lockstep with it.
export const DESIGN_STATE_COLUMNS =
  'shopify_product_id, shopify_variant_id, product_title, selected_color, print_method, quantities, roster, uploaded_files, sides_designed, canvas_json_front, canvas_json_back, template_id, print_area_front_id, print_area_back_id, print_area_front, print_area_back, zones'

export type DesignStateRow = {
  shopify_product_id: string | null
  shopify_variant_id: string | null
  product_title: string | null
  selected_color: string | null
  print_method: string | null
  quantities: unknown
  roster: unknown
  uploaded_files: unknown
  sides_designed: number | null
  canvas_json_front: string | null
  canvas_json_back: string | null
  template_id: string | null
  print_area_front_id: string | null
  print_area_back_id: string | null
  print_area_front: unknown
  print_area_back: unknown
  zones: unknown
}

export function designStateToRow(state: DesignState) {
  // The frozen print-area box is written ONLY when present. This path also feeds the /api/designs
  // UPDATE of an owned design, and the box is "sticky": a re-save that can't determine the box (ref
  // null — saved before the async template load, or a non-templated product) must PRESERVE the stored
  // box, not overwrite it with null (which would silently revert that design's D2 port to a no-op). On
  // INSERT the omitted keys fall to the DB default (null). A re-save WITH a box (e.g. after porting to a
  // new garment) still updates it, because the ref is non-null then.
  const box: Record<string, unknown> = {}
  if (state.templateId != null) box.template_id = state.templateId
  if (state.printAreaFrontId != null) box.print_area_front_id = state.printAreaFrontId
  if (state.printAreaBackId != null) box.print_area_back_id = state.printAreaBackId
  if (state.printAreaFront != null) box.print_area_front = state.printAreaFront
  if (state.printAreaBack != null) box.print_area_back = state.printAreaBack
  return {
    shopify_product_id: state.productId ?? null,
    shopify_variant_id: state.variantId ?? null,
    product_title: state.productTitle ?? null,
    selected_color: state.selectedColor ?? null,
    print_method: state.printMethod ?? null,
    quantities: (state.quantities ?? null) as never,
    roster: (state.roster ?? null) as never,
    uploaded_files: (state.uploadedFiles ?? null) as never,
    sides_designed: state.sidesDesigned ?? null,
    canvas_json_front: state.front ? JSON.stringify(state.front) : null,
    canvas_json_back: state.back ? JSON.stringify(state.back) : null,
    // Print Zones Z3: extra zones (sleeves/hat) as jsonb; front/back stay in the canvas_json_* columns.
    zones: (state.zones ?? null) as never,
    ...box,
  }
}

export function rowToDesignState(data: DesignStateRow): DesignState {
  return {
    schemaVersion: 1,
    productId: data.shopify_product_id ?? undefined,
    variantId: data.shopify_variant_id ?? undefined,
    productTitle: data.product_title ?? undefined,
    selectedColor: data.selected_color ?? undefined,
    printMethod: data.print_method ?? undefined,
    quantities: (data.quantities as Record<string, number> | null) ?? undefined,
    roster: (data.roster as RosterEntry[] | null) ?? undefined,
    uploadedFiles: (data.uploaded_files as UploadedFile[] | null) ?? undefined,
    sidesDesigned: data.sides_designed ?? undefined,
    front: data.canvas_json_front ? safeParse(data.canvas_json_front) : undefined,
    back: data.canvas_json_back ? safeParse(data.canvas_json_back) : undefined,
    templateId: data.template_id ?? undefined,
    printAreaFrontId: data.print_area_front_id ?? undefined,
    printAreaBackId: data.print_area_back_id ?? undefined,
    printAreaFront: data.print_area_front ?? undefined,
    printAreaBack: data.print_area_back ?? undefined,
    zones: (data.zones as Record<string, unknown> | null) ?? undefined,
  }
}

export function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}
