import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import paper from 'paper-jsdom'
import { assembleCutSvgUnioned } from '../app/lib/server/cutBoolean'
import { autoTraceSvg } from '../app/lib/server/autoTrace'

const phys = { width_in: 12, height_in: 16 } // 3600 x 4800 print box
const pathCount = (svg: string) => (svg.match(/<path/g) || []).length
const extractD = (svg: string) => svg.match(/ d="([^"]+)"/)?.[1] ?? ''
const extractAllD = (svg: string) => (svg.match(/ d="([^"]+)"/g) || []).join(' ')
// paper's NO-boolean re-emit of a path — the faithful baseline the fix must match for
// non-overlapping art (a revert to unconditional unite/intersect would re-fit and diverge).
function faithfulReEmit(d: string): string {
  const scope = new paper.PaperScope()
  scope.setup(new scope.Size(3600, 4800))
  try { return (scope.PathItem.create(d) as unknown as { pathData: string }).pathData }
  finally { scope.project?.remove() }
}

// A smooth, closed, NON-overlapping blob (4 cubics) well inside the print box. This is the exact
// shape the fidelity bug hit: unconditional paper unite/intersect re-fit shallow curves into flats.
const BLOB = 'M1000 1400 C1000 1000 1600 800 2200 1000 C2800 1200 2900 2000 2400 2400 C2000 2700 1300 2600 1050 2100 C950 1900 1000 1600 1000 1400 Z'

describe('cut engine — curve fidelity (guards the paper.js boolean gate)', () => {
  it('emits non-overlapping art byte-identical to the faithful re-emit (no boolean re-fit)', () => {
    const svg = assembleCutSvgUnioned([{ d: BLOB, fill: '#000000' }], phys)
    expect(svg).toContain('<svg')
    expect(pathCount(svg)).toBe(1)
    // The fix: for a non-overlapping shape inside the box the engine runs NO boolean, so its path
    // data is byte-identical to paper's faithful re-emit. Reverting to unconditional unite/intersect
    // re-fits shallow curves (the flat-facet bug) and this diverges.
    expect(extractD(svg)).toBe(faithfulReEmit(BLOB))
    expect((extractD(svg).match(/[CQ]/gi) || []).length).toBeGreaterThanOrEqual(4) // curves present
  })

  it('still unions genuinely overlapping same-color shapes into one outline', () => {
    const rA = 'M300 300 H1800 V1800 H300 Z'
    const rB = 'M1200 1200 H2700 V2700 H1200 Z' // overlaps rA
    const svg = assembleCutSvgUnioned([{ d: rA, fill: '#dd0000' }, { d: rB, fill: '#dd0000' }], phys)
    expect(pathCount(svg)).toBe(1) // merged to a single cut outline
  })

  it('closes open (Z-less) contours so a boolean keeps their final curve — no straight-close notch', () => {
    // opentype's toPathData returns each contour to its start but emits NO closepath. Paper parses
    // those OPEN, and when a boolean runs it closes them with a STRAIGHT line — dropping the contour's
    // final curve (an "O" counter, an "S" tail came out notched; straight-edged glyphs looked fine).
    const OPEN = BLOB.replace(/\s*Z\s*$/, '')          // the same smooth 4-cubic blob, minus its Z
    const ovA = 'M2600 300 H3100 V800 H2600 Z'
    const ovB = 'M2900 600 H3400 V1100 H2900 Z'        // ovA∩ovB self-overlaps → forces unite on the layer
    const svg = assembleCutSvgUnioned(
      [{ d: OPEN, fill: '#000000' }, { d: ovA, fill: '#000000' }, { d: ovB, fill: '#000000' }], phys,
    )
    // The blob is disjoint from the overlap, but paper unites the WHOLE color layer. With the Z-close
    // fix the blob's 4 cubics survive; without it the closing cubic degrades to a straight line.
    expect((extractAllD(svg).match(/[CQcq]/g) || []).length).toBeGreaterThanOrEqual(4)
  })

  it('mirror bakes a different geometry into the path', () => {
    const normal = assembleCutSvgUnioned([{ d: BLOB, fill: '#000' }], phys)
    const mirrored = assembleCutSvgUnioned([{ d: BLOB, fill: '#000' }], phys, { mirror: true })
    expect(mirrored).not.toBe(normal)
    expect(mirrored).toContain('<path')
  })
})

describe('auto-trace gate', () => {
  it('traces a one-color logo', async () => {
    const logo = await sharp(Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><circle cx="200" cy="200" r="150" fill="#000"/></svg>',
    )).png().toBuffer()
    const svg = await autoTraceSvg(new Uint8Array(logo))
    expect(svg).toBeTruthy()
    expect(svg).toContain('<svg')
  })

  it('rejects a multi-color image (a photo-like rainbow)', async () => {
    const stops = Array.from({ length: 12 }, (_, i) => `<stop offset="${i / 11}" stop-color="hsl(${i * 30},90%,50%)"/>`).join('')
    const rainbow = await sharp(Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient></defs><rect width="240" height="240" fill="url(#g)"/></svg>`,
    )).png().toBuffer()
    const svg = await autoTraceSvg(new Uint8Array(rainbow))
    expect(svg).toBeNull()
  })
})
