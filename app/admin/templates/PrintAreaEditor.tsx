'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Tables } from '@/types/database'
import { ZONE_LABELS } from '../../lib/mockupFilename'

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
  curve_degrees: number | null // hat_back auto-curve arc (signed °): −=frown, +=smile; null → designer default (−45)
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
    key: string; mode: 'move' | 'resize'
    startX: number; startY: number; ox: number; oy: number; ow: number; oh: number
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
        if (data) setAreas(data.map((r: AreaRow) => ({ ...r, _key: r.id })))
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

  // Window-level drag handlers (subscribed once).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current, nat = naturalRef.current, s = scaleRef.current
      if (!d || !nat) return
      const dxN = (e.clientX - d.startX) / s
      const dyN = (e.clientY - d.startY) / s
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
          // Record the natural pixel size of the mockup these coordinates were drawn against, so the
          // designer re-projects the box against the SAME reference frame (px→% below) instead of
          // guessing from whichever product image loads first. All areas are shown over the currently-
          // selected mockup, so its natural size is the frame the admin just verified them in.
          mockup_natural_w: natural?.w ?? null,
          mockup_natural_h: natural?.h ?? null,
        }
        if (a.id) {
          const { error } = await supabase.from('product_template_print_areas').update(row).eq('id', a.id)
          if (error) throw new Error(error.message)
          saved.push(a)
        } else {
          const { data, error } = await supabase.from('product_template_print_areas').insert(row).select().single()
          if (error) throw new Error(error.message)
          saved.push({ ...a, id: data.id, _key: data.id })
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
  const visibleAreas = areas.filter(a => a.side === side)
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

                {/* Hat-Back Auto-Curve (Z-hat-1): only hat_back zones curve their text. */}
                {selected.side === 'hat_back' && (
                  <div className="col-span-2 rounded border border-gray-200 bg-gray-50 p-2">
                    <label className="text-[10px] text-gray-600 font-mono uppercase">Hat-back curve (°)</label>
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
