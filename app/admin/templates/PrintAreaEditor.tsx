'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Tables } from '@/types/database'
import { ZONE_LABELS } from '../../lib/mockupFilename'
import { bezierControlFromPeak } from '../../lib/curvePath'

type AreaRow = Tables<'product_template_print_areas'>

// Local editing shape: a stable client key plus the DB `id` once persisted.
type EditArea = {
  _key: string
  id?: string
  name: string
  side: string
  print_method: string
  x_px: number
  y_px: number
  width_px: number
  height_px: number
  width_in: number
  height_in: number
  preset_label: string | null
  sort_order: number
  curve_degrees: number | null // hat_back auto-curve arc (signed °): +=frown ∩, −=smile ∪; null → designer default (+45)
  curve_path?: CurvePathPts | null // Z-hp type-on-path: drawn {p0,peak,p2} in natural-px; supersedes curve_degrees
  mockup_natural_w?: number | null // natural px of the mockup this box was drawn on — for the drift check
  mockup_natural_h?: number | null // vs the mockup now shown (designer + customer see the managed mockup)
}

type ProductResp = { images?: { edges?: { node?: { url?: string } }[] } }

type Props = {
  templateId: string
  shopifyProductId: string
  supportedMethods: string[]
  methodLabel: (key: string) => string
  onMessage: (text: string, type?: 'success' | 'error') => void
}

// Fixed on-screen working width for the mockup. Print-area coordinates are
// stored in the mockup image's NATURAL pixel space (not this display space),
// so they're resolution-independent. The designer read layer (Phase 3) will
// convert these px -> percentages using the same mockup natural dimensions
// (see CLAUDE.md "pixels vs. percentages" note).
const DISPLAY_W = 520
// Print Zones Z1 — front/back plus the new zones. `side` is free text in the DB, so these are just more
// rows. Front/back can draw on the Shopify photo; the new zones draw on their uploaded mockup (Z0).
const SIDES = ['front', 'back', 'left_sleeve', 'right_sleeve', 'hat_back'] as const
const SHOPIFY_FALLBACK_SIDES = new Set<string>(['front', 'back']) // only these can fall back to a Shopify photo
const sideLabel = (s: string) => ZONE_LABELS[s] ?? s

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

// Type-on-path arc (Z-hp): two endpoints + the on-curve bulge the admin drags, in mockup natural-px.
type Pt2 = { x: number; y: number }
type CurvePathPts = { p0: Pt2; peak: Pt2; p2: Pt2 }
// Validate a jsonb curve_path into the shape (or null) — never trust raw DB json.
const asCurvePath = (v: unknown): CurvePathPts | null => {
  const o = v as { p0?: unknown; peak?: unknown; p2?: unknown } | null
  const ok = (p: unknown): p is Pt2 => !!p && typeof (p as Pt2).x === 'number' && typeof (p as Pt2).y === 'number'
  return o && ok(o.p0) && ok(o.peak) && ok(o.p2)
    ? { p0: { x: o.p0.x, y: o.p0.y }, peak: { x: o.peak.x, y: o.peak.y }, p2: { x: o.p2.x, y: o.p2.y } }
    : null
}
let keyCounter = 0
const nextKey = () => `new-${keyCounter++}`

// Anisotropy guard AT THE SOURCE: the physical inch-aspect must match the print-area PIXEL aspect,
// or the cut engine distorts text (glyphs scale vertically but position horizontally). Catch bad
// inches here, when they're typed, not later on an order. Returns the distortion % + the height (in)
// that WOULD match the box (keeping the entered width), or null when aligned.
const ANISO_TOL = 0.02
function aspectMismatch(a: { width_px: number; height_px: number; width_in: number; height_in: number }): { pct: number; fixHeightIn: number } | null {
  if (!(a.width_px > 0 && a.height_px > 0 && a.width_in > 0 && a.height_in > 0)) return null
  const ratio = (a.width_in / a.height_in) / (a.width_px / a.height_px)
  if (Math.abs(ratio - 1) <= ANISO_TOL) return null
  return { pct: Math.round(Math.abs(ratio - 1) * 100), fixHeightIn: Math.round((a.width_in * a.height_px / a.width_px) * 100) / 100 }
}

