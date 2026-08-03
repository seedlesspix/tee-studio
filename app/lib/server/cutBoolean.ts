// Cutter-ready assembly (Phase 5). Turns the raw per-object cut paths into what the store's
// Roland actually wants, so files arrive with ZERO manual prep:
//   1. per color layer, UNION all shapes into one merged outline — overlaps gone, so the blade
//      cuts one path, not buried internal edges (the store's Pathfinder-Unite step);
//   2. CROP mathematically to the print box — flat geometry, NO <clipPath>/clip-path mask for
//      the cutter to choke on (the store's delete-the-clip step);
//   3. optionally MIRROR for heat-transfer vinyl — baked into the coordinates, not a transform
//      attribute (the store's flip step).
// Holes and curves are preserved (paper.js). A fresh PaperScope per call keeps it concurrency-safe.
import paper from 'paper-jsdom'
import type { CutPath, PhysBox } from './cutFileEngine'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const idSafe = (fill: string) => fill.replace(/[^A-Za-z0-9]+/g, '_').replace(/^(\d)/, '_$1')

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
    for (const p of paths) { if (!p.d) continue; const a = byColor.get(p.fill) ?? []; a.push(p.d); byColor.set(p.fill, a) }

    const layers: string[] = []
    let i = 0
    for (const [fill, ds] of byColor) {
      const raw = scope.PathItem.create(ds.join(' '))
      const united = raw.unite(new scope.Path())          // merge overlaps, holes preserved via winding
      const region = united.intersect(box)                // crop = mathematical print-box mask
      if (opts.mirror) region.scale(-1, 1, new scope.Point(viewW / 2, viewH / 2)) // flip for HTV
      const d = region.pathData || ''
      raw.remove(); united.remove(); region.remove()
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
