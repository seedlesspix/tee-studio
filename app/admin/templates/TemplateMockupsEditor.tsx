'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ZONE_LABELS, normalizeColorKey } from '../../lib/mockupFilename'
import { buildColorImageMap, getColorImages } from '../../lib/productImages'
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

const naturalSizeFromSrc = (src: string) =>
  new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve({ w: 0, h: 0 })
    img.src = src
  })

const naturalSize = (file: File) =>
  new Promise<{ w: number; h: number }>((resolve) => {
    const url = URL.createObjectURL(file)
    naturalSizeFromSrc(url).then(d => { resolve(d); URL.revokeObjectURL(url) })
  })

const extFromMime = (mime: string) => (mime.split('/')[1] || 'png').toLowerCase().replace('jpeg', 'jpg').replace('+xml', '')

type ProductImagesResp = ProductResp & { images?: { edges: { node: { url: string } }[] } }

export default function TemplateMockupsEditor({ templateId, shopifyProductId, onMessage }: Props) {
  const [colors, setColors] = useState<string[]>([])
  // color -> zone -> row
  const [mockups, setMockups] = useState<Record<string, Record<string, MockupRow>>>({})
  const [areaZones, setAreaZones] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // `${color}::${zone}`
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null)
  // Mockup-only colors: rows whose color is no longer on the Shopify product (orphaned mockups). Badged
  // "⚠ not in Shopify" so discontinued colors can't quietly linger — delete the cells to clean up.
  const [staleColors, setStaleColors] = useState<Set<string>>(new Set())

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

      // Key the grid by the product's REAL color name. Resolve each stored mockup's color_name to its
      // Shopify color by normalized key, so a mockup saved "ColumbiaBlue" lines up under the "Columbia
      // Blue" row (legacy/differently-spelled rows; the uploader now stores canonical going forward).
      const shopifyByKey = new Map(shopifyColors.map(c => [normalizeColorKey(c), c]))
      const map: Record<string, Record<string, MockupRow>> = {}
      ;(mk ?? []).forEach(r => {
        const displayColor = shopifyByKey.get(normalizeColorKey(r.color_name)) ?? r.color_name
        ;(map[displayColor] ??= {})[r.zone] = r
      })

      // Rows = Shopify colors first (real order), then any mockup-only colors (a color no longer in the
      // Shopify list) so orphaned mockups stay visible + deletable.
      const extra = Object.keys(map).filter(c => !shopifyColors.includes(c))
      const colorNames = [...shopifyColors, ...extra]

      setColors(colorNames)
      // Only flag stale when the Shopify fetch actually returned colors — an empty list means the fetch
      // failed (or is mid-flight), and flagging every mockup as "not in Shopify" would be a false alarm.
      setStaleColors(new Set(shopifyColors.length ? extra : []))
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
    // Replace targets the existing row's own color_name (updates in place — no dup if that legacy row was
    // stored under a different spelling); a brand-new cell stores the canonical display color.
    const storeColor = prev?.color_name ?? color
    const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'png').toLowerCase()
    const path = `mockups/${templateId}/${slug(storeColor)}_${zone}.${ext}`
    const { error: upErr } = await supabase.storage.from('garment-swatches').upload(path, file, { upsert: true, contentType: file.type || 'image/png' })
    if (upErr) { setBusy(null); onMessage(`Upload failed for ${color} · ${zoneLabel(zone)}: ${upErr.message}`, 'error'); return }
    const { data: pub } = supabase.storage.from('garment-swatches').getPublicUrl(path)
    const dims = await naturalSize(file)
    const { data, error: dbErr } = await supabase.from('product_template_mockups').upsert(
      {
        template_id: templateId,
        color_name: storeColor,
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

  // Auto-import the product's Shopify Front/Back photos into managed mockups (single source of truth, per
  // the Print-Zones architecture). Re-hosts the actual Shopify image into the mockups bucket via the
  // /api/preview proxy (server-side fetch → base64), so the mockup no longer depends on Shopify. FILLS
  // GAPS ONLY — never clobbers a mockup Denise uploaded/replaced by hand. Only front/back (the only zones
  // Shopify has photos for). Same front/back filename matcher the designer uses, minus cross-fill so a
  // real front lands as front and a real back as back.
  const importFromShopify = async () => {
    if (importing) return
    const numericId = shopifyProductId.split('/').pop() || ''
    setImporting({ done: 0, total: 0 })
    let p: ProductImagesResp | null = null
    try {
      const res = await fetch(`/api/product?id=${numericId}`)
      if (res.ok) p = await res.json()
    } catch { /* handled below */ }
    if (!p) { setImporting(null); onMessage('Could not load the Shopify product to import from.', 'error'); return }

    const shopifyColors = p.options?.find(o => o.name === 'Color')?.values ?? []
    const imgs = (p.images?.edges ?? []).map(e => ({ url: e.node.url }))
    const rawMap = buildColorImageMap(imgs, shopifyColors, { crossFill: false })

    // Gaps to fill: (color, front|back) that has a Shopify image and no managed mockup yet.
    const jobs: { color: string; zone: 'front' | 'back'; url: string }[] = []
    for (const color of shopifyColors) {
      const fb = getColorImages(color, rawMap)
      if (!fb) continue
      ;(['front', 'back'] as const).forEach(zone => {
        if (fb[zone] && !mockups[color]?.[zone]) jobs.push({ color, zone, url: fb[zone] })
      })
    }
    if (!jobs.length) {
      setImporting(null)
      onMessage('Nothing to import — Front/Back are already covered (or no matching Shopify photos).')
      return
    }

    let ok = 0
    for (let i = 0; i < jobs.length; i++) {
      setImporting({ done: i, total: jobs.length })
      const { color, zone, url } = jobs[i]
      try {
        const proxied = await fetch(`/api/preview?shirt=${encodeURIComponent(url)}`)
        if (!proxied.ok) continue
        const { shirt } = await proxied.json() as { shirt?: string }
        if (!shirt) continue
        const blob = await (await fetch(shirt)).blob()
        const mime = shirt.match(/^data:([^;]+)/)?.[1] || 'image/png'
        const ext = extFromMime(mime) || 'png'
        const dims = await naturalSizeFromSrc(shirt)
        const path = `mockups/${templateId}/${slug(color)}_${zone}.${ext}`
        const { error: upErr } = await supabase.storage.from('garment-swatches').upload(path, blob, { upsert: true, contentType: mime })
        if (upErr) continue
        const { data: pub } = supabase.storage.from('garment-swatches').getPublicUrl(path)
        const { data, error } = await supabase.from('product_template_mockups').upsert(
          {
            template_id: templateId,
            color_name: color,
            zone,
            image_url: `${pub.publicUrl}?v=${blob.size}`, // deterministic cache-bust (bytes differ → url differs)
            natural_w: dims.w || null,
            natural_h: dims.h || null,
          },
          { onConflict: 'template_id,color_name,zone' },
        ).select().single()
        if (error || !data) continue
        setMockups(m => ({ ...m, [color]: { ...(m[color] ?? {}), [zone]: data } }))
        ok++
      } catch { /* skip this one, keep going */ }
    }
    setImporting(null)
    onMessage(
      ok === jobs.length ? `Imported ${ok} Front/Back mockup${ok === 1 ? '' : 's'} from Shopify.`
        : `Imported ${ok} of ${jobs.length} — some Shopify photos couldn’t be fetched.`,
      ok === jobs.length ? 'success' : 'error',
    )
  }

  const haveCount = Object.values(mockups).reduce((n, byZone) => n + Object.keys(byZone).length, 0)
  // Missing combos that MATTER (a zone with no Shopify fallback) — the headline number for gaps.
  const missingReal = colors.reduce(
    (n, c) => n + zones.filter(z => !FALLBACK_ZONES.has(z) && !mockups[c]?.[z]).length, 0,
  )

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mt-6">
      <div className="flex items-center justify-between mb-1 gap-3 flex-wrap">
        <h2 className="text-sm font-mono uppercase tracking-widest text-[#dd3333]">Mockups</h2>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-mono text-gray-400">
            {haveCount} uploaded{missingReal > 0 && <span className="text-[#dd3333]"> · {missingReal} missing</span>}
          </span>
          <button onClick={importFromShopify} disabled={!!importing || loading}
            title="Pull this product’s Shopify Front &amp; Back photos in as managed mockups. Fills empty Front/Back only — your uploads are kept."
            className={`px-3 py-1.5 rounded text-xs font-mono border transition-all whitespace-nowrap ${
              importing ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-wait' : 'bg-white text-gray-800 border-gray-300 hover:border-[#dd3333]'
            }`}>
            {importing ? (importing.total ? `Importing ${importing.done + 1}/${importing.total}…` : 'Importing…') : 'Import Front/Back from Shopify'}
          </button>
        </div>
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
                  <td className="text-sm font-mono text-black align-middle pr-2 whitespace-nowrap max-w-[12rem] truncate" title={staleColors.has(color) ? `${color} — no longer on the Shopify product; delete these mockups to clean up` : color}>
                    {color}
                    {staleColors.has(color) && (
                      <span className="ml-1.5 text-[10px] font-mono text-[#dd3333] align-middle">⚠ not in Shopify</span>
                    )}
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
