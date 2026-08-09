// Selection-handle rendering shared by the designer's desktop + mobile control
// sets (#20). ONE look on both platforms: a white disc (soft shadow + thin neutral
// ring so it reads on ANY garment colour) with a COLOUR-DIFFERENTIATED icon — RED
// delete, BLACK rotate, BLACK resize. Bigger than the old dots, with a generous tap
// target. Pure 2D-canvas drawing (no Fabric dependency); each platform wraps these
// in Fabric Control.render closures. NOT serialized and NOT in the PNG/SVG export —
// pure selection chrome, so saves and parity hashes are unaffected.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const HANDLE_RED = '#dd3333'  // delete — matches the brand action red
export const HANDLE_DARK = '#111827' // rotate + resize — near-black (Denise round 2: black, not blue)
const RING = 'rgba(17,24,39,0.55)'   // neutral ring: visible on both white and black garments

// White disc centered at the current ctx origin (caller has translated to left/top).
export function drawHandleDisc(ctx: any, size: number) {
  ctx.shadowColor = 'rgba(0,0,0,0.30)'
  ctx.shadowBlur = size * 0.16
  ctx.shadowOffsetY = size * 0.04
  ctx.beginPath()
  ctx.arc(0, 0, size / 2, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.shadowOffsetY = 0
  ctx.lineWidth = Math.max(1, size * 0.05)
  ctx.strokeStyle = RING
  ctx.stroke()
}

// RED ✕
export function drawDeleteIcon(ctx: any, size: number) {
  const r = size * 0.2
  ctx.strokeStyle = HANDLE_RED
  ctx.lineWidth = Math.max(2, size * 0.12)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(-r, -r); ctx.lineTo(r, r)
  ctx.moveTo(r, -r); ctx.lineTo(-r, r)
  ctx.stroke()
}

// BLACK circular arrow (drawn, not a glyph — the ↻ character renders too small)
export function drawRotateIcon(ctx: any, size: number) {
  ctx.strokeStyle = HANDLE_DARK
  ctx.lineWidth = Math.max(2, size * 0.11)
  ctx.lineCap = 'round'
  const R = size * 0.26
  const end = Math.PI * 1.15
  ctx.beginPath()
  ctx.arc(0, 0, R, -Math.PI * 0.45, end) // ~3/4 open circle
  ctx.stroke()
  const ex = Math.cos(end) * R, ey = Math.sin(end) * R // arrowhead at the arc end
  const back = end + Math.PI / 2 + Math.PI
  const h = size * 0.2
  ctx.beginPath()
  ctx.moveTo(ex, ey); ctx.lineTo(ex + Math.cos(back - 0.5) * h, ey + Math.sin(back - 0.5) * h)
  ctx.moveTo(ex, ey); ctx.lineTo(ex + Math.cos(back + 0.5) * h, ey + Math.sin(back + 0.5) * h)
  ctx.stroke()
}

// BLACK diagonal double-headed arrow (↘↖) — the universal "resize" glyph
export function drawResizeIcon(ctx: any, size: number) {
  ctx.strokeStyle = HANDLE_DARK
  ctx.lineWidth = Math.max(2, size * 0.1)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const r = size * 0.22
  ctx.beginPath()
  ctx.moveTo(-r, -r); ctx.lineTo(r, r) // shaft
  ctx.stroke()
  const a = size * 0.15
  ctx.beginPath()
  ctx.moveTo(r, r); ctx.lineTo(r - a, r)   // bottom-right head
  ctx.moveTo(r, r); ctx.lineTo(r, r - a)
  ctx.moveTo(-r, -r); ctx.lineTo(-r + a, -r) // top-left head
  ctx.moveTo(-r, -r); ctx.lineTo(-r, -r + a)
  ctx.stroke()
}

// Compose a disc + icon into a Fabric control render fn. `sizeOf(obj)` gives the
// disc diameter — mobile passes the object's inverse-scaled cornerSize (so the disc
// is a constant ~28px on screen through the stage's CSS scale); desktop passes a
// fixed px. Signature matches Fabric's Control.render(ctx, left, top, style, obj).
export function makeHandleRender(
  drawIcon: (ctx: any, size: number) => void,
  sizeOf: (obj: any) => number,
) {
  return (ctx: any, left: number, top: number, _styleOverride: any, obj: any) => {
    const size = sizeOf(obj)
    ctx.save()
    ctx.translate(left, top)
    drawHandleDisc(ctx, size)
    drawIcon(ctx, size)
    ctx.restore()
  }
}