export default function PrintAreaEditor({
  templateId, shopifyProductId, supportedMethods, methodLabel, onMessage,
}: Props) {
  const [images, setImages] = useState<string[]>([])
  const [imgIdx, setImgIdx] = useState(0)
  const [imgError, setImgError] = useState<string | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  // Aspect of the Shopify product photo — the frame a LEGACY (null mockup_natural) front/back box was
  // drawn on, since that's all that existed before managed mockups. The designer anchors such a box to
  // this aspect (toPct's `|| natural.w` fallback), so the drift badge compares it against the managed
  // mockup now shown. Measured the same way the designer does (first Shopify image that loads).
  const [shopifyAspect, setShopifyAspect] = useState<number>(0)
  const [side, setSide] = useState<string>('front')
  // Z1 — one representative uploaded mockup per zone (the box is the same across colors, so any color's
  // mockup is a fine drawing reference). Front/back prefer their mockup over the Shopify photo (single source).
  const [zoneMockups, setZoneMockups] = useState<Record<string, { url: string; color: string }>>({})
  const [areas, setAreas] = useState<EditArea[]>([])
  const [deletedIds, setDeletedIds] = useState<string[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Refs the window pointer handlers read (avoids re-subscribing on every move).
  const naturalRef = useRef<{ w: number; h: number } | null>(null)
  const scaleRef = useRef(1)
  const drag = useRef<null | {
    key: string; mode: 'move' | 'resize' | 'arc-p0' | 'arc-peak' | 'arc-p2'
    startX: number; startY: number; ox: number; oy: number; ow: number; oh: number
    px?: number; py?: number // arc-point drag origin (natural-px)
  }>(null)

  const displayW = natural ? Math.min(DISPLAY_W, natural.w) : DISPLAY_W
  const scale = natural ? displayW / natural.w : 1
  // Keep the pointer-handler refs in sync with the latest natural size / scale.
  useEffect(() => { naturalRef.current = natural; scaleRef.current = scale }, [natural, scale])

  // The drawing background for the current zone: its uploaded mockup wins (single source); front/back
  // fall back to the Shopify photo until a mockup is uploaded. New zones have no Shopify fallback.
  const zoneMockup = zoneMockups[side] ?? null
  const bgSrc = zoneMockup?.url ?? (SHOPIFY_FALLBACK_SIDES.has(side) ? images[imgIdx] : undefined)
  // Switch the drawing background (zone or Shopify image) and drop the stale natural size so boxes don't
  // render at the previous image's scale until the new one's onLoad measures it.
  const switchSide = (s: string) => { setSide(s); setNatural(null); setSelectedKey(null) }
  const switchImg = (i: number) => { setImgIdx(i); setNatural(null) }

  // Load existing print areas for this template.
  useEffect(() => {
    supabase
      .from('product_template_print_areas')
      .select('*')
      .eq('template_id', templateId)
      .order('sort_order')
      .then(({ data }) => {
        if (data) setAreas(data.map((r: AreaRow) => ({ ...r, _key: r.id, curve_path: asCurvePath(r.curve_path) })))
      })
  }, [templateId])

  // Load one representative uploaded mockup per zone (the lowest sort_order per zone) as the drawing
  // reference for that zone. Z0's batch uploader populates product_template_mockups.
  useEffect(() => {
    supabase
      .from('product_template_mockups')
      .select('color_name, zone, image_url, sort_order')
      .eq('template_id', templateId)
      .order('sort_order')
      .then(({ data }) => {
        if (!data) return
        const map: Record<string, { url: string; color: string }> = {}
        for (const m of data as { color_name: string; zone: string; image_url: string }[]) {
          if (!map[m.zone]) map[m.zone] = { url: m.image_url, color: m.color_name } // first = the reference
        }
        setZoneMockups(map)
      })
  }, [templateId])

  // Load the Shopify product's mockup images (visual reference only — not stored).
  useEffect(() => {
    let active = true
    const numericId = shopifyProductId.split('/').pop() || ''
    if (!numericId) {
      const t = setTimeout(() => setImgError('No Shopify product ID on this template.'), 0)
      return () => clearTimeout(t)
    }
    fetch(`/api/product?id=${numericId}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`Product fetch failed (${r.status})`)))
      .then((p: ProductResp) => {
        if (!active) return
        const urls = (p.images?.edges ?? []).map(e => e.node?.url).filter((u): u is string => !!u)
        if (urls.length === 0) setImgError('This Shopify product has no images to use as a mockup.')
        setImages(urls)
      })
      .catch((e: Error) => { if (active) setImgError(e.message) })
    return () => { active = false }
  }, [shopifyProductId])

  // Measure the Shopify photo's aspect (first image that loads — matches the designer's mockupNaturalRef
  // derivation) so the drift badge can evaluate legacy null-framed rows.
  useEffect(() => {
    let active = true
    setShopifyAspect(0)
    ;(async () => {
      for (const url of images) {
        const dim = await new Promise<{ w: number; h: number } | null>(res => {
          const im = new window.Image()
          im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight })
          im.onerror = () => res(null)
          im.src = url
        })
        if (!active) return
        if (dim && dim.h > 0) { setShopifyAspect(dim.w / dim.h); break }
      }
    })()
    return () => { active = false }
  }, [images])

  // Window-level drag handlers (subscribed once).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current, nat = naturalRef.current, s = scaleRef.current
      if (!d || !nat) return
      const dxN = (e.clientX - d.startX) / s
      const dyN = (e.clientY - d.startY) / s
      // Type-on-path arc-point drag: move one of {p0,peak,p2} in natural-px, clamped to the mockup.
      if (d.mode === 'arc-p0' || d.mode === 'arc-peak' || d.mode === 'arc-p2') {
        const ptKey = d.mode.slice(4) as 'p0' | 'peak' | 'p2'
        setAreas(prev => prev.map(a => {
          if (a._key !== d.key || !a.curve_path) return a
          return { ...a, curve_path: { ...a.curve_path, [ptKey]: {
            x: clamp(Math.round((d.px ?? 0) + dxN), 0, nat.w),
            y: clamp(Math.round((d.py ?? 0) + dyN), 0, nat.h),
          } } }
        }))
        return
      }
      setAreas(prev => prev.map(a => {
        if (a._key !== d.key) return a
        if (d.mode === 'move') {
          return {
            ...a,
            x_px: clamp(Math.round(d.ox + dxN), 0, nat.w - a.width_px),
            y_px: clamp(Math.round(d.oy + dyN), 0, nat.h - a.height_px),
          }
        }
        return {
          ...a,
          width_px: clamp(Math.round(d.ow + dxN), 10, nat.w - a.x_px),
          height_px: clamp(Math.round(d.oh + dyN), 10, nat.h - a.y_px),
        }
      }))
    }
    const onUp = () => { drag.current = null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  const startDrag = (a: EditArea, mode: 'move' | 'resize', e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation()
    setSelectedKey(a._key)
    drag.current = { key: a._key, mode, startX: e.clientX, startY: e.clientY, ox: a.x_px, oy: a.y_px, ow: a.width_px, oh: a.height_px }
  }

  const startArcDrag = (key: string, pt: 'p0' | 'peak' | 'p2', e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation()
    setSelectedKey(key)
    const cp = areas.find(x => x._key === key)?.curve_path
    if (!cp) return
    drag.current = { key, mode: `arc-${pt}`, startX: e.clientX, startY: e.clientY, ox: 0, oy: 0, ow: 0, oh: 0, px: cp[pt].x, py: cp[pt].y }
  }

  const patch = (key: string, fields: Partial<EditArea>) =>
    setAreas(prev => prev.map(a => a._key === key ? { ...a, ...fields } : a))

  const addArea = () => {
    if (!natural) { onMessage('Wait for the mockup image to load first.', 'error'); return }
    const w = Math.round(natural.w * 0.4)
    const h = Math.round(natural.h * 0.4)
    const area: EditArea = {
      _key: nextKey(),
      name: sideLabel(side),
      side,
      print_method: supportedMethods[0] ?? '',
      x_px: Math.round((natural.w - w) / 2),
      y_px: Math.round((natural.h - h) / 2),
      width_px: w,
      height_px: h,
      width_in: 12,
      height_in: Math.round((12 * h / w) * 100) / 100,
      preset_label: null,
      sort_order: areas.length,
      curve_degrees: null,
      curve_path: null,
    }
    setAreas(prev => [...prev, area])
    setSelectedKey(area._key)
  }

  const removeArea = (a: EditArea) => {
    if (!confirm(`Delete print area "${a.name}"?`)) return
    if (a.id) setDeletedIds(prev => [...prev, a.id!])
    setAreas(prev => prev.filter(x => x._key !== a._key))
    if (selectedKey === a._key) setSelectedKey(null)
  }

  const save = async () => {
    // Client-side guards (the DB also enforces these via constraints/triggers).
    const names = new Set<string>()
    for (const a of areas) {
      if (!a.name.trim()) { onMessage('Every print area needs a name.', 'error'); return }
      if (names.has(a.name.trim().toLowerCase())) { onMessage(`Duplicate area name "${a.name}".`, 'error'); return }
      names.add(a.name.trim().toLowerCase())
      if (!a.print_method) { onMessage(`"${a.name}" needs a print method.`, 'error'); return }
      if (a.width_in <= 0 || a.height_in <= 0) { onMessage(`Set physical size (inches) for "${a.name}".`, 'error'); return }
    }
    setSaving(true)
    try {
      for (const id of deletedIds) {
        const { error } = await supabase.from('product_template_print_areas').delete().eq('id', id)
        if (error) throw new Error(error.message)
      }
      const saved: EditArea[] = []
      for (const a of areas) {
        const row = {
          template_id: templateId,
          name: a.name.trim(),
          side: a.side,
          print_method: a.print_method,
          x_px: a.x_px, y_px: a.y_px, width_px: a.width_px, height_px: a.height_px,
          width_in: a.width_in, height_in: a.height_in,
          preset_label: a.preset_label?.trim() || null,
          sort_order: a.sort_order,
          curve_degrees: a.curve_degrees ?? null,
          curve_path: a.curve_path ?? null, // Z-hp type-on-path arc (natural-px) — supersedes curve_degrees where set
          // Record the natural pixel size of the mockup these coordinates were drawn against, so the
          // designer re-projects the box against the SAME reference frame (px→% below) instead of
          // guessing from whichever product image loads first. All areas are shown over the currently-
          // selected mockup, so its natural size is the frame the admin just verified them in.
          mockup_natural_w: natural?.w ?? null,
          mockup_natural_h: natural?.h ?? null,
        }
        // Carry the just-saved reference frame onto the in-memory row so the drift banner clears
        // immediately after a re-draw (no reload needed).
        const savedFrame = { mockup_natural_w: natural?.w ?? null, mockup_natural_h: natural?.h ?? null }
        if (a.id) {
          const { error } = await supabase.from('product_template_print_areas').update(row).eq('id', a.id)
          if (error) throw new Error(error.message)
          saved.push({ ...a, ...savedFrame })
        } else {
          const { data, error } = await supabase.from('product_template_print_areas').insert(row).select().single()
          if (error) throw new Error(error.message)
          saved.push({ ...a, id: data.id, _key: data.id, ...savedFrame })
        }
      }
      setAreas(saved)
      setDeletedIds([])
      onMessage('Print areas saved!')
    } catch (e) {
      onMessage('Error saving areas: ' + (e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const selected = areas.find(a => a._key === selectedKey) ?? null
  // Drop a default frown arc across the selected box (endpoints low, bulge high → ∩ over the cap opening),
  // then the admin drags the three dots on the mockup to shape it.
  const addArc = () => {
    const a = selected
    if (!a) return
    patch(a._key, { curve_path: {
      p0:   { x: Math.round(a.x_px + a.width_px * 0.10), y: Math.round(a.y_px + a.height_px * 0.70) },
      peak: { x: Math.round(a.x_px + a.width_px * 0.50), y: Math.round(a.y_px + a.height_px * 0.15) },
      p2:   { x: Math.round(a.x_px + a.width_px * 0.90), y: Math.round(a.y_px + a.height_px * 0.70) },
    } })
  }
  const clearArc = () => { if (selected) patch(selected._key, { curve_path: null }) }
  const selectedArc = selected?.curve_path ?? null // captured const so TS narrows it inside the render callbacks
  // Quadratic control point (from the on-curve peak) for the live SVG preview.
  const selectedArcControl = selectedArc
    ? bezierControlFromPeak(selectedArc.p0, selectedArc.peak, selectedArc.p2)
    : null
  const visibleAreas = areas.filter(a => a.side === side)
  // Safety flag: a box in THIS zone was drawn on a differently-shaped image than the managed mockup now
  // shown (and rendered to customers), so its px→% projection uses the OLD frame and can drift. Only when a
  // managed mockup IS the drawing frame (natural = its size); re-drawing the box here re-stamps the frame.
  // A box's drawn-frame aspect = its stored mockup_natural, OR — for a LEGACY null-framed front/back row —
  // the Shopify photo aspect (what the designer anchors it to). So the badge now covers legacy rows too,
  // which are precisely the "drawn before managed mockups existed" ones; auto-imported mockups share the
  // Shopify aspect, so they still don't fire.
  const shownAspect = natural ? natural.w / natural.h : 0
  const drawnAspectOf = (a: EditArea): number =>
    a.mockup_natural_w && a.mockup_natural_h ? a.mockup_natural_w / a.mockup_natural_h
      : SHOPIFY_FALLBACK_SIDES.has(a.side) ? shopifyAspect
      : 0 // non-Shopify zone with no stored frame — can't determine; don't flag
  const boxFrameMismatch = !!zoneMockup && shownAspect > 0 && visibleAreas.some(a => {
    const drawn = drawnAspectOf(a)
    return drawn > 0 && Math.abs(drawn - shownAspect) / shownAspect > 0.02
  })
  const dpi = (px: number, inch: number) => (inch > 0 ? Math.round(px / inch) : 0)

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-sm font-mono uppercase tracking-widest text-[#dd3333]">Print areas</h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded border border-gray-300 overflow-hidden">
            {SIDES.map(s => (
              <button key={s} onClick={() => switchSide(s)}
                className={`px-2.5 py-1 text-xs font-mono whitespace-nowrap ${side === s ? 'bg-[#dd3333] text-white' : 'bg-white text-black hover:bg-gray-50'}`}>
                {sideLabel(s)}
              </button>
            ))}
          </div>
          <button onClick={addArea}
            className="px-3 py-1 rounded text-xs font-mono bg-white text-[#dd3333] border border-[#dd3333] hover:bg-red-50 whitespace-nowrap">
            + Add area ({sideLabel(side)})
          </button>
          <button onClick={save} disabled={saving}
            className="px-4 py-1.5 rounded text-xs font-mono bg-[#dd3333] text-white hover:bg-red-700 disabled:opacity-60">
            {saving ? 'Saving…' : 'Save print areas'}
          </button>
        </div>
      </div>

      <div className="flex gap-6 flex-wrap">
        {/* ---- Mockup with draggable rectangles ---- */}
        <div>
          {!zoneMockup && images.length > 1 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {images.map((url, i) => (
                <button key={url} onClick={() => switchImg(i)}
                  className={`w-10 h-10 rounded border overflow-hidden ${i === imgIdx ? 'border-[#dd3333] ring-1 ring-[#dd3333]' : 'border-gray-300'}`}>
                  <img src={url} alt={`mockup ${i + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}

          {bgSrc ? (
            <>
              {zoneMockup && (
                <p className="text-[10px] font-mono text-gray-400 mb-1">
                  Drawing on the <span className="text-gray-600">{zoneMockup.color}</span> mockup — the box applies to every color of this zone.
                </p>
              )}
              {boxFrameMismatch && (
                <div className="mb-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[11px] leading-snug text-red-700">
                  ⚠ A print box in this zone was drawn on a differently-shaped image. Re-draw it on this mockup (drag the box, then <span className="font-semibold">Save print areas</span>) so it lands where customers see it.
                </div>
              )}
              <div className="relative select-none touch-none" style={{ width: displayW }}>
              <img
                key={bgSrc}
                src={bgSrc}
                alt="mockup"
                draggable={false}
                onLoad={e => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                style={{ width: displayW, display: 'block' }}
                className="rounded border border-gray-200"
              />
              {natural && visibleAreas.map(a => {
                const isSel = a._key === selectedKey
                return (
                  <div
                    key={a._key}
                    onPointerDown={e => startDrag(a, 'move', e)}
                    style={{
                      position: 'absolute',
                      left: a.x_px * scale, top: a.y_px * scale,
                      width: a.width_px * scale, height: a.height_px * scale,
                      cursor: 'move',
                    }}
                    className={`border-2 ${isSel ? 'border-[#dd3333] bg-[#dd3333]/10' : 'border-blue-500 bg-blue-500/5'}`}
                  >
                    <span className="absolute -top-5 left-0 text-[10px] font-mono bg-white/90 px-1 rounded border border-gray-200 whitespace-nowrap">
                      {a.name}
                    </span>
                    <div
                      onPointerDown={e => startDrag(a, 'resize', e)}
                      title="Resize"
                      style={{ position: 'absolute', right: -6, bottom: -6, width: 12, height: 12, cursor: 'nwse-resize' }}
                      className={`rounded-sm border ${isSel ? 'bg-[#dd3333] border-white' : 'bg-blue-500 border-white'}`}
                    />
                  </div>
                )
              })}
              {/* Type-on-path (Z-hp): the selected area's drawn arc — preview curve + draggable ends/bulge */}
              {natural && selected && selectedArc && selectedArcControl && (
                <>
                  <svg width={displayW} height={natural.h * scale}
                    style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
                    <path
                      d={`M ${selectedArc.p0.x * scale} ${selectedArc.p0.y * scale} Q ${selectedArcControl.x * scale} ${selectedArcControl.y * scale} ${selectedArc.p2.x * scale} ${selectedArc.p2.y * scale}`}
                      fill="none" stroke="#dd3333" strokeWidth={2} strokeDasharray="6 4" />
                  </svg>
                  {(['p0', 'peak', 'p2'] as const).map(k => {
                    const pt = selectedArc[k]
                    const isPeak = k === 'peak'
                    return (
                      <div key={k}
                        onPointerDown={e => startArcDrag(selected._key, k, e)}
                        title={isPeak ? 'Bulge — drag up for a deeper frown ∩, down for a smile ∪' : 'Arc end — drag to move where the text starts/ends'}
                        style={{ position: 'absolute', left: pt.x * scale - 7, top: pt.y * scale - 7, width: 14, height: 14, cursor: 'grab', borderRadius: '50%', touchAction: 'none' }}
                        className={isPeak ? 'bg-amber-400 border-2 border-white shadow' : 'bg-[#dd3333] border-2 border-white shadow'} />
                    )
                  })}
                </>
              )}
            </div>
            </>
          ) : (
            <div className="w-[520px] max-w-full rounded border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
              <p className="text-xs font-mono text-gray-600">
                {SHOPIFY_FALLBACK_SIDES.has(side) ? (imgError ?? 'Loading mockup…') : `No ${sideLabel(side)} mockup yet`}
              </p>
              <p className="text-[10px] font-mono text-gray-400 mt-1">
                {SHOPIFY_FALLBACK_SIDES.has(side)
                  ? 'You can still enter coordinates numerically below.'
                  : 'Batch-upload a mockup for this zone on the Product Templates list, then reopen this editor.'}
              </p>
            </div>
          )}
          {natural && (
            <p className="text-[10px] font-mono text-gray-400 mt-1">
              Mockup {natural.w}×{natural.h}px · showing at {Math.round(scale * 100)}%. Coordinates saved in natural pixels.
            </p>
          )}
        </div>

        {/* ---- Area list + selected-area fields ---- */}
        <div className="flex-1 min-w-[16rem]">
          <div className="flex flex-col gap-1 mb-4">
            {visibleAreas.length === 0 && (
              <p className="text-gray-500 font-mono text-xs">No {side} areas yet. “+ Add area” drops one on the mockup.</p>
            )}
            {visibleAreas.map(a => (
              <button key={a._key} onClick={() => setSelectedKey(a._key)}
                className={`text-left px-3 py-2 rounded text-xs font-mono border ${
                  a._key === selectedKey ? 'border-[#dd3333] bg-red-50 text-black' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}>
                {a.name} · {methodLabel(a.print_method)} · {a.width_in}×{a.height_in}in
                {aspectMismatch(a) && <span className="text-amber-600" title="Inches don't match the box shape — text may distort"> ⚠</span>}
              </button>
            ))}
          </div>

          {selected && (
            <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-[10px] text-gray-600 font-mono uppercase">Name</label>
                  <input value={selected.name}
                    onChange={e => patch(selected._key, { name: e.target.value })}
                    className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-sm font-mono mt-1 outline-none focus:border-[#dd3333]" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-600 font-mono uppercase">Side</label>
                  <select value={selected.side}
                    onChange={e => patch(selected._key, { side: e.target.value })}
                    className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-sm font-mono mt-1 outline-none focus:border-[#dd3333]">
                    {SIDES.map(s => <option key={s} value={s}>{sideLabel(s)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-600 font-mono uppercase">Method</label>
                  <select value={selected.print_method}
                    onChange={e => patch(selected._key, { print_method: e.target.value })}
                    className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-sm font-mono mt-1 outline-none focus:border-[#dd3333]">
                    {supportedMethods.map(k => <option key={k} value={k}>{methodLabel(k)}</option>)}
                  </select>
                </div>

                {(['x_px', 'y_px', 'width_px', 'height_px'] as const).map(f => (
                  <div key={f}>
                    <label className="text-[10px] text-gray-600 font-mono uppercase">{f.replace('_', ' ')}</label>
                    <input type="number" value={selected[f]}
                      onChange={e => patch(selected._key, { [f]: Math.max(0, parseInt(e.target.value) || 0) })}
                      className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-sm font-mono mt-1 outline-none focus:border-[#dd3333]" />
                  </div>
                ))}

                {(['width_in', 'height_in'] as const).map(f => (
                  <div key={f}>
                    <label className="text-[10px] text-gray-600 font-mono uppercase">{f.replace('_', ' ')}</label>
                    <input type="number" step="0.05" value={selected[f]}
                      onChange={e => patch(selected._key, { [f]: Math.max(0, parseFloat(e.target.value) || 0) })}
                      className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-sm font-mono mt-1 outline-none focus:border-[#dd3333]" />
                  </div>
                ))}

                {(() => {
                  const m = aspectMismatch(selected)
                  return m ? (
                    <div className="col-span-2 flex items-center gap-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5">
                      <span className="text-[11px] leading-snug text-amber-800">
                        ⚠ These inches don’t match the box shape — text will stretch ~{m.pct}%. For this box, height should be ≈ <strong>{m.fixHeightIn} in</strong>.
                      </span>
                      <button type="button" onClick={() => patch(selected._key, { height_in: m.fixHeightIn })}
                        className="ml-auto shrink-0 rounded bg-amber-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-amber-700">
                        Match to box
                      </button>
                    </div>
                  ) : null
                })()}

                <div className="col-span-2">
                  <label className="text-[10px] text-gray-600 font-mono uppercase">Preset label (optional)</label>
                  <input value={selected.preset_label ?? ''}
                    onChange={e => patch(selected._key, { preset_label: e.target.value })}
                    placeholder="e.g. Men's Print Area 12x16"
                    className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-sm font-mono mt-1 outline-none focus:border-[#dd3333] placeholder-gray-400" />
                </div>

                {/* Type-on-path arc (Z-hp): DRAW the curve on the mockup — supersedes the degrees value below. */}
                {selected.side === 'hat_back' && (
                  <div className="col-span-2 rounded border border-gray-200 bg-gray-50 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-[10px] text-gray-600 font-mono uppercase">
                        Curve arc {selected.curve_path && <span className="text-[#dd3333]">· active</span>}
                      </label>
                      {selected.curve_path
                        ? <button type="button" onClick={clearArc} className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-mono text-red-600 hover:bg-red-50">Clear arc</button>
                        : <button type="button" onClick={addArc} className="rounded border border-[#dd3333] bg-white px-2 py-0.5 text-[11px] font-mono text-[#dd3333] hover:bg-red-50">+ Draw arc</button>}
                    </div>
                    <p className="text-[11px] text-gray-500 leading-snug mt-1">
                      {selected.curve_path
                        ? <>Drag the two <span className="text-[#dd3333] font-semibold">red ends</span> and the <span className="text-amber-600 font-semibold">amber bulge</span> on the mockup to shape the arc the text follows. This <strong>overrides</strong> the degrees value below.</>
                        : <>Draw the exact path the text follows on the mockup — best for real-photo caps. Drop a default frown, then drag its ends + bulge. (Overrides the degrees setting below.)</>}
                    </p>
                  </div>
                )}

                {/* Hat-Back Auto-Curve (Z-hat-1) — degrees FALLBACK when no arc is drawn. */}
                {selected.side === 'hat_back' && (
                  <div className="col-span-2 rounded border border-gray-200 bg-gray-50 p-2">
                    <label className="text-[10px] text-gray-600 font-mono uppercase">Hat-back curve (°) — fallback</label>
                    <div className="flex items-start gap-2 mt-1">
                      <input type="number" step={1} min={-360} max={360}
                        value={selected.curve_degrees ?? ''}
                        onChange={e => { const v = e.target.value; patch(selected._key, { curve_degrees: v === '' ? null : Math.max(-360, Math.min(360, parseInt(v) || 0)) }) }}
                        placeholder="45"
                        className="w-24 shrink-0 bg-white border border-gray-300 rounded px-2 py-1 text-sm font-mono outline-none focus:border-[#dd3333] placeholder-gray-400" />
                      <span className="text-[11px] text-gray-500 leading-snug">
                        How far the text arcs to follow the cap opening. <strong>Positive = frown ∩</strong> (over the opening), negative = smile ∪; a bigger number = a deeper curve (try 80–120 for a tight follow). Blank uses the default <strong>45</strong> (gentle frown). If a deep curve shrinks the text, increase this zone&apos;s <strong>height (in)</strong> to give the arc room.
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between mt-3">
                <span className="text-[10px] font-mono text-gray-500">
                  ≈ {dpi(selected.width_px, selected.width_in)}×{dpi(selected.height_px, selected.height_in)} px/in
                  {dpi(selected.width_px, selected.width_in) !== dpi(selected.height_px, selected.height_in) && (
                    <span className="text-amber-600"> · aspect mismatch</span>
                  )}
                </span>
                <button onClick={() => removeArea(selected)}
                  className="px-3 py-1 rounded text-xs font-mono bg-white text-red-600 border border-gray-300 hover:bg-red-50 hover:border-red-300">
                  Delete area
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
