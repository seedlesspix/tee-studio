'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ZoomIn } from 'lucide-react'
import { useT } from './StringsProvider'

// PrintSizePreview — "Preview at print size" (Lens 1). Shows a selected RASTER upload rendered at true
// print scale so the customer SEES how sharp (or soft) it will actually print — the visual companion to
// the low-res warning, which only TELLS them a number. The math is the same as the warning's: placed
// inches (from ../lib/lowRes) + the source's natural px → effective DPI. v1 renders at a screen-inch
// approximation (SCREEN_PPI px per print-inch) with a zoom loupe to inspect fine detail; a credit-card
// calibration for exact physical size is a deliberate later add. Raster uploads only — vectors are
// resolution-independent and never trip this (same gate as the warning).

export type PrintPreviewData = {
  src: string          // the hosted upload URL (_uploadSrc) — the file the print pipeline uses
  srcW: number         // natural px of the CURRENT element (post crop / bg-removal)
  srcH: number
  placedInW: number    // placed size on the shirt, inches (worst axis drives the DPI)
  placedInH: number
  dpi: number          // effective DPI at the placed size (Infinity if unknowable)
  tier: 'small' | 'placed' | null // low-res verdict, mirrors the panel warning
  garmentDark?: boolean // Lens 2 hint: a dark garment is almost always a cut transfer → lead with cut lines
  cutEligible?: boolean // Lens 2 gate: false when the bench cuts a DIFFERENT source than this preview (AI/PSD/PDF convert)
}

// WHY the trace failed (mirrors the server's TraceReason) — drives the garment-split message.
type CutReason = 'cuttable' | 'multicolor' | 'too_complex' | 'unreadable'
// Cut-edge trace cache (Lens 2), keyed by upload URL. The trace is deterministic per file, and crop /
// bg-removal produce a NEW url, so a fresh key = automatic invalidation (no manual busting needed).
// trace null = not cuttable; `reason` says why (colors vs fuzzy edges) so the message can be specific.
type CutTrace = { viewBox: string; inner: string }
type CutResult = { trace: CutTrace | null; reason: CutReason }
const traceCache = new Map<string, CutResult>()

// Pull the viewBox + inner markup out of potrace's <svg> so we can re-style the outline (fill→none,
// stroke) and stretch it to the displayed art. potrace emits numeric <g>/<path> only (no scripts).
function parseTrace(svg: string): CutTrace | null {
  const vb = svg.match(/viewBox="([^"]+)"/)
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim()
  if (!vb || !inner) return null
  return { viewBox: vb[1], inner }
}

// Screen pixels per print-inch for the "Actual size" view. ~96 is the CSS reference px/inch — a close
// approximation on most screens. Exact physical size needs per-screen calibration (the later add).
const SCREEN_PPI = 96
// Zoom stops: Fit-to-view, life-size, and two magnifier steps to inspect pixel-level softness.
type ZoomMode = 'fit' | 'actual' | 'x2' | 'x4'
const ZOOM_FACTOR: Record<Exclude<ZoomMode, 'fit'>, number> = { actual: 1, x2: 2, x4: 4 }

