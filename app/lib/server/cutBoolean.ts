// Cutter-ready assembly (Phase 5). Turns the raw per-object cut paths into what the store's
// Roland actually wants, so files arrive with ZERO manual prep:
//   1. per color layer, UNION all shapes into one merged outline — overlaps gone, so the blade
//      cuts one path, not buried internal edges (the store's Pathfinder-Unite step);
//   2. CROP mathematically to the print box — flat geometry, NO <clipPath>/clip-path mask for
//      the cutter to choke on (the store's delete-the-clip step);
//   3. optionally MIRROR for heat-transfer vinyl — baked into the coordinates, not a transform
//      attribute (the store's flip step).
// ⚠️ CURVE FIDELITY: paper's boolean ops (unite/intersect) RE-TRACE the path and re-fit shallow
// curves into flat segments (a smooth "o" counter came out squared-off). So we gate them on ACTUAL
// geometry — union ONLY when a color layer self-overlaps (edges cross), crop ONLY when it crosses
// the print-box edge. Non-overlapping art fully inside the box runs NO boolean → curves stay exact
// (identical to the layout glyph). Holes and curves are preserved. Fresh PaperScope per call =
// concurrency-safe.
import paper from 'paper-jsdom'
import type { CutPath, PhysBox } from './cutFileEngine'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const idSafe = (fill: string) => fill.replace(/[^A-Za-z0-9]+/g, '_').replace(/^(\d)/, '_$1')

// 🚨 opentype's toPathData returns each contour to its start point but emits NO closepath ('Z'), so
// paper parses them as OPEN subpaths. When a boolean op (unite/intersect) then closes such a subpath,
// it replaces the contour's FINAL CURVE with a straight closing line — notching rounded features (an
// "O" counter, an "S" tail, cursive bowls) while straight-edged glyphs look fine. Every cut shape is a
// closed fill, so force an explicit Z on each subpath before paper sees it. Harmless where no boolean
// runs (endpoint already coincides with start → zero-length close) and idempotent if a Z is present.
const closeSubpaths = (d: string): string =>
  !d ? d : d.split(/(?=[Mm])/).map(s => {
    const t = s.trim()
    return !t ? '' : /[Zz]\s*$/.test(t) ? t : t + 'Z'
  }).filter(Boolean).join('')

