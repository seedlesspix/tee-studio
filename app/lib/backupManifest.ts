// Storage backup manifest (2026-10-29) — PURE helpers shared by /api/backup/manifest and its tests.
//
// The nightly backup (scripts/storage-backup.sh, run by .github/workflows/storage-backup.yml; see
// BACKUP.md) copies every Supabase Storage bucket to Backblaze B2 and writes a "path-to-design" manifest
// beside the files, so a recovered file can be traced to the art item, font, template mockup, order or
// saved design that owns it instead of being a mystery blob.
//
// Two inputs, reconciled here:
//   • OWNERSHIP comes from the public tables: every Supabase Storage URL they hold (clipart_items.file_url,
//     designer_fonts.file_url, product_template_mockups.image_url/overlay_url,
//     product_template_colors.swatch_image_url, design_orders' preview/export/upload URLs, and
//     pet_photo_uploads.storage_path — the Shopify project's table, read only).
//   • THE FILE LIST comes from rclone's own listing, POSTed by the backup script. The API does not expose
//     the `storage` schema, so the app cannot read storage.objects directly, and the listing is what was
//     actually copied anyway.
// Each file ends up `ok` (present and owned), `orphan` (present, nothing points at it — the cleanup crons
// delete rows but never files, so these accumulate), or `missing` (a row points at a file that is gone —
// the integrity signal worth reading).
//
// Stored URLs are not byte-identical to object names: the admin appends a cache-busting `?v=…` to mockup
// URLs, and names with spaces are percent-encoded in URLs but plain in the bucket ("Baby & Kids/…").
// parseStorageUrl() normalizes both, which is why a naive LIKE match failed on 400 of 400 mockups.

export type StorageRef = { bucket: string; path: string }

export type ManifestKind =
  | 'art' | 'font' | 'mockup' | 'overlay' | 'swatch'
  | 'order_export' | 'order_upload' | 'saved_design_thumbnail' | 'pet_photo'

export type ManifestRef = StorageRef & {
  kind: ManifestKind
  label: string    // human: "Art · T1801 Bucktown Chicago", "Order #16987 · Unisex Cotton T"
  ref: string      // the owning row's id (uuid) — what to look up in the admin / Table Editor
  status: string   // active/inactive, the order status, '' when n/a
  customer: string // completed orders only: the customer's name. Never email, phone or address.
}

export type ListedFile = { bucket: string; path: string; bytes: number; modified: string }

export type ManifestState = 'ok' | 'orphan' | 'missing' | 'ref'

export type ManifestRow = {
  bucket: string; path: string; bytes: number | ''; modified: string
  state: ManifestState
  kind: ManifestKind | ''; label: string; ref: string; status: string; customer: string
}

export const MANIFEST_COLUMNS = ['bucket', 'path', 'bytes', 'modified', 'state', 'kind', 'label', 'ref', 'status', 'customer'] as const

// A Supabase Storage object URL → { bucket, path } as the bucket names the object, or null for anything
// else (Cloudinary, data: URLs, Shopify CDN). Accepts /object/public/, /object/sign/ and
// /object/authenticated/ forms, drops the query string (the admin's `?v=` cache-buster, signed `?token=`)
// and percent-decodes the path (URLs carry "Baby%20&%20Kids", the bucket holds "Baby & Kids").
export function parseStorageUrl(url: string | null | undefined): StorageRef | null {
  if (!url || typeof url !== 'string') return null
  const m = url.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/)
  if (!m) return null
  const bucket = safeDecode(m[1])
  const path = safeDecode(m[2]).replace(/^\/+/, '')
  if (!bucket || !path) return null
  return { bucket, path }
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}