export default function PrintSizePreview({
  open, data, onClose,
}: {
  open: boolean
  data: PrintPreviewData | null
  onClose: () => void
}) {
  const t = useT()
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [vp, setVp] = useState({ w: 0, h: 0 })
  const [mode, setMode] = useState<ZoomMode>('actual')
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [loaded, setLoaded] = useState(false)
  const drag = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null)
  // Lens 2 — cut-edge preview. 'idle'→'loading'→'ready' (cuttable, `trace` set) | 'none' (not cuttable) |
  // 'error'. `showCut` toggles the overlay; it leads ON for dark garments (likely transfers).
  const [traceState, setTraceState] = useState<'idle' | 'loading' | 'ready' | 'none' | 'error'>('idle')
  const [trace, setTrace] = useState<CutTrace | null>(null)
  const [cutReason, setCutReason] = useState<CutReason | null>(null) // why a 'none' result happened
  const [showCut, setShowCut] = useState(false)

  // Measure the viewport (drives Fit + pan clamping); re-measure on resize.
  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      const el = viewportRef.current
      if (el) setVp({ w: el.clientWidth, h: el.clientHeight })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open])

  // Fresh open: reset to life-size, centered, not-yet-loaded, cut overlay off.
  useEffect(() => {
    if (open) { setMode('actual'); setLoaded(false); setShowCut(false); setTrace(null); setCutReason(null); setTraceState('idle') }
  }, [open, data?.src])

  // Fetch the cut-edge trace (Lens 2) for the open art. Skipped when the art isn't cut-eligible (a
  // convert whose bench cut-source differs). Cache-first (deterministic per url); on a fresh result lead
  // the overlay ON for dark garments (almost always cut transfers), else leave it to the toggle. A
  // "couldn't read" response (checked:false — fetch/timeout/size/host) stays neutral: NO cut verdict.
  useEffect(() => {
    if (!open || !data) return
    if (data.cutEligible === false) { setTraceState('idle'); return } // no cut preview for this upload
    const src = data.src
    const dark = !!data.garmentDark
    // 'unreadable' → we couldn't process the file, so claim nothing (neutral, like a fetch failure).
    // 'cuttable' → show the outline. Otherwise 'none' with the reason (drives the garment-split message).
    const apply = (res: CutResult) => {
      if (res.reason === 'unreadable') { setTraceState('error'); return }
      if (res.trace) { setTrace(res.trace); setTraceState('ready'); setShowCut(dark) }
      else { setTrace(null); setCutReason(res.reason); setTraceState('none') }
    }
    if (traceCache.has(src)) { apply(traceCache.get(src)!); return }
    let alive = true
    setTraceState('loading')
    fetch('/api/trace-preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: src }) })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('trace failed'))))
      .then((j: { svg?: string | null; checked?: boolean; reason?: CutReason }) => {
        if (!alive) return
        if (j.checked === false) { setTraceState('error'); return } // couldn't read the file — claim nothing (don't cache)
        const parsed = j.svg ? parseTrace(j.svg) : null
        const res: CutResult = { trace: parsed, reason: j.reason || (parsed ? 'cuttable' : 'too_complex') }
        traceCache.set(src, res)
        apply(res)
      })
      .catch(() => { if (alive) setTraceState('error') })
    return () => { alive = false }
  }, [open, data?.src, data?.garmentDark, data?.cutEligible])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !data) return null

  const baseW = data.placedInW * SCREEN_PPI
  const baseH = data.placedInH * SCREEN_PPI
  // Fit zoom: whole art inside the viewport, capped so a tiny placement doesn't balloon absurdly.
  const fitZoom = vp.w > 0 && vp.h > 0 && baseW > 0 && baseH > 0
    ? Math.min(vp.w / baseW, vp.h / baseH, 4)
    : 1
  const zoom = mode === 'fit' ? fitZoom : ZOOM_FACTOR[mode]
  const dispW = baseW * zoom
  const dispH = baseH * zoom

  // Clamp the image position so it can't be dragged fully out of the viewport. Centered on any axis
  // where the image is smaller than the viewport.
  const clampAxis = (val: number, disp: number, view: number) => {
    if (disp <= view) return (view - disp) / 2
    return Math.min(0, Math.max(view - disp, val))
  }
  const posX = clampAxis(offset.x, dispW, vp.w)
  const posY = clampAxis(offset.y, dispH, vp.h)

  // Re-center whenever zoom/size changes (offset is re-derived from clampAxis; reset the stored offset so
  // a mode switch always starts centered).
  const setModeCentered = (m: ZoomMode) => { setMode(m); setOffset({ x: 0, y: 0 }) }

  const onPointerDown = (e: React.PointerEvent) => {
    if (dispW <= vp.w && dispH <= vp.h) return // nothing to pan
    drag.current = { startX: e.clientX, startY: e.clientY, ox: posX, oy: posY }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    setOffset({ x: d.ox + (e.clientX - d.startX), y: d.oy + (e.clientY - d.startY) })
  }
  const onPointerUp = (e: React.PointerEvent) => {
    drag.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  const fmtIn = (n: number) => (Math.round(n * 10) / 10).toString()
  const dpiRounded = Number.isFinite(data.dpi) ? Math.round(data.dpi) : null
  const printsAbout = t('designer.preview.prints_about', 'Prints about {w} × {h} in on the shirt.')
    .replace('{w}', fmtIn(data.placedInW)).replace('{h}', fmtIn(data.placedInH))

  let verdict: string
  let verdictTone: string
  if (data.tier === 'small') {
    verdict = t('designer.preview.verdict_small', 'This file is small ({w}×{h} px) — it may look blocky at any size. A larger file prints sharpest.')
      .replace('{w}', String(data.srcW)).replace('{h}', String(data.srcH))
    verdictTone = 'text-amber-700'
  } else if (data.tier === 'placed') {
    verdict = t('designer.preview.verdict_soft', 'About {dpi} DPI at this size — it may look soft in print. 300 DPI looks sharpest: try making it smaller on the shirt, or email us your original.')
      .replace('{dpi}', String(dpiRounded ?? ''))
    verdictTone = 'text-amber-700'
  } else {
    verdict = dpiRounded != null
      ? t('designer.preview.verdict_sharp', 'About {dpi} DPI at this size — this should print sharp.').replace('{dpi}', String(dpiRounded))
      : ''
    verdictTone = 'text-emerald-700'
  }

  // "Not cuttable" message SPLITS BY GARMENT (Denise, shop truth): on DARK garments a design is cut by its
  // edges (transfer), so a failed trace is a CLEAN-UP warning — NOT "we'll print it instead" — and it names
  // the actual problem (fuzzy edges vs too many colors). On LIGHT garments, failing the cut just means it
  // gets printed. Wording is language-editable.
  let cutNoneMsg = ''
  let cutNoneTone = 'text-gray-500'
  if (data.garmentDark) {
    cutNoneMsg = cutReason === 'multicolor'
      ? t('designer.preview.cut_none_dark_colors', 'On dark garments this design is cut by its edges — and as-is it has too many colors to cut cleanly as one piece. Send us a version with solid colors and crisp edges, or we may need to clean it up first (this can add time).')
      : t('designer.preview.cut_none_dark_fuzzy', 'On dark garments this design is cut by its edges — and as-is, the edges are too fuzzy to cut cleanly. We may need to clean it up (this can add time), or send us a version with solid colors and crisp edges.')
    cutNoneTone = 'text-amber-700'
  } else {
    cutNoneMsg = t('designer.preview.cut_none_light', 'This design would be printed, not cut.')
  }

  const canPan = dispW > vp.w || dispH > vp.h
  const zoomBtn = (m: ZoomMode, label: string) => (
    <button
      onClick={() => setModeCentered(m)}
      className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
        mode === m ? 'border-gray-800 bg-gray-900 text-white' : 'border-gray-300 text-gray-700 hover:border-gray-400'
      }`}
    >{label}</button>
  )

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-label={t('designer.preview.title', 'Preview at print size')}
        className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-gray-200 px-4 h-12">
          <span className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-gray-900">
            <ZoomIn size={15} strokeWidth={2} /> {t('designer.preview.title', 'Preview at print size')}
          </span>
          <button onClick={onClose} aria-label={t('designer.close', 'Close')}
            className="flex h-7 w-7 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100">✕</button>
        </header>

        <div className="flex flex-col gap-3 p-4">
          {/* The loupe. Checker background reads through transparent PNGs; drag to pan when magnified. */}
          <div
            ref={viewportRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="relative w-full overflow-hidden rounded-lg border border-gray-200 select-none"
            style={{
              height: 'min(60vh, 460px)',
              backgroundColor: '#fff',
              backgroundImage: 'linear-gradient(45deg,#eee 25%,transparent 25%),linear-gradient(-45deg,#eee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eee 75%),linear-gradient(-45deg,transparent 75%,#eee 75%)',
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
              cursor: canPan ? (drag.current ? 'grabbing' : 'grab') : 'default',
              touchAction: 'none',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.src}
              alt=""
              draggable={false}
              onLoad={() => setLoaded(true)}
              style={{
                position: 'absolute',
                left: posX, top: posY,
                width: dispW, height: dispH,
                maxWidth: 'none',
                imageRendering: 'auto',
                opacity: loaded ? 1 : 0,
                transition: 'opacity 120ms',
              }}
            />
            {/* Cut-edge overlay (Lens 2): the production trace, re-styled as a magenta outline with a white
                halo so it reads on any art/garment. Stretched to the exact same box as the image (both fill
                dispW×dispH), so it aligns even under non-uniform scale. non-scaling-stroke keeps the line a
                constant screen width across zoom. */}
            {showCut && trace && (
              <svg
                viewBox={trace.viewBox}
                preserveAspectRatio="none"
                width={dispW} height={dispH}
                style={{ position: 'absolute', left: posX, top: posY, pointerEvents: 'none' }}
                aria-hidden="true"
              >
                <g className="psp-cut-halo" dangerouslySetInnerHTML={{ __html: trace.inner }} />
                <g className="psp-cut-line" dangerouslySetInnerHTML={{ __html: trace.inner }} />
              </svg>
            )}
            {!loaded && (
              <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-gray-400">
                {t('designer.preview.loading', 'Loading…')}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {zoomBtn('fit', t('designer.preview.zoom_fit', 'Fit'))}
              {zoomBtn('actual', t('designer.preview.zoom_actual', 'Actual size'))}
              {zoomBtn('x2', '2×')}
              {zoomBtn('x4', '4×')}
            </div>
            {canPan && (
              <span className="text-[11px] text-gray-400">{t('designer.preview.pan_hint', 'Drag to move around')}</span>
            )}
          </div>

          {/* Cut-edge controls (Lens 2). Toggle appears only when the art actually traces (cuttable). */}
          {traceState === 'loading' && (
            <p className="text-[11px] text-gray-400">{t('designer.preview.cut_checking', 'Checking how this would cut…')}</p>
          )}
          {traceState === 'ready' && (
            <label className="flex w-fit cursor-pointer select-none items-center gap-2 text-[13px] text-gray-800">
              <input type="checkbox" checked={showCut} onChange={e => setShowCut(e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-[#e11d8f]" />
              <span className="inline-block h-0 w-5 border-t-2 border-[#e11d8f]" aria-hidden="true" />
              {t('designer.preview.cut_toggle', 'Show cut lines')}
            </label>
          )}
          {traceState === 'none' && (
            <p className={`text-[11px] leading-snug ${cutNoneTone}`}>{cutNoneMsg}</p>
          )}

          <div className="flex flex-col gap-1 rounded-lg bg-gray-50 px-3 py-2.5">
            <p className="text-[13px] font-medium text-gray-900">{printsAbout}</p>
            {verdict && <p className={`text-xs leading-snug ${verdictTone}`}>{verdict}</p>}
            {traceState === 'ready' && showCut && (
              <p className="text-[11px] leading-snug text-gray-500">
                {t('designer.preview.cut_hedge', 'The magenta outline is how this art would cut. Our team makes the final print-or-cut call for your order.')}
                {data.garmentDark ? ' ' + t('designer.preview.cut_dark_hint', 'Dark garments are usually printed as a cut transfer.') : ''}
              </p>
            )}
            <p className="mt-0.5 text-[11px] leading-snug text-gray-400">
              {t('designer.preview.screen_note', "“Actual size” is your screen's best estimate of real print size — it can vary a little by screen. Zoom in to inspect fine detail up close.")}
            </p>
          </div>
          <style>{`
            .psp-cut-halo path, .psp-cut-halo polygon { fill: none; stroke: #ffffff; stroke-width: 3.5; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
            .psp-cut-line path, .psp-cut-line polygon { fill: none; stroke: #e11d8f; stroke-width: 1.5; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
          `}</style>
        </div>
      </div>
    </div>
  )
}
