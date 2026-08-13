'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ZONE_LABELS } from '../../lib/mockupFilename'
import type { Tables } from '@/types/database'

// Print Zones Z1.1 — per-template Mockups grid. Shows what exists per color × zone (the mockups the
// batch uploader / Z0 populates into product_template_mockups), makes missing combos obvious, and lets
// Denise upload / replace / delete a single mockup. Same conventions as TemplateColorsEditor (Shopify
// colors as rows, garment-swatches bucket, DB is source of truth + storage best-effort).

type MockupRow = Tables<'product_template_mockups'>
type ProductResp = { options?: { name: string; values: string[] }[] }

type Props = {
  templateId: string
  shopifyProductId: string
  onMessage: (text: string, type?: 'success' | 'error') => void
}

// Column order for the zones; unknown zones get appended after these.
const ZONE_ORDER = ['front', 'back', 'left_sleeve', 'right_sleeve', 'hat_back']
// Only front/back fall back to the Shopify product photo in the designer (see PrintAreaEditor's
// SHOPIFY_FALLBACK_SIDES) — so a MISSING mockup there is fine, whereas a missing sleeve/hat mockup is a
// real gap (the designer has no fallback for those).
const FALLBACK_ZONES = new Set(['front', 'back'])
const zoneLabel = (z: string) => ZONE_LABELS[z] ?? z
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

const sortZones = (zs: string[]) =>
  [...zs].sort((a, b) => {
    const ia = ZONE_ORDER.indexOf(a), ib = ZONE_ORDER.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b)
  })

// Reconstruct the storage object path from a public URL so delete/replace can target the exact file
// regardless of extension (png/jpg/webp).
const storagePathFromUrl = (url: string): string | null => {
  const marker = '/garment-swatches/'
  const i = url.indexOf(marker)
  return i < 0 ? null : url.slice(i + marker.length).split('?')[0]
}

const naturalSize = (file: File) =>
  new Promise<{ w: number; h: number }>((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url) }
    img.onerror = () => { resolve({ w: 0, h: 0 }); URL.revokeObjectURL(url) }
    img.src = url
  })

