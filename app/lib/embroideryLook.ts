'use client'
// Embroidery-look preview (BETA item 10, v1). Client-only — wraps Fabric object internals.
//
// In EMBROIDERY mode, text + vector clip art render with a satin-thread texture tinted to the ink color
// and raised off the fabric, so customers see it'll be STITCHED, not flat-printed. Uniform grain (not
// contour-following — that's the named post-launch version).
//
// 🔒 Decoupling (the load-bearing design): the object's real `fill` stays the SOLID ink color, so the
// cut/geometry pipeline, canvas_json save, color reflection, and D2 refit are ALL untouched. The thread
// texture is a RENDER-TIME overlay: we wrap the object's _render so that AFTER the solid fill paints, we
// composite diagonal thread bands with `source-atop` — which clips them to the painted glyph shapes for
// free. Because this runs inside _render it bakes into Fabric's object cache and is captured by every
// render: the on-canvas display AND canvas.toDataURL (→ canvas_png → cart/order images). toObject() and
// the server cut engine never call _render, so geometry + ink color stay clean. A bug here can only make
// the PREVIEW look wrong — it can never corrupt the saved design or the cut files.

/* eslint-disable @typescript-eslint/no-explicit-any */
type FabricObj = any

// A lighter/darker shade of a #rrggbb ink (amt in -255..255), for thread strand shading + sheen.
export function shade(hex: string, amt: number): string {
  const h = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return hex
  const n = parseInt(h, 16)
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  const r = c(((n >> 16) & 255) + amt), g = c(((n >> 8) & 255) + amt), b = c((n & 255) + amt)
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
}

const THREAD_ANGLE = -0.28 // ~ -16° → threads run ≈74° across the fill
const THREAD_PERIOD = 3.2   // px between thread strands (in object space)

// Paint the satin-thread overlay for an object whose real fill has already been rendered, clipped to
// that fill via source-atop. Draws parallel diagonal strands (dark edge → ink → light sheen) across the
// object's bbox, plus one soft cross-sheen — no tiling/pattern, so there are no seam artifacts.
function paintThreads(ctx: CanvasRenderingContext2D, obj: FabricObj) {
  const ink: string = obj._embInk || '#808080'
  const w = obj.width || 0, h = obj.height || 0
  if (!w || !h) return
  const span = Math.hypot(w, h) + 8
  // A multicolor RASTER decal has no single ink — painting opaque single-ink strands would flatten it
  // to one thread color (the reported bug). For those, PRESERVE the underlying colors: paint low-alpha
  // dark/light shading strands (a stitch-ridge feel) that modulate the image via source-atop's alpha
  // compositing rather than replacing it. Solid-fill text / recolored SVG (one ink) keep the opaque
  // ink gradient, which is exactly right for them.
  const preserve = !!obj._embPreserveColor
  ctx.save()
  ctx.globalCompositeOperation = 'source-atop' // texture only where the object already painted
  ctx.rotate(THREAD_ANGLE)
  if (preserve) {
    // Note: _embInk is intentionally unused here — the image carries its own colors, so we only add
    // neutral light/dark ridging. (This is also why a textColor change doesn't retint raster art.)
    for (let x = -span; x < span; x += THREAD_PERIOD) {
      const grad = ctx.createLinearGradient(x, 0, x + THREAD_PERIOD, 0)
      grad.addColorStop(0, 'rgba(0,0,0,0.32)'); grad.addColorStop(0.5, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(255,255,255,0.30)')
      ctx.fillStyle = grad
      ctx.fillRect(x, -span, THREAD_PERIOD, span * 2)
    }
  } else {
    const dark = shade(ink, -48), light = shade(ink, 62)
    for (let x = -span; x < span; x += THREAD_PERIOD) {
      const grad = ctx.createLinearGradient(x, 0, x + THREAD_PERIOD, 0)
      grad.addColorStop(0, dark); grad.addColorStop(0.5, ink); grad.addColorStop(1, light)
      ctx.fillStyle = grad
      ctx.fillRect(x, -span, THREAD_PERIOD, span * 2)
    }
  }
  ctx.restore()
  // soft diagonal sheen band across the whole fill
  ctx.save()
  ctx.globalCompositeOperation = 'source-atop'
  const sheen = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2)
  sheen.addColorStop(0, 'rgba(255,255,255,0)')
  sheen.addColorStop(0.48, 'rgba(255,255,255,0.20)')
  sheen.addColorStop(0.66, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen
  ctx.fillRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8)
  ctx.restore()
}

// Install the thread overlay on an object (idempotent — a re-call just re-tints). Records the original
// _render so it can be fully removed. `inkHex` is the object's solid ink color.
export function applyEmbroideryLook(obj: FabricObj, inkHex: string, preserveColor = false) {
  if (!obj) return
  obj._embInk = inkHex
  obj._embPreserveColor = preserveColor // true for multicolor raster: modulate, don't recolor
  if (obj._embWrapped) { obj.dirty = true; return } // already wrapped; retint + invalidate cache
  const orig = obj._render
  obj._embOrigRender = orig
  obj._embWrapped = true
  obj._render = function (ctx: CanvasRenderingContext2D) {
    orig.call(this, ctx)
    try { paintThreads(ctx, this) } catch { /* preview-only; never let it break a render */ }
  }
  obj.dirty = true
}

// Fully remove the thread overlay (back to a flat fill).
export function removeEmbroideryLook(obj: FabricObj) {
  if (!obj || !obj._embWrapped) return
  obj._render = obj._embOrigRender
  delete obj._embOrigRender
  delete obj._embWrapped
  delete obj._embInk
  delete obj._embPreserveColor
  obj.dirty = true
}
