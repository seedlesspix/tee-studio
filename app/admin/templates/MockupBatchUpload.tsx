'use client'
import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { parseMockupFilename, normalizeColorKey, ZONE_LABELS } from '../../lib/mockupFilename'

// Print Zones Z0 — global mockup batch uploader. Drop every mockup at once, named
// `stylenumber_color_position` (e.g. 2001_White_LeftSleeve.png); each file auto-routes to its template
// (matched by product_templates.style_number), color, and zone, uploads to storage, and upserts one row
// per template × color × zone. Client-side (admin-authed browser client, same as the swatch uploader).

type TemplateLite = { id: string; name: string; style_number: string | null }
type Result = { name: string; ok: boolean; detail: string }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const naturalSize = (file: File) =>
  new Promise<{ w: number; h: number }>((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url) }
    img.onerror = () => { resolve({ w: 0, h: 0 }); URL.revokeObjectURL(url) }
    img.src = url
  })

export default function MockupBatchUpload({
  templates,
  onMessage,
  onDone,
}: {
  templates: TemplateLite[]
  onMessage: (m: string, kind: 'success' | 'error') => void
  onDone?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [results, setResults] = useState<Result[]>([])

  // style number (case/space-insensitive) → template
  const byStyle = useMemo(() => {
    const m = new Map<string, TemplateLite>()
    templates.forEach((t) => { if (t.style_number) m.set(t.style_number.trim().toLowerCase(), t) })
    return m
  }, [templates])

  const withStyle = templates.filter((t) => t.style_number).length

  const handleFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(f.name))
    if (!files.length) return
    setBusy(true)
    setResults([])

    // Canonicalize each filename's color to the product's REAL color name (from product_template_colors),
    // so "ColumbiaBlue", "Columbia_Blue", and "columbia blue" all resolve to one canonical name → one row,
    // one storage path (no spelling-driven duplicates). Falls back to the parsed color verbatim when the
    // product has no saved colors yet (the grid still lines it up by normalized key).
    const { data: colorRows } = await supabase.from('product_template_colors').select('template_id, color_name')
    const canonicalByTemplate = new Map<string, Map<string, string>>()
    ;(colorRows ?? []).forEach((r) => {
      let m = canonicalByTemplate.get(r.template_id)
      if (!m) { m = new Map(); canonicalByTemplate.set(r.template_id, m) }
      m.set(normalizeColorKey(r.color_name), r.color_name)
    })

    const out: Result[] = []
    // Process base mockups BEFORE overlays so an overlay's base row already exists to attach to (an overlay
    // only UPDATEs its base row — it can't create one, because image_url is required).
    const ordered = [...files].sort((a, b) => (parseMockupFilename(a.name)?.isOverlay ? 1 : 0) - (parseMockupFilename(b.name)?.isOverlay ? 1 : 0))
    for (let i = 0; i < ordered.length; i++) {
      setProgress({ done: i, total: ordered.length })
      const file = ordered[i]
      const parsed = parseMockupFilename(file.name)
      if (!parsed) { out.push({ name: file.name, ok: false, detail: 'Name must be style_color_position — e.g. 2001_White_LeftSleeve.png' }); continue }
      const tmpl = byStyle.get(parsed.style.trim().toLowerCase())
      if (!tmpl) { out.push({ name: file.name, ok: false, detail: `No product has style number “${parsed.style}”` }); continue }
      if (!parsed.zone) { out.push({ name: file.name, ok: false, detail: 'Unrecognized position (last part of the name)' }); continue }
      const color = canonicalByTemplate.get(tmpl.id)?.get(normalizeColorKey(parsed.color)) ?? parsed.color
      const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'png').toLowerCase()
      // Layered mockups: an `_Overlay` file attaches a FOREGROUND overlay to the EXISTING base row (its own
      // storage path; UPDATE only — never creates a row, since it has no base image). Base must exist first.
      if (parsed.isOverlay) {
        const opath = `mockups/${tmpl.id}/${slug(color)}_${parsed.zone}_overlay.${ext}`
        const { error: upErr } = await supabase.storage.from('garment-swatches').upload(opath, file, { upsert: true, contentType: file.type || 'image/png' })
        if (upErr) { out.push({ name: file.name, ok: false, detail: `Upload failed: ${upErr.message}` }); continue }
        const { data: pub } = supabase.storage.from('garment-swatches').getPublicUrl(opath)
        const odims = await naturalSize(file)
        const { data: upd, error: dbErr } = await supabase.from('product_template_mockups')
          .update({ overlay_url: `${pub.publicUrl}?v=${Date.now()}`, overlay_natural_w: odims.w || null, overlay_natural_h: odims.h || null })
          .eq('template_id', tmpl.id).eq('color_name', color).eq('zone', parsed.zone)
          .select('id')
        if (dbErr) { out.push({ name: file.name, ok: false, detail: `Save failed: ${dbErr.message}` }); continue }
        if (!upd?.length) { out.push({ name: file.name, ok: false, detail: `No base mockup for ${color} · ${ZONE_LABELS[parsed.zone] ?? parsed.zone} yet — upload the base mockup first` }); continue }
        out.push({ name: file.name, ok: true, detail: `Overlay · ${tmpl.name} · ${color} · ${ZONE_LABELS[parsed.zone] ?? parsed.zone}` })
        continue
      }
      const path = `mockups/${tmpl.id}/${slug(color)}_${parsed.zone}.${ext}`
      const { error: upErr } = await supabase.storage.from('garment-swatches').upload(path, file, { upsert: true, contentType: file.type || 'image/png' })
      if (upErr) { out.push({ name: file.name, ok: false, detail: `Upload failed: ${upErr.message}` }); continue }
      const { data } = supabase.storage.from('garment-swatches').getPublicUrl(path)
      const dims = await naturalSize(file)
      const { error: dbErr } = await supabase.from('product_template_mockups').upsert(
        {
          template_id: tmpl.id,
          color_name: color,
          zone: parsed.zone,
          image_url: `${data.publicUrl}?v=${Date.now()}`, // cache-bust an overwrite
          natural_w: dims.w || null,
          natural_h: dims.h || null,
          source: 'manual', // hand-uploaded batch — protected from Shopify re-import
        },
        { onConflict: 'template_id,color_name,zone' },
      )
      if (dbErr) { out.push({ name: file.name, ok: false, detail: `Save failed: ${dbErr.message}` }); continue }
      out.push({ name: file.name, ok: true, detail: `${tmpl.name} · ${color} · ${ZONE_LABELS[parsed.zone] ?? parsed.zone}` })
    }
    setProgress(null)
    setResults(out)
    setBusy(false)
    const okN = out.filter((r) => r.ok).length
    onMessage(`Uploaded ${okN} of ${out.length} mockups.`, okN === out.length ? 'success' : 'error')
    onDone?.()
  }

  const failed = results.filter((r) => !r.ok)
  const ok = results.filter((r) => r.ok)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-black">Batch upload mockups</h3>
        <span className="text-[11px] text-gray-400 font-mono">{withStyle}/{templates.length} products have a style #</span>
      </div>
      <div className="mt-1 text-xs text-gray-500 leading-snug space-y-1">
        <p>
          Drop all your mockup files at once, named <code className="bg-gray-100 px-1 rounded">stylenumber_color_position</code> —
          e.g. <code className="bg-gray-100 px-1 rounded">2001_White_LeftSleeve.png</code>. Each routes to its product, color, and zone automatically.
        </p>
        <p>
          <span className="font-semibold text-gray-600">Positions:</span> Front · Back · LeftSleeve · RightSleeve · <span className="font-semibold">HatBack</span>.
          For a cap, the back of the hat is <code className="bg-gray-100 px-1 rounded">HatBack</code> — not <code className="bg-gray-100 px-1 rounded">Back</code> (that&apos;s a shirt&apos;s back).
        </p>
        <p>
          <span className="font-semibold text-gray-600">Multi-word colors:</span> either way works —
          <code className="bg-gray-100 px-1 rounded">Columbia_Blue</code> or <code className="bg-gray-100 px-1 rounded">ColumbiaBlue</code>. Capitalization doesn&apos;t matter.
        </p>
      </div>

      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (!busy) void handleFiles(e.dataTransfer.files) }}
        className={`mt-3 flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-all ${busy ? 'border-gray-200 opacity-60 cursor-wait' : 'border-gray-300 cursor-pointer hover:border-[#dd3333] hover:bg-[#dd3333]/5'}`}
      >
        <span className="text-2xl leading-none">⬆</span>
        <span className="mt-2 text-sm text-gray-700">{busy ? 'Uploading…' : 'Drop mockup files here, or click to choose'}</span>
        <input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" multiple disabled={busy}
          onChange={(e) => { if (e.target.files) void handleFiles(e.target.files); e.currentTarget.value = '' }}
          className="hidden" />
      </label>

      {progress && (
        <p className="mt-2 text-xs text-gray-500 font-mono">Processing {progress.done + 1} of {progress.total}…</p>
      )}

      {results.length > 0 && (
        <div className="mt-3 space-y-2">
          {ok.length > 0 && (
            <details open className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2">
              <summary className="text-xs font-bold text-emerald-800 cursor-pointer">✓ {ok.length} assigned</summary>
              <ul className="mt-1.5 space-y-0.5">
                {ok.map((r, i) => (
                  <li key={i} className="text-[11px] text-emerald-900 font-mono truncate"><span className="text-emerald-500">{r.name}</span> → {r.detail}</li>
                ))}
              </ul>
            </details>
          )}
          {failed.length > 0 && (
            <details open className="rounded border border-red-200 bg-red-50 px-3 py-2">
              <summary className="text-xs font-bold text-red-800 cursor-pointer">✗ {failed.length} skipped</summary>
              <ul className="mt-1.5 space-y-0.5">
                {failed.map((r, i) => (
                  <li key={i} className="text-[11px] text-red-900 font-mono"><span className="font-bold">{r.name}</span> — {r.detail}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