// Every Supabase Storage URL inside a blob of text (a jsonb column rendered as text: uploaded_files, zones).
export function extractStorageRefs(text: string | null | undefined): StorageRef[] {
  if (!text) return []
  const out: StorageRef[] = []
  const re = /https?:\/\/[^\s"'\\<>]+\/storage\/v1\/object\/[^\s"'\\<>]+/g
  for (const m of text.matchAll(re)) {
    const ref = parseStorageUrl(m[0])
    if (ref) out.push(ref)
  }
  return out
}

export const refKey = (r: StorageRef) => `${r.bucket}/${r.path}`

// ── The rows the route reads (minimal column sets) ─────────────────────────────────────────────────────
export type ArtRow = { id: string; name: string | null; decal_number: number | null; file_url: string | null; is_active: boolean | null }
export type FontRow = { id: string; label: string | null; file_url: string | null; is_active: boolean | null }
export type MockupRow = { id: string; template_id: string | null; color_name: string | null; zone: string | null; image_url: string | null; overlay_url: string | null }
export type ColorRow = { id: string; template_id: string | null; color_name: string | null; swatch_image_url: string | null }
export type TemplateRow = { id: string; name: string | null }
export type OrderRow = {
  id: string; shopify_order_number: string | number | null; status: string | null; product_title: string | null
  customer_name: string | null; canvas_png_front: string | null; canvas_png_back: string | null
  canvas_svg_front: string | null; canvas_svg_back: string | null; uploaded_files: unknown; zones: unknown
}
export type SavedDesignRow = { design_order_id: string | null; name: string | null }
export type PetPhotoRow = { id: string; storage_path: string | null; public_url: string | null; shopify_order_name: string | null; product_handle: string | null; original_name: string | null }

export type ReferenceSources = {
  art: ArtRow[]; fonts: FontRow[]; mockups: MockupRow[]; colors: ColorRow[]; templates: TemplateRow[]
  orders: OrderRow[]; savedDesigns: SavedDesignRow[]; petPhotos: PetPhotoRow[]
}

const PET_PHOTOS_BUCKET = 'pet-photos'

// Everything the database points at, one entry per distinct bucket/path (the first owner wins when two
// rows share a file — e.g. a draft and the order it became).
export function collectReferences(src: ReferenceSources): ManifestRef[] {
  const out = new Map<string, ManifestRef>()
  const add = (ref: StorageRef | null, fields: Omit<ManifestRef, 'bucket' | 'path'>) => {
    if (!ref) return
    const k = refKey(ref)
    if (!out.has(k)) out.set(k, { ...ref, ...fields })
  }
  const templateName = new Map(src.templates.map(t => [t.id, t.name || t.id]))
  const savedName = new Map(src.savedDesigns.filter(s => s.design_order_id).map(s => [s.design_order_id as string, s.name || 'untitled']))

  for (const a of src.art) {
    add(parseStorageUrl(a.file_url), {
      kind: 'art', ref: a.id, customer: '',
      label: `Art · ${a.decal_number != null ? `T${a.decal_number} ` : ''}${a.name || ''}`.trim(),
      status: a.is_active === false ? 'inactive' : 'active',
    })
  }
  for (const f of src.fonts) {
    add(parseStorageUrl(f.file_url), { kind: 'font', ref: f.id, customer: '', label: `Font · ${f.label || ''}`.trim(), status: f.is_active === false ? 'inactive' : 'active' })
  }
  for (const m of src.mockups) {
    const t = m.template_id ? templateName.get(m.template_id) || m.template_id : 'unknown template'
    add(parseStorageUrl(m.image_url), { kind: 'mockup', ref: m.id, customer: '', label: `${t} · ${m.color_name || ''} · ${m.zone || ''} mockup`, status: '' })
    add(parseStorageUrl(m.overlay_url), { kind: 'overlay', ref: m.id, customer: '', label: `${t} · ${m.color_name || ''} · ${m.zone || ''} overlay`, status: '' })
  }
  for (const c of src.colors) {
    const t = c.template_id ? templateName.get(c.template_id) || c.template_id : 'unknown template'
    add(parseStorageUrl(c.swatch_image_url), { kind: 'swatch', ref: c.id, customer: '', label: `${t} · ${c.color_name || ''} swatch`, status: '' })
  }
  for (const o of src.orders) {
    const number = o.shopify_order_number != null && String(o.shopify_order_number) !== '' ? `#${o.shopify_order_number}` : o.id.slice(0, 8)
    const status = o.status || ''
    const customer = status === 'completed' ? (o.customer_name || '') : ''
    const saved = savedName.get(o.id)
    const base = `Order ${number} · ${o.product_title || ''}`.trim()
    const fields = (kind: ManifestKind, label: string) => ({ kind, ref: o.id, status, customer, label })
    for (const url of [o.canvas_png_front, o.canvas_png_back, o.canvas_svg_front, o.canvas_svg_back]) {
      const ref = parseStorageUrl(url)
      if (!ref) continue
      if (ref.path.startsWith('saved/')) add(ref, fields('saved_design_thumbnail', `Saved design · ${saved || 'untitled'} · ${base}`))
      else add(ref, fields('order_export', saved ? `${base} · saved as "${saved}"` : base))
    }
    for (const ref of extractStorageRefs(jsonText(o.uploaded_files))) add(ref, fields('order_upload', `${base} · customer upload`))
    for (const ref of extractStorageRefs(jsonText(o.zones))) add(ref, fields('order_export', `${base} · zone export`))
  }
  for (const p of src.petPhotos) {
    const ref = parseStorageUrl(p.public_url) || (p.storage_path ? { bucket: PET_PHOTOS_BUCKET, path: p.storage_path.replace(/^\/+/, '') } : null)
    add(ref, { kind: 'pet_photo', ref: p.id, customer: '', status: '', label: `Pet photo · ${p.shopify_order_name || 'no order'} · ${p.product_handle || ''}`.trim() })
  }
  return Array.from(out.values())
}

function jsonText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  try { return JSON.stringify(v) } catch { return '' }
}

