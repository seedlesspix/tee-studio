import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { serviceClient } from '../../../lib/customer-library'
import {
  collectReferences, reconcile, summarize, summaryLine, toCsv, parseListing, countCloudinaryRefs,
  type ReferenceSources, type OrderRow,
} from '../../../lib/backupManifest'

export const runtime = 'nodejs'
export const maxDuration = 60

// GET|POST /api/backup/manifest   (storage backup, 2026-10-29 — see BACKUP.md)
//
// The "path-to-design" list the nightly backup writes beside the files in B2: every Supabase Storage
// file the database points at, labelled with what owns it (art name + design number, font, template
// mockup/overlay/swatch, order number + product + status, saved design, pet photo). Read-only; the
// service role is used because completed orders are admin-only under RLS.
//
//   GET                       → CSV of the references alone (state=ref), for a quick look.
//   POST { files: [...] }     → CSV reconciled against rclone's listing of the buckets (the script's
//                               call): each file is ok / orphan, each dangling reference is missing.
// Both answer with an X-Backup-Summary header (one line the backup log and healthchecks ping carry).
//
// Auth: Authorization: Bearer BACKUP_MANIFEST_SECRET — the same shape as the cron routes; fails closed
// (401) when the env var is unset. The secret lives in Vercel (Sensitive) and in GitHub's secret store.

function authorized(request: NextRequest): boolean {
  const secret = process.env.BACKUP_MANIFEST_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization') ?? ''
  const a = Buffer.from(header)
  const b = Buffer.from(`Bearer ${secret}`)
  return a.length === b.length && timingSafeEqual(a, b)
}

const PAGE = 1000

async function loadSources(): Promise<ReferenceSources> {
  const supabase = serviceClient()
  const must = <T,>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`)
    return (r.data ?? []) as T
  }
  // design_orders grows with every draft/order → paged. The big canvas_json columns are deliberately not
  // read (they hold the hi-res clipart data URLs; the hosted copies they reference are in uploaded_files).
  const orders: OrderRow[] = []
  for (let from = 0; ; from += PAGE) {
    const page = must(await supabase
      .from('design_orders')
      .select('id, shopify_order_number, status, product_title, customer_name, canvas_png_front, canvas_png_back, canvas_svg_front, canvas_svg_back, uploaded_files, zones')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1), 'design_orders') as OrderRow[]
    orders.push(...page)
    if (page.length < PAGE) break
  }
  const [art, fonts, mockups, colors, templates, savedDesigns, petPhotos] = await Promise.all([
    supabase.from('clipart_items').select('id, name, decal_number, file_url, is_active').then(r => must(r, 'clipart_items')),
    supabase.from('designer_fonts').select('id, label, file_url, is_active').then(r => must(r, 'designer_fonts')),
    supabase.from('product_template_mockups').select('id, template_id, color_name, zone, image_url, overlay_url').then(r => must(r, 'product_template_mockups')),
    supabase.from('product_template_colors').select('id, template_id, color_name, swatch_image_url').then(r => must(r, 'product_template_colors')),
    supabase.from('product_templates').select('id, name').then(r => must(r, 'product_templates')),
    supabase.from('saved_designs').select('design_order_id, name').then(r => must(r, 'saved_designs')),
    // The Shopify project's table (Pet Portrait Hats), read only — its bucket is backed up with the rest.
    supabase.from('pet_photo_uploads').select('id, storage_path, public_url, shopify_order_name, product_handle, original_name').then(r => must(r, 'pet_photo_uploads')),
  ])
  return { art, fonts, mockups, colors, templates, orders, savedDesigns, petPhotos } as ReferenceSources
}

async function respond(listing: ReturnType<typeof parseListing>) {
  const sources = await loadSources()
  const refs = collectReferences(sources)
  const rows = reconcile(refs, listing)
  const summary = summaryLine(summarize(rows), countCloudinaryRefs(sources.orders))
  return new NextResponse(toCsv(rows), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Backup-Summary': summary,
    },
  })
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return await respond(null)
  } catch (err) {
    console.error('[backup-manifest] failed:', err)
    return NextResponse.json({ error: 'Manifest failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Body must be JSON { files: [...] }' }, { status: 400 }) }
  const listing = parseListing(body)
  if (!listing) return NextResponse.json({ error: 'Body must be { files: [{ bucket, path, bytes, modified }] }' }, { status: 400 })
  try {
    return await respond(listing)
  } catch (err) {
    console.error('[backup-manifest] failed:', err)
    return NextResponse.json({ error: 'Manifest failed' }, { status: 500 })
  }
}
