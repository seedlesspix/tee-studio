'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { buildColorImageMap, getColorImages } from '../../lib/productImages'
import type { Tables } from '@/types/database'

type ColorRow = Tables<'product_template_colors'>
type ProductResp = {
  options?: { name: string; values: string[] }[]
  images?: { edges: { node: { url: string } }[] }
}

type Props = {
  templateId: string
  shopifyProductId: string
  onMessage: (text: string, type?: 'success' | 'error') => void
}

const HEX_RE = /^#[0-9a-f]{6}$/
function normalizeHex(input: string): string | null {
  let v = input.trim().toLowerCase()
  if (!v) return null
  if (!v.startsWith('#')) v = '#' + v
  if (/^#[0-9a-f]{3}$/.test(v)) v = '#' + v.slice(1).split('').map(c => c + c).join('')
  return HEX_RE.test(v) ? v : null
}
// Object-path slug — collision-proof with the {template_id}/ prefix.
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

// One row per Shopify color of the template's product.
type Row = {
  color_name: string
  id: string | null
  hex: string
  swatch_image_url: string | null
  autofilled: boolean
}
type SavedState = Record<string, { id: string; hex: string; swatch_image_url: string | null }>

export default function TemplateColorsEditor({ templateId, shopifyProductId, onMessage }: Props) {
  const [rows, setRows] = useState<Row[]>([])
  const [saved, setSaved] = useState<SavedState>({})
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState<string | null>(null)
  const [savingRow, setSavingRow] = useState<string | null>(null)
  const [savingAll, setSavingAll] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  // Colors whose name matched no product mockup — the designer falls back to the
  // featured image for these, so flag them here (same spirit as "⚠ 0 areas").
  const [noImg, setNoImg] = useState<Set<string>>(new Set())

  useEffect(() => {
    let active = true
    ;(async () => {
      const numericId = shopifyProductId.split('/').pop() || ''
      let shopifyColors: string[] = []
      let imgMap: ReturnType<typeof buildColorImageMap> = {}
      try {
        const res = await fetch(`/api/product?id=${numericId}`)
        if (res.ok) {
          const p: ProductResp = await res.json()
          shopifyColors = p.options?.find(o => o.name === 'Color')?.values ?? []
          const images = (p.images?.edges ?? []).map(e => ({ url: e.node.url }))
          imgMap = buildColorImageMap(images, shopifyColors)
        }
      } catch { /* ignore — fall back to existing assignments below */ }

      const [{ data: existing }, { data: all }] = await Promise.all([
        supabase.from('product_template_colors').select('*').eq('template_id', templateId),
        // Autofill source: every assignment across templates, newest first.
        supabase.from('product_template_colors').select('color_name, hex, created_at').order('created_at', { ascending: false }),
      ])
      if (!active) return

      const existingMap: Record<string, ColorRow> = {}
      ;(existing ?? []).forEach(r => { existingMap[r.color_name] = r })
      const autofillMap: Record<string, string> = {}
      ;(all ?? []).forEach(r => { if (!(r.color_name in autofillMap) && r.hex) autofillMap[r.color_name] = r.hex })
      const savedState: SavedState = {}
      ;(existing ?? []).forEach(r => { savedState[r.color_name] = { id: r.id, hex: r.hex, swatch_image_url: r.swatch_image_url } })

      // Prefer the product's real Shopify colors; fall back to any already-saved
      // names if the product fetch failed.
      const colorNames = shopifyColors.length ? shopifyColors : Object.keys(existingMap)
      const built: Row[] = colorNames.map(name => {
        const ex = existingMap[name]
        if (ex) return { color_name: name, id: ex.id, hex: ex.hex, swatch_image_url: ex.swatch_image_url, autofilled: false }
        const af = autofillMap[name]
        return { color_name: name, id: null, hex: af ?? '', swatch_image_url: null, autofilled: !!af }
      })
      setRows(built)
      setSaved(savedState)
      // Only flag when we actually resolved the product's images — a failed fetch
      // would otherwise mark every color as unmatched.
      setNoImg(shopifyColors.length
        ? new Set(colorNames.filter(name => !getColorImages(name, imgMap)))
        : new Set<string>())
      if (!colorNames.length) setNote('No colors found for this product (Shopify fetch returned none).')
      setLoading(false)
    })()
    return () => { active = false }
  }, [templateId, shopifyProductId])

  const setRow = (name: string, patch: Partial<Row>) =>
    setRows(prev => prev.map(r => r.color_name === name ? { ...r, ...patch } : r))

  const rowDirty = (r: Row): boolean => {
    const s = saved[r.color_name]
    const nh = normalizeHex(r.hex) ?? r.hex
    const swatch = r.swatch_image_url ?? null
    // A swatch upload is a change too — the unsaved branch previously checked
    // hex only, so uploading a swatch never enabled Save for an unsaved color.
    if (!s) return !!r.hex.trim() || swatch !== null
    return nh !== s.hex || swatch !== (s.swatch_image_url ?? null)
  }

  // Persists one row; returns true on success. Shared by row Save and Save all.
  const persist = async (r: Row): Promise<boolean> => {
    const hex = normalizeHex(r.hex)
    if (!hex) { onMessage(`"${r.color_name}": enter a valid hex (e.g. #1a2b3c).`, 'error'); return false }
    const prevSwatch = saved[r.color_name]?.swatch_image_url ?? null
    const payload = { template_id: templateId, color_name: r.color_name, hex, swatch_image_url: r.swatch_image_url }
    if (r.id) {
      const { error } = await supabase.from('product_template_colors').update(payload).eq('id', r.id)
      if (error) { onMessage(`Error saving "${r.color_name}": ${error.message}`, 'error'); return false }
      setSaved(prev => ({ ...prev, [r.color_name]: { id: r.id!, hex, swatch_image_url: r.swatch_image_url } }))
      setRow(r.color_name, { hex, autofilled: false })
    } else {
      const { data, error } = await supabase.from('product_template_colors').insert(payload).select().single()
      if (error) { onMessage(`Error saving "${r.color_name}": ${error.message}`, 'error'); return false }
      setSaved(prev => ({ ...prev, [r.color_name]: { id: data.id, hex, swatch_image_url: r.swatch_image_url } }))
      setRow(r.color_name, { id: data.id, hex, autofilled: false })
    }
    // The swatch image was cleared (saved had one, now null) — delete the storage file now that the DB
    // no longer points at it, so DB + storage drop together. Deferred here (NOT in handleRemoveImage)
    // so removing then navigating away WITHOUT Save leaves both intact. Deterministic path → no id book-
    // keeping; best-effort (a leftover file is harmless and swept by later storage cleanup).
    if (prevSwatch && !r.swatch_image_url) {
      const path = `${templateId}/${slug(r.color_name)}.png`
      try { await supabase.storage.from('garment-swatches').remove([path]) } catch { /* best-effort */ }
    }
    return true
  }

  const handleSaveRow = async (r: Row) => {
    setSavingRow(r.color_name)
    const ok = await persist(r)
    setSavingRow(null)
    if (ok) onMessage('Saved!')
  }

  const handleSaveAll = async () => {
    const dirty = rows.filter(rowDirty)
    if (!dirty.length) { onMessage('No changes to save.'); return }
    setSavingAll(true)
    let ok = 0
    for (const r of dirty) if (await persist(r)) ok++
    setSavingAll(false)
    onMessage(ok === dirty.length ? `Saved all ${ok} colors!` : `Saved ${ok} of ${dirty.length} — check the errors.`, ok === dirty.length ? 'success' : 'error')
  }

  const handleUpload = async (r: Row, file: File) => {
    setUploading(r.color_name)
    const path = `${templateId}/${slug(r.color_name)}.png`
    const { error } = await supabase.storage.from('garment-swatches').upload(path, file, { upsert: true, contentType: 'image/png' })
    if (error) { setUploading(null); onMessage(`Upload failed for "${r.color_name}": ${error.message}`, 'error'); return }
    const { data } = supabase.storage.from('garment-swatches').getPublicUrl(path)
    setRow(r.color_name, { swatch_image_url: `${data.publicUrl}?v=${Date.now()}` }) // cache-bust the overwrite
    setUploading(null)
    onMessage('Image uploaded — click Save (or Save all) to keep it.')
  }

  const handleRemoveImage = (r: Row) => {
    // Clear locally ONLY — the storage file is deleted in persist() on Save. This means navigating
    // away without saving keeps the image (no dangling DB→storage reference); it drops only when the
    // null is actually saved.
    setRow(r.color_name, { swatch_image_url: null })
    onMessage('Image removed — click Save to keep the change.')
  }

  const dirtyCount = rows.filter(rowDirty).length

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mt-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-mono uppercase tracking-widest text-[#dd3333]">Colors</h2>
        <button onClick={handleSaveAll} disabled={savingAll || dirtyCount === 0}
          className={`px-4 py-1.5 rounded text-xs font-mono transition-all ${
            dirtyCount > 0 ? 'bg-[#dd3333] text-white hover:bg-red-700' : 'bg-gray-100 text-gray-400 cursor-default'
          }`}>
          {savingAll ? 'Saving…' : `Save all${dirtyCount ? ` (${dirtyCount})` : ''}`}
        </button>
      </div>
      <p className="text-xs text-gray-500 font-mono mb-4">
        Auto-loaded from the product’s Shopify colors. Hex is required (print + fallback swatch);
        the swatch image is optional (for heathered / two-tone garments).
      </p>

      {loading ? (
        <p className="text-gray-600 font-mono text-center py-8">Loading…</p>
      ) : note ? (
        <p className="text-gray-500 font-mono text-xs py-4">{note}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map(r => {
            const pickerHex = normalizeHex(r.hex) ?? '#000000'
            const dirty = rowDirty(r)
            return (
              <div key={r.color_name} className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg p-2.5">
                {/* Live preview: swatch image if present, else the hex square */}
                <div className="w-10 h-10 rounded border border-gray-300 overflow-hidden shrink-0 bg-gray-100">
                  {r.swatch_image_url
                    ? <img src={r.swatch_image_url} alt={r.color_name} className="w-full h-full object-cover" />
                    : <div className="w-full h-full" style={{ background: normalizeHex(r.hex) ?? '#e5e7eb' }} />}
                </div>

                <span className="w-32 shrink-0 text-sm font-mono text-black truncate" title={r.color_name}>{r.color_name}</span>

                <input type="color" value={pickerHex} title="Pick color"
                  onChange={e => setRow(r.color_name, { hex: e.target.value, autofilled: false })}
                  className="w-9 h-9 rounded border border-gray-300 bg-white cursor-pointer shrink-0" />
                <input value={r.hex}
                  onChange={e => setRow(r.color_name, { hex: e.target.value, autofilled: false })}
                  placeholder="#1a2b3c"
                  className="w-24 bg-white border border-gray-300 rounded px-2 py-1 text-sm text-black outline-none focus:border-[#dd3333] font-mono placeholder-gray-400" />

                {r.autofilled && (
                  <span className="text-[10px] font-mono text-amber-600 whitespace-nowrap" title="Prefilled from another template — save to confirm">• autofilled</span>
                )}
                {noImg.has(r.color_name) && (
                  <span className="text-[10px] font-mono text-[#dd3333] whitespace-nowrap"
                    title="No product mockup filename matched this color — the designer shows the product's featured image instead. Check the image filenames in Shopify.">⚠ no image matched</span>
                )}

                <div className="ml-auto flex items-center gap-2 shrink-0">
                  {r.swatch_image_url ? (
                    <div className="flex items-center gap-1">
                      <img src={r.swatch_image_url} alt="" className="w-8 h-8 rounded border border-gray-200 object-cover" />
                      <button onClick={() => handleRemoveImage(r)} title="Remove image"
                        className="px-2 py-1 rounded text-[10px] font-mono bg-white text-red-600 border border-gray-300 hover:bg-red-50 hover:border-red-300">✕</button>
                    </div>
                  ) : (
                    <label className="px-2.5 py-1.5 rounded text-[11px] font-mono bg-white text-gray-800 border border-gray-300 hover:border-[#dd3333] cursor-pointer whitespace-nowrap">
                      {uploading === r.color_name ? 'Uploading…' : 'Upload swatch'}
                      <input type="file" accept="image/png" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(r, f); e.target.value = '' }} />
                    </label>
                  )}
                  <button onClick={() => handleSaveRow(r)} disabled={savingRow === r.color_name || !dirty}
                    className={`px-3 py-1.5 rounded text-xs font-mono transition-all ${
                      dirty ? 'bg-[#dd3333] text-white hover:bg-red-700' : 'bg-gray-100 text-gray-400 cursor-default'
                    }`}>
                    {savingRow === r.color_name ? '…' : dirty ? 'Save' : 'Saved ✓'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
