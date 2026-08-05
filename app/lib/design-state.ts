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
  uploadedFiles?: UploadedFile[]
  roster?: RosterEntry[] // Names & Numbers (Phase 1: auto-draft only; no DB column until Phase 2)
}

// The columns rowToDesignState needs — keep in lockstep with it.
export const DESIGN_STATE_COLUMNS =
  'shopify_product_id, shopify_variant_id, product_title, selected_color, print_method, quantities, uploaded_files, sides_designed, canvas_json_front, canvas_json_back'

export type DesignStateRow = {
  shopify_product_id: string | null
  shopify_variant_id: string | null
  product_title: string | null
  selected_color: string | null
  print_method: string | null
  quantities: unknown
  uploaded_files: unknown
  sides_designed: number | null
  canvas_json_front: string | null
  canvas_json_back: string | null
}

export function designStateToRow(state: DesignState) {
  return {
    shopify_product_id: state.productId ?? null,
    shopify_variant_id: state.variantId ?? null,
    product_title: state.productTitle ?? null,
    selected_color: state.selectedColor ?? null,
    print_method: state.printMethod ?? null,
    quantities: (state.quantities ?? null) as never,
    uploaded_files: (state.uploadedFiles ?? null) as never,
    sides_designed: state.sidesDesigned ?? null,
    canvas_json_front: state.front ? JSON.stringify(state.front) : null,
    canvas_json_back: state.back ? JSON.stringify(state.back) : null,
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
    uploadedFiles: (data.uploaded_files as UploadedFile[] | null) ?? undefined,
    sidesDesigned: data.sides_designed ?? undefined,
    front: data.canvas_json_front ? safeParse(data.canvas_json_front) : undefined,
    back: data.canvas_json_back ? safeParse(data.canvas_json_back) : undefined,
  }
}

export function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}
