// Local auto-draft: a debounced sessionStorage snapshot of the in-progress design so an accidental
// refresh / pull-to-refresh doesn't lose UNSAVED work (the server draft only exists after login or
// "Next Step"; My Designs only after an explicit save). sessionStorage = per-tab, survives reload,
// clears on tab close — exactly the "survive a refresh" scope. The pure decision logic lives here so
// it's testable; the browser I/O (sessionStorage, reload detection) stays in the component.

export const AUTODRAFT_KEY = 'tee_designer_autodraft'
const CURRENT_VERSION = 1

export type AutodraftEnvelope = {
  v: number
  ts: number
  productId?: string
  state: unknown
}

export function buildEnvelope(state: { productId?: string } & Record<string, unknown>, now: number): AutodraftEnvelope {
  return { v: CURRENT_VERSION, ts: now, productId: state.productId, state }
}

export function parseEnvelope(raw: string | null): AutodraftEnvelope | null {
  if (!raw) return null
  try {
    const e = JSON.parse(raw)
    if (e && typeof e === 'object' && e.v === CURRENT_VERSION && e.state) return e as AutodraftEnvelope
  } catch { /* corrupt */ }
  return null
}

// Restore a snapshot ONLY when it's a genuine reload of the SAME product with a valid envelope.
// Gating on reload is the key safety rule: on a FRESH navigation (e.g. starting a new design on a
// product you designed earlier this session) a lingering snapshot must NOT hijack the blank canvas.
export function shouldRestore(
  envelope: AutodraftEnvelope | null,
  opts: { isReload: boolean; currentProductId?: string },
): boolean {
  if (!envelope || !envelope.state) return false
  if (!opts.isReload) return false
  if (envelope.productId && opts.currentProductId && envelope.productId !== opts.currentProductId) return false
  return true
}