export default function TemplateMockupsEditor({ templateId, shopifyProductId, onMessage }: Props) {
  const [colors, setColors] = useState<string[]>([])
  // color -> zone -> row
  const [mockups, setMockups] = useState<Record<string, Record<string, MockupRow>>>({})
  const [areaZones, setAreaZones] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // `${color}::${zone}`

  useEffect(() => {
    let active = true
    ;(async () => {
      const numericId = shopifyProductId.split('/').pop() || ''
      let shopifyColors: string[] = []
      try {
        const res = await fetch(`/api/product?id=${numericId}`)
        if (res.ok) {
          const p: ProductResp = await res.json()
          shopifyColors = p.options?.find(o => o.name === 'Color')?.values ?? []
        }
      } catch { /* ignore — fall back to mockup color_names below */ }

      const [{ data: mk }, { data: areas }] = await Promise.all([
        supabase.from('product_template_mockups').select('*').eq('template_id', templateId).order('sort_order'),
        supabase.from('product_template_print_areas').select('side').eq('template_id', templateId),
      ])
      if (!active) return

      const map: Record<string, Record<string, MockupRow>> = {}
      ;(mk ?? []).forEach(r => { (map[r.color_name] ??= {})[r.zone] = r })

      // Rows = Shopify colors first (real order), then any mockup-only colors (e.g. a color pulled from
      // Shopify since a mockup was uploaded) so orphaned mockups stay visible + deletable.
      const extra = Object.keys(map).filter(c => !shopifyColors.includes(c))
      const colorNames = [...shopifyColors, ...extra]

      setColors(colorNames)
      setMockups(map)
      setAreaZones(Array.from(new Set((areas ?? []).map(a => a.side))))
      if (!colorNames.length) setNote('No colors found for this product yet (Shopify fetch returned none, and no mockups uploaded).')
      setLoading(false)
    })()
    return () => { active = false }
  }, [templateId, shopifyProductId])

  // Columns = every zone that's actually in play: has a print area OR has at least one uploaded mockup.
  // Recomputed from state so uploading into a fresh zone reveals its column live. Never empty.
  const zones = useMemo(() => {
    const set = new Set<string>(areaZones)
    Object.values(mockups).forEach(byZone => Object.keys(byZone).forEach(z => set.add(z)))
    const arr = sortZones([...set])
    return arr.length ? arr : ['front', 'back']
  }, [areaZones, mockups])

  const upload = async (color: string, zone: string, file: File) => {
    const key = `${color}::${zone}`
    setBusy(key)
    const prev = mockups[color]?.[zone] ?? null
    const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'png').toLowerCase()
    const path = `mockups/${templateId}/${slug(color)}_${zone}.${ext}`
    const { error: upErr } = await supabase.storage.from('garment-swatches').upload(path, file, { upsert: true, contentType: file.type || 'image/png' })
    if (upErr) { setBusy(null); onMessage(`Upload failed for ${color} · ${zoneLabel(zone)}: ${upErr.message}`, 'error'); return }
    const { data: pub } = supabase.storage.from('garment-swatches').getPublicUrl(path)
    const dims = await naturalSize(file)
    const { data, error: dbErr } = await supabase.from('product_template_mockups').upsert(
      {
        template_id: templateId,
        color_name: color,
        zone,
        image_url: `${pub.publicUrl}?v=${file.lastModified}`, // cache-bust the overwrite (file's own mtime)
        natural_w: dims.w || null,
        natural_h: dims.h || null,
      },
      { onConflict: 'template_id,color_name,zone' },
    ).select().single()
    if (dbErr || !data) { setBusy(null); onMessage(`Save failed for ${color} · ${zoneLabel(zone)}: ${dbErr?.message ?? 'unknown'}`, 'error'); return }

    // If a previous file lived at a different path (extension changed), sweep it so we don't orphan it.
    if (prev) {
      const oldPath = storagePathFromUrl(prev.image_url)
      if (oldPath && oldPath !== path) { try { await supabase.storage.from('garment-swatches').remove([oldPath]) } catch { /* best-effort */ } }
    }
    setMockups(m => ({ ...m, [color]: { ...(m[color] ?? {}), [zone]: data } }))
    setBusy(null)
    onMessage(`${prev ? 'Replaced' : 'Uploaded'} ${color} · ${zoneLabel(zone)}.`)
  }

  const remove = async (color: string, zone: string) => {
    const row = mockups[color]?.[zone]
    if (!row) return
    if (!confirm(`Delete the ${color} · ${zoneLabel(zone)} mockup? This can't be undone.`)) return
    const key = `${color}::${zone}`
    setBusy(key)
    // DB row is the source of truth — delete it first; only then drop the storage file (best-effort).
    const { error } = await supabase.from('product_template_mockups').delete().eq('id', row.id)
    if (error) { setBusy(null); onMessage(`Delete failed for ${color} · ${zoneLabel(zone)}: ${error.message}`, 'error'); return }
    const oldPath = storagePathFromUrl(row.image_url)
    if (oldPath) { try { await supabase.storage.from('garment-swatches').remove([oldPath]) } catch { /* best-effort */ } }
    setMockups(m => {
      const byZone = { ...(m[color] ?? {}) }
      delete byZone[zone]
      return { ...m, [color]: byZone }
    })
    setBusy(null)
    onMessage(`Deleted ${color} · ${zoneLabel(zone)}.`)
  }

  const haveCount = Object.values(mockups).reduce((n, byZone) => n + Object.keys(byZone).length, 0)
  // Missing combos that MATTER (a zone with no Shopify fallback) — the headline number for gaps.
  const missingReal = colors.reduce(
    (n, c) => n + zones.filter(z => !FALLBACK_ZONES.has(z) && !mockups[c]?.[z]).length, 0,
  )

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mt-6">
      <div className="flex items-baseline justify-between mb-1 gap-3 flex-wrap">
        <h2 className="text-sm font-mono uppercase tracking-widest text-[#dd3333]">Mockups</h2>
        <span className="text-[11px] font-mono text-gray-400">
          {haveCount} uploaded{missingReal > 0 && <span className="text-[#dd3333]"> · {missingReal} missing</span>}
        </span>
      </div>
      <p className="text-xs text-gray-500 font-mono mb-4">
        What exists per color × zone. Click any tile to upload or replace; ✕ deletes.
        Sleeve/hat zones with no mockup show <span className="text-[#dd3333]">⚠</span> (the designer has no fallback there);
        Front/Back fall back to the Shopify photo, so a gap there is fine. Bulk-add on the templates list.
      </p>

      {loading ? (
        <p className="text-gray-600 font-mono text-center py-8">Loading…</p>
      ) : note ? (
        <p className="text-gray-500 font-mono text-xs py-4">{note}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-separate" style={{ borderSpacing: '0.5rem' }}>
            <thead>
              <tr>
                <th className="text-left text-[10px] font-mono uppercase text-gray-500 align-bottom pb-1">Color</th>
                {zones.map(z => (
                  <th key={z} className="text-center text-[10px] font-mono uppercase text-gray-500 align-bottom pb-1 whitespace-nowrap">
                    {zoneLabel(z)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {colors.map(color => (
                <tr key={color}>
                  <td className="text-sm font-mono text-black align-middle pr-2 whitespace-nowrap max-w-[10rem] truncate" title={color}>
                    {color}
                  </td>
                  {zones.map(zone => {
                    const row = mockups[color]?.[zone]
                    const key = `${color}::${zone}`
                    const isBusy = busy === key
                    const softMissing = FALLBACK_ZONES.has(zone)
                    return (
                      <td key={zone} className="align-middle">
                        {row ? (
                          <div className="relative w-16 h-16">
                            <label title="Click to replace" className={`block w-full h-full cursor-pointer ${isBusy ? 'opacity-50 pointer-events-none' : ''}`}>
                              <img src={row.image_url} alt={`${color} ${zoneLabel(zone)}`}
                                className="w-full h-full object-cover rounded border border-gray-300 hover:border-[#dd3333]" />
                              <input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" className="hidden"
                                onChange={e => { const f = e.target.files?.[0]; if (f) upload(color, zone, f); e.target.value = '' }} />
                            </label>
                            <button onClick={() => remove(color, zone)} disabled={isBusy} title="Delete this mockup"
                              className="absolute -top-2 -right-2 w-5 h-5 flex items-center justify-center rounded-full bg-white border border-gray-300 text-red-600 text-xs leading-none hover:bg-red-50 hover:border-red-300 shadow-sm disabled:opacity-50">
                              ✕
                            </button>
                            {isBusy && <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-gray-600">…</span>}
                          </div>
                        ) : (
                          <label title={softMissing ? 'No mockup — the designer uses the Shopify photo here. Click to upload one anyway.' : 'Missing — click to upload this zone’s mockup'}
                            className={`flex flex-col items-center justify-center w-16 h-16 rounded border-2 border-dashed cursor-pointer transition-colors ${
                              isBusy ? 'opacity-50 pointer-events-none border-gray-300' :
                              softMissing
                                ? 'border-gray-200 bg-gray-50 text-gray-400 hover:border-[#dd3333]'
                                : 'border-red-300 bg-red-50 text-[#dd3333] hover:border-[#dd3333]'
                            }`}>
                            <span className="text-sm leading-none">{isBusy ? '…' : softMissing ? '—' : '⚠'}</span>
                            <span className="text-[9px] font-mono mt-0.5">{isBusy ? '' : softMissing ? 'Shopify' : 'missing'}</span>
                            <input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" className="hidden"
                              onChange={e => { const f = e.target.files?.[0]; if (f) upload(color, zone, f); e.target.value = '' }} />
                          </label>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
