// Rotated-footprint fit. When an object of unrotated size w×h is rotated by `angleDeg`, its
// axis-aligned footprint grows to (|cos|·w + |sin|·h) × (|sin|·w + |cos|·h). This returns the largest
// UNIFORM scale at which that rotated footprint still fits inside boundsW×boundsH — so a large object
// can be auto-shrunk just enough to stay fully inside the print area as it's rotated or scaled, instead
// of poking out one side (which the cut/layout engine would crop). At angle 0 it reduces to the plain
// box/size fit (min(boundsW/w, boundsH/h)), so unrotated behavior is unchanged. Pure + testable.
export function maxScaleForRotation(
  w: number, h: number, angleDeg: number, boundsW: number, boundsH: number,
): number {
  if (!(w > 0) || !(h > 0)) return Infinity
  const rad = (angleDeg * Math.PI) / 180
  const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad))
  const footW = c * w + s * h
  const footH = s * w + c * h
  return Math.min(
    footW > 0 ? boundsW / footW : Infinity,
    footH > 0 ? boundsH / footH : Infinity,
  )
}