// Phase 2 (cut model): assemble EXPLICITLY-NAMED layers into ONE Illustrator-ready SVG — so a mixed
// raster order lands as a single file whose Layers panel reads "Contour", "Vinyl #hex", "Cut #hex", and
// the bench sees every make-up option in one place (Denise 2026-08-27). Same per-layer union/crop/mirror
// treatment and the same physical 300-DPI space as assembleCutSvgUnioned; the only difference is the group
// carries the caller's name instead of one derived from the fill.
// `reorient`: normalize subpath winding for the nonzero fill rule BEFORE any boolean/output. potrace emits
// hole subpaths (letter counters) with the SAME winding as their outer contour, which nonzero fills in
// solid (opentype vector paths already wind holes opposite, so they don't need this). paper's reorient()
// makes nested subpaths wind opposite so nonzero renders the holes correctly AND they survive crop/union.
export type NamedCutLayer = { name: string; fill: string; d: string; reorient?: boolean }
export function assembleLayeredCutSvg(
  layers: NamedCutLayer[], phys: PhysBox, opts: { dpi?: number; mirror?: boolean } = {},
): string {
  const dpi = opts.dpi ?? 300
  const viewW = Math.round(phys.width_in * dpi), viewH = Math.round(phys.height_in * dpi)
  const scope = new paper.PaperScope()
  scope.setup(new scope.Size(Math.max(viewW, 1), Math.max(viewH, 1)))
  try {
    const box = new scope.Path.Rectangle(new scope.Rectangle(0, 0, viewW, viewH))
    const out: string[] = []
    let i = 0
    for (const layer of layers) {
      if (!layer.d) { i++; continue }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const combined: any = scope.PathItem.create(closeSubpaths(layer.d))
      // Fix potrace's same-winding holes BEFORE any boolean/output (see NamedCutLayer.reorient).
      if (layer.reorient && typeof combined.reorient === 'function') combined.reorient()
      const selfCrosses = (combined.getCrossings ? combined.getCrossings() : combined.getIntersections()).length > 0
      const insideBox = box.bounds.contains(combined.bounds)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let region: any = combined
      if (selfCrosses) { const empty = new scope.Path(); region = region.unite(empty); empty.remove() }
      if (!insideBox) region = region.intersect(box)
      if (opts.mirror) region.scale(-1, 1, new scope.Point(viewW / 2, viewH / 2))
      const d = region.pathData || ''
      if (region !== combined) combined.remove()
      region.remove()
      if (d) {
        out.push(
          `  <g id="${idSafe(layer.name)}" data-name="${esc(layer.name)}">\n` +
          `    <path fill="${layer.fill}" fill-rule="nonzero" d="${d}"/>\n  </g>`,
        )
      }
      i++
    }
    box.remove()
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${phys.width_in}in" height="${phys.height_in}in" viewBox="0 0 ${viewW} ${viewH}" preserveAspectRatio="xMidYMid meet">
${out.join('\n')}
</svg>`
  } finally {
    scope.project?.remove()
  }
}

export function assembleCutSvgUnioned(
  paths: CutPath[], phys: PhysBox, opts: { dpi?: number; mirror?: boolean } = {},
): string {
  const dpi = opts.dpi ?? 300
  const viewW = Math.round(phys.width_in * dpi), viewH = Math.round(phys.height_in * dpi)

  const scope = new paper.PaperScope()
  scope.setup(new scope.Size(Math.max(viewW, 1), Math.max(viewH, 1)))
  try {
    const box = new scope.Path.Rectangle(new scope.Rectangle(0, 0, viewW, viewH))
    const byColor = new Map<string, string[]>()
    for (const p of paths) { if (!p.d) continue; const a = byColor.get(p.fill) ?? []; a.push(closeSubpaths(p.d)); byColor.set(p.fill, a) }

    const layers: string[] = []
    let i = 0
    for (const [fill, ds] of byColor) {
      // `any`: paper's TS types require getCrossings(arg) but the runtime supports the no-arg
      // SELF-crossings form, and unite/intersect return the PathItem base (not the Path|CompoundPath
      // that create() is typed as), which trips reassignment. The runtime is verified.
      const combined: any = scope.PathItem.create(ds.join(' '))
      // Gate the lossy boolean ops on real geometry (see the fidelity note above).
      const selfCrosses = (combined.getCrossings ? combined.getCrossings() : combined.getIntersections()).length > 0
      const insideBox = box.bounds.contains(combined.bounds)
      let region: any = combined
      if (selfCrosses) { const empty = new scope.Path(); region = region.unite(empty); empty.remove() } // merge overlaps (holes preserved via winding)
      if (!insideBox) region = region.intersect(box)      // crop = mathematical print-box mask (only when it overflows)
      if (opts.mirror) region.scale(-1, 1, new scope.Point(viewW / 2, viewH / 2)) // flip for HTV
      const d = region.pathData || ''
      if (region !== combined) combined.remove()
      region.remove()
      if (d) {
        layers.push(
          `  <g id="Layer_${i}_${idSafe(fill)}" data-name="${esc(fill)}">\n` +
          `    <path fill="${fill}" fill-rule="nonzero" d="${d}"/>\n  </g>`,
        )
      }
      i++
    }
    box.remove()

    // No <clipPath>/clip-path def — the crop is baked into the path geometry.
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${phys.width_in}in" height="${phys.height_in}in" viewBox="0 0 ${viewW} ${viewH}" preserveAspectRatio="xMidYMid meet">
${layers.join('\n')}
</svg>`
  } finally {
    scope.project?.remove() // free this call's project so scopes don't accumulate
  }
}
