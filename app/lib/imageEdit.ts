// Client-side raster editing for customer uploads (Phase 5 upload tools).
// The PIXEL ops are pure (operate on a Uint8ClampedArray) so they're unit-testable in Node;
// the DOM glue (element -> ImageData, ImageData -> PNG data URL, color sampling) is a thin
// client-only layer. Each tool produces a transparent PNG the designer re-uploads + persists
// as the REVISED image (so the bundle + auto-tracer receive the edited version).

export type RGB = { r: number; g: number; b: number }

// Remove-a-color (eyedropper): every visible pixel within `tolerance` (Euclidean RGB distance,
// 0–441) of `target` becomes transparent. Global — picking a color knocks it out everywhere.
export function knockoutColorGlobal(data: Uint8ClampedArray, target: RGB, tolerance: number): void {
  const tol2 = tolerance * tolerance
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const dr = data[i] - target.r, dg = data[i + 1] - target.g, db = data[i + 2] - target.b
    if (dr * dr + dg * dg + db * db <= tol2) data[i + 3] = 0
  }
}

// Remove-white (one-tap): transparent-ize near-white pixels CONNECTED to the image border, via a
// flood fill from the edges — so white INSIDE the logo (an eye, a gap) survives. `tolerance` is
// per-channel distance below 255 that still counts as "white" (e.g. 40 => channels >= 215).
export function knockoutWhiteFromEdges(
  data: Uint8ClampedArray, width: number, height: number, tolerance: number,
): void {
  const T = 255 - tolerance
  const isWhite = (i: number) => data[i + 3] !== 0 && data[i] >= T && data[i + 1] >= T && data[i + 2] >= T
  const n = width * height
  const visited = new Uint8Array(n)
  const stack: number[] = []
  const push = (p: number) => { if (p >= 0 && p < n && !visited[p]) { visited[p] = 1; stack.push(p) } }
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x) }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + (width - 1)) }
  while (stack.length) {
    const p = stack.pop() as number
    const i = p * 4
    if (!isWhite(i)) continue // flood stops at non-white — interior white is never reached
    data[i + 3] = 0
    const x = p % width, y = (p - x) / width
    if (x > 0) push(p - 1)
    if (x < width - 1) push(p + 1)
    if (y > 0) push(p - width)
    if (y < height - 1) push(p + width)
  }
}

// ---- DOM glue (client-only) ----

// Draw the image element to an offscreen canvas at NATURAL size and read its pixels.
// Throws if the source is CORS-tainted (caller should catch + tell the customer to re-upload).
export function elementToImageData(el: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number }): ImageData | null {
  const w = (el.naturalWidth || el.width || 0) as number
  const h = (el.naturalHeight || el.height || 0) as number
  if (!w || !h) return null
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(el, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h) // throws on a tainted canvas
}

export function imageDataToPngDataUrl(imgData: ImageData): string {
  const c = document.createElement('canvas')
  c.width = imgData.width; c.height = imgData.height
  c.getContext('2d')!.putImageData(imgData, 0, 0)
  return c.toDataURL('image/png')
}

export function sampleColorAt(imgData: ImageData, x: number, y: number): RGB {
  const xi = Math.max(0, Math.min(imgData.width - 1, Math.round(x)))
  const yi = Math.max(0, Math.min(imgData.height - 1, Math.round(y)))
  const i = (yi * imgData.width + xi) * 4
  return { r: imgData.data[i], g: imgData.data[i + 1], b: imgData.data[i + 2] }
}

// Extract a natural-pixel sub-rectangle of the image element as a PNG data URL (used by both
// auto-trim and manual crop). Coordinates are in the element's natural pixel space.
export function cropToDataUrl(el: CanvasImageSource, nx: number, ny: number, nw: number, nh: number): string {
  const x = Math.max(0, Math.round(nx)), y = Math.max(0, Math.round(ny))
  const w = Math.max(1, Math.round(nw)), h = Math.max(1, Math.round(nh))
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  c.getContext('2d')!.drawImage(el, x, y, w, h, 0, 0, w, h)
  return c.toDataURL('image/png')
}