// Cloudinary is NOT in this backup (BACKUP.md → "What it does not cover"; Part 2). Count how many
// customer-upload references point there so every run's log says how big that gap currently is.
export function countCloudinaryRefs(orders: Pick<OrderRow, 'uploaded_files'>[]): number {
  let n = 0
  for (const o of orders) n += (jsonText(o.uploaded_files).match(/https?:\/\/[^\s"'\\]*cloudinary\.com\/[^\s"'\\]*/g) || []).length
  return n
}

// Join the database's references with rclone's listing. Without a listing (GET), every reference is a
// 'ref' row with blank size/time. With one (POST), each listed file is 'ok' or 'orphan', and each
// reference nothing was listed for is 'missing'.
export function reconcile(refs: ManifestRef[], listing: ListedFile[] | null): ManifestRow[] {
  const byKey = new Map(refs.map(r => [refKey(r), r]))
  const rows: ManifestRow[] = []
  if (!listing) {
    for (const r of refs) rows.push({ bucket: r.bucket, path: r.path, bytes: '', modified: '', state: 'ref', kind: r.kind, label: r.label, ref: r.ref, status: r.status, customer: r.customer })
  } else {
    const seen = new Set<string>()
    for (const f of listing) {
      const k = refKey(f)
      if (seen.has(k)) continue
      seen.add(k)
      const r = byKey.get(k)
      rows.push(r
        ? { bucket: f.bucket, path: f.path, bytes: f.bytes, modified: f.modified, state: 'ok', kind: r.kind, label: r.label, ref: r.ref, status: r.status, customer: r.customer }
        : { bucket: f.bucket, path: f.path, bytes: f.bytes, modified: f.modified, state: 'orphan', kind: '', label: '', ref: '', status: '', customer: '' })
    }
    for (const r of refs) {
      if (!seen.has(refKey(r))) rows.push({ bucket: r.bucket, path: r.path, bytes: '', modified: '', state: 'missing', kind: r.kind, label: r.label, ref: r.ref, status: r.status, customer: r.customer })
    }
  }
  // Plain code-unit order (not localeCompare): the same manifest sorts identically on every machine.
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)
  rows.sort((a, b) => cmp(a.bucket, b.bucket) || cmp(a.path, b.path))
  return rows
}

export type ManifestSummary = { rows: number; ok: number; orphan: number; missing: number; ref: number; buckets: Record<string, number> }

export function summarize(rows: ManifestRow[]): ManifestSummary {
  const s: ManifestSummary = { rows: rows.length, ok: 0, orphan: 0, missing: 0, ref: 0, buckets: {} }
  for (const r of rows) {
    s[r.state] += 1
    if (r.state !== 'missing') s.buckets[r.bucket] = (s.buckets[r.bucket] || 0) + 1
  }
  return s
}

// The one-line form the backup log and the healthchecks.io ping carry.
export function summaryLine(s: ManifestSummary, cloudinaryRefs: number): string {
  const perBucket = Object.entries(s.buckets).sort().map(([b, n]) => `${b}=${n}`).join(' ')
  return `files=${s.ok + s.orphan} ok=${s.ok} orphan=${s.orphan} missing=${s.missing} refs=${s.ref} cloudinary_refs_not_in_this_backup=${cloudinaryRefs} ${perBucket}`.trim()
}

// RFC 4180: quote a field holding a comma, quote, CR or LF; double embedded quotes.
export function csvField(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: ManifestRow[]): string {
  const lines = [MANIFEST_COLUMNS.join(',')]
  for (const r of rows) lines.push(MANIFEST_COLUMNS.map(c => csvField(r[c])).join(','))
  return lines.join('\n') + '\n'
}

// Validate the body the backup script POSTs: { files: [{ bucket, path, bytes, modified }] }.
export function parseListing(body: unknown): ListedFile[] | null {
  if (!body || typeof body !== 'object') return null
  const files = (body as { files?: unknown }).files
  if (!Array.isArray(files)) return null
  const out: ListedFile[] = []
  for (const f of files) {
    if (!f || typeof f !== 'object') return null
    const { bucket, path, bytes, modified } = f as Record<string, unknown>
    if (typeof bucket !== 'string' || typeof path !== 'string' || !bucket || !path) return null
    out.push({ bucket, path, bytes: typeof bytes === 'number' && Number.isFinite(bytes) ? bytes : 0, modified: typeof modified === 'string' ? modified : '' })
  }
  return out
}
