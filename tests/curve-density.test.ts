import { describe, it, expect } from 'vitest'
import { createCanvas } from 'canvas'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import opentype from 'opentype.js'
import { renderCurvedArc, effectiveCurvedScale, CURVE_BAKE_DENSITY, type CanvasFactory, type CurveParams } from '../app/lib/curvedArc'
import { curvedTextToCutPath } from '../app/lib/server/cutFileEngine'

const nodeFactory: CanvasFactory = (w, h) => createCanvas(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h))) as unknown as ReturnType<CanvasFactory>
const P = (over: Partial<CurveParams> = {}): CurveParams => ({ curveAmount: 30, fontSize: 48, fontFamily: 'Arial', fill: '#000000', bold: true, italic: false, ...over })

describe('curved-text bake density (crisp on Retina)', () => {
  it('density 2 bakes a bitmap about twice as wide and tall as density 1', () => {
    const one = renderCurvedArc('BUCKTOWN', P(), nodeFactory, 1)
    const two = renderCurvedArc('BUCKTOWN', P(), nodeFactory, 2)
    expect(one.density).toBe(1); expect(two.density).toBe(2)
    expect(two.width / one.width).toBeGreaterThan(1.9); expect(two.width / one.width).toBeLessThan(2.1)
    expect(two.height / one.height).toBeGreaterThan(1.9); expect(two.height / one.height).toBeLessThan(2.1)
  })
  it('default density is 1 (existing callers/tests unchanged)', () => {
    expect(renderCurvedArc('TEAM', P(), nodeFactory).density).toBe(1)
    expect(CURVE_BAKE_DENSITY).toBe(2)
  })
  it('effectiveCurvedScale: scale × density, tolerant of missing/garbage', () => {
    expect(effectiveCurvedScale(0.5, 2)).toBe(1)
    expect(effectiveCurvedScale(0.75, 2)).toBe(1.5)
    expect(effectiveCurvedScale(1, undefined)).toBe(1)
    expect(effectiveCurvedScale(undefined, 2)).toBe(2)
    expect(effectiveCurvedScale(0.5, 0)).toBe(0.5)
  })
})

describe('cut file is unchanged by the bake density', () => {
  const _fb = readFileSync(path.resolve(__dirname, '../public/fonts/Arial Bold.ttf'))
  const FONT = opentype.parse(_fb.buffer.slice(_fb.byteOffset, _fb.byteOffset + _fb.byteLength))
  const canvasBox = { left: 40, top: 60, width: 600, height: 700 }
  const phys = { width_in: 11, height_in: 12.83 }
  const curve = { curveAmount: 45, fontSizePx: 48, bold: true, italic: false, charSpacing: 0 }
  it('a 2× bake shown at scale 0.5 cuts identically to a 1× bake at scale 1', () => {
    const legacy = { left: 340, top: 300, scaleX: 1, scaleY: 1, angle: 0 }
    const dense = { left: 340, top: 300, scaleX: effectiveCurvedScale(0.5, 2), scaleY: effectiveCurvedScale(0.5, 2), angle: 0 }
    expect(curvedTextToCutPath(FONT, 'CHAMPS', curve, dense, canvasBox, phys)).toBe(curvedTextToCutPath(FONT, 'CHAMPS', curve, legacy, canvasBox, phys))
  })
})
