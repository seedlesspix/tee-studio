import { describe, it, expect } from 'vitest'
import { createCanvas } from 'canvas'
import * as opentype from 'opentype.js'
import { readFileSync } from 'fs'
import path from 'path'
import { renderCurvedArc, type CanvasFactory, type CurveParams } from '../app/lib/curvedArc'
import { curvedTextToCutPath } from '../app/lib/server/cutFileEngine'
import { bezierControlFromPeak } from '../app/lib/curvePath'

// Type-on-path (Z-hp-2): the raster (curvedArc.ts) and the cut engine (curvedTextToCutPath) both lay
// glyphs along an admin-drawn quadratic via the SAME pathTextLayout — so preview and cut can't drift.
// These lock the new PATH branch in both; the degrees branch is guarded by curved-arc/cut-engine tests.

const nodeFactory: CanvasFactory = (w, h) =>
  createCanvas(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h))) as unknown as ReturnType<CanvasFactory>

// A frown ∩ path: peak ABOVE the endpoints (lower y = higher on screen), canvas-px space.
const FROWN = () => {
  const p0 = { x: 100, y: 220 }, p2 = { x: 420, y: 220 }, peak = { x: 260, y: 120 }
  return { p0, control: bezierControlFromPeak(p0, peak, p2), p2 }
}
const P = (over: Partial<CurveParams> = {}): CurveParams =>
  ({ curveAmount: 45, fontSize: 48, fontFamily: 'Arial', fill: '#000000', bold: false, italic: false, ...over })

describe('type-on-path — raster', () => {
  it('renders along a drawn path (valid, deterministic PNG)', () => {
    const a = renderCurvedArc('TEAM', P({ path: FROWN() }), nodeFactory)
    const b = renderCurvedArc('TEAM', P({ path: FROWN() }), nodeFactory)
    expect(a.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(a.width).toBeGreaterThan(0); expect(a.height).toBeGreaterThan(0)
    expect(a.dataUrl).toBe(b.dataUrl)
  })
  it('a path result differs from the degrees fallback', () => {
    const pth = renderCurvedArc('TEAM', P({ path: FROWN() }), nodeFactory)
    const deg = renderCurvedArc('TEAM', P(), nodeFactory) // curveAmount 45, no path
    expect(pth.dataUrl).not.toBe(deg.dataUrl)
  })
  it('a wide frown renders wider than tall (follows the horizontal arc)', () => {
    const r = renderCurvedArc('CHAMPS', P({ path: FROWN() }), nodeFactory)
    expect(r.width).toBeGreaterThan(r.height)
  })
})

// Real font so the cut engine can outline glyphs to vector paths (opentype). Slice to a clean ArrayBuffer
// (pooled Node Buffers share a backing store — the same guard fontBuffer.ts uses).
const _fb = readFileSync(path.resolve(__dirname, '../public/fonts/Arial Bold.ttf'))
const FONT = opentype.parse(_fb.buffer.slice(_fb.byteOffset, _fb.byteOffset + _fb.byteLength))
const canvasBox = { left: 40, top: 60, width: 600, height: 700 }
const phys = { width_in: 11, height_in: 12.83 }
const place = { left: 340, top: 300, scaleX: 1, scaleY: 1, angle: 0 }
const curve = (over: Partial<Parameters<typeof curvedTextToCutPath>[2]> = {}) =>
  ({ curveAmount: 45, fontSizePx: 48, bold: true, italic: false, charSpacing: 0, ...over })

describe('type-on-path — cut engine', () => {
  it('outlines glyphs along the drawn path (non-empty, curved d)', () => {
    const d = curvedTextToCutPath(FONT, 'CHAMPS', curve({ path: FROWN() }), place, canvasBox, phys)
    expect(d.length).toBeGreaterThan(0)
    expect((d.match(/[CQ]/gi) || []).length).toBeGreaterThan(0) // curvy glyphs (C/P/S) outlined as real curves
  })
  it('the path-mode cut differs from the degrees-mode cut', () => {
    const pth = curvedTextToCutPath(FONT, 'TEAM', curve({ path: FROWN() }), place, canvasBox, phys)
    const deg = curvedTextToCutPath(FONT, 'TEAM', curve(), place, canvasBox, phys)
    expect(pth).not.toBe(deg)
  })
  it('is deterministic', () => {
    const a = curvedTextToCutPath(FONT, 'SMITH', curve({ path: FROWN() }), place, canvasBox, phys)
    const b = curvedTextToCutPath(FONT, 'SMITH', curve({ path: FROWN() }), place, canvasBox, phys)
    expect(a).toBe(b)
  })
})
