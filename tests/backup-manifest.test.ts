import { describe, it, expect } from 'vitest'
import {
  parseStorageUrl, extractStorageRefs, collectReferences, reconcile, summarize, summaryLine, toCsv, csvField,
  parseListing, countCloudinaryRefs, type ReferenceSources,
} from '../app/lib/backupManifest'

const BASE = 'https://yatiairlyensmcwbpldx.supabase.co/storage/v1/object/public'

describe('parseStorageUrl — stored URLs → the object name the bucket uses', () => {
  it('decodes percent-encoding and drops the cache-busting query (the two reasons a LIKE match failed)', () => {
    expect(parseStorageUrl(`${BASE}/clipart/Baby%20&%20Kids/T1503_pee_wee_bike_rebel_1792506777858.svg`))
      .toEqual({ bucket: 'clipart', path: 'Baby & Kids/T1503_pee_wee_bike_rebel_1792506777858.svg' })
    expect(parseStorageUrl(`${BASE}/garment-swatches/mockups/8cb13103-01da/red_front.png?v=1145416`))
      .toEqual({ bucket: 'garment-swatches', path: 'mockups/8cb13103-01da/red_front.png' })
  })
  it('accepts signed/authenticated forms and ignores non-storage URLs', () => {
    expect(parseStorageUrl('https://x.supabase.co/storage/v1/object/sign/design-exports/a/b.png?token=abc')).toEqual({ bucket: 'design-exports', path: 'a/b.png' })
    expect(parseStorageUrl('https://res.cloudinary.com/demo/image/upload/v1/abc.png')).toBeNull()
    expect(parseStorageUrl('data:image/png;base64,AAAA')).toBeNull()
    expect(parseStorageUrl(null)).toBeNull()
    expect(parseStorageUrl('')).toBeNull()
  })
  it('extracts every storage URL from a jsonb blob rendered as text', () => {
    const text = JSON.stringify([{ url: `${BASE}/customer-uploads/o1/uploads/0_P+E%20Full%20Logo.png`, name: 'x' }, { url: 'https://res.cloudinary.com/d/image/upload/a.png' }])
    expect(extractStorageRefs(text)).toEqual([{ bucket: 'customer-uploads', path: 'o1/uploads/0_P+E Full Logo.png' }])
    expect(extractStorageRefs(null)).toEqual([])
  })
})

const sources: ReferenceSources = {
  art: [{ id: 'a1', name: 'Bucktown Chicago', decal_number: 1801, file_url: `${BASE}/clipart/Chicago/T1801_1792258071626.svg`, is_active: true },
        { id: 'a2', name: 'Old thing', decal_number: null, file_url: `${BASE}/clipart/Misc/old.svg`, is_active: false }],
  fonts: [{ id: 'f1', label: 'Rockwell', file_url: `${BASE}/fonts/rockwell.ttc`, is_active: true }, { id: 'f2', label: 'Google only', file_url: null, is_active: true }],
  mockups: [{ id: 'm1', template_id: 't1', color_name: 'Red', zone: 'front', image_url: `${BASE}/garment-swatches/mockups/t1/red_front.png?v=1`, overlay_url: `${BASE}/garment-swatches/mockups/t1/red_front_overlay.png?v=2` }],
  colors: [{ id: 'c1', template_id: 't1', color_name: 'Red', swatch_image_url: `${BASE}/garment-swatches/t1/red.png` }],
  templates: [{ id: 't1', name: 'Unisex Cotton T' }],
  orders: [
    { id: '11111111-aaaa-bbbb-cccc-000000000001', shopify_order_number: 16987, status: 'completed', product_title: 'Unisex Cotton T', customer_name: 'Pat Example',
      canvas_png_front: `${BASE}/design-exports/11111111-aaaa-bbbb-cccc-000000000001/front.png`, canvas_png_back: null, canvas_svg_front: `${BASE}/design-exports/11111111-aaaa-bbbb-cccc-000000000001/front.svg`, canvas_svg_back: null,
      uploaded_files: [{ url: `${BASE}/customer-uploads/11111111-aaaa-bbbb-cccc-000000000001/uploads/0_logo.png`, name: 'logo.png' }, { url: 'https://res.cloudinary.com/d/image/upload/v1/x.png', name: 'x.png' }], zones: null },
    { id: '22222222-aaaa-bbbb-cccc-000000000002', shopify_order_number: null, status: 'draft', product_title: 'Baby Onesie', customer_name: 'Should Not Appear',
      canvas_png_front: `${BASE}/design-exports/saved/thumb-uuid.png`, canvas_png_back: null, canvas_svg_front: null, canvas_svg_back: null, uploaded_files: '[]', zones: null },
  ],
  savedDesigns: [{ design_order_id: '22222222-aaaa-bbbb-cccc-000000000002', name: 'Reunion 2026' }],
  petPhotos: [{ id: 'p1', storage_path: '2026/10/abc.png', public_url: null, shopify_order_name: '#1001', product_handle: 'pet-portrait-hat', original_name: 'dog.png' }],
}

describe('collectReferences — every file the database points at, labelled', () => {
  const refs = collectReferences(sources)
  const byKey = Object.fromEntries(refs.map(r => [`${r.bucket}/${r.path}`, r]))
  it('labels art, fonts, mockups, overlays and swatches', () => {
    expect(byKey['clipart/Chicago/T1801_1792258071626.svg']).toMatchObject({ kind: 'art', label: 'Art · T1801 Bucktown Chicago', status: 'active', ref: 'a1' })
    expect(byKey['clipart/Misc/old.svg']).toMatchObject({ kind: 'art', label: 'Art · Old thing', status: 'inactive' })
    expect(byKey['fonts/rockwell.ttc']).toMatchObject({ kind: 'font', label: 'Font · Rockwell' })
    expect(byKey['garment-swatches/mockups/t1/red_front.png']).toMatchObject({ kind: 'mockup', label: 'Unisex Cotton T · Red · front mockup' })
    expect(byKey['garment-swatches/mockups/t1/red_front_overlay.png']).toMatchObject({ kind: 'overlay' })
    expect(byKey['garment-swatches/t1/red.png']).toMatchObject({ kind: 'swatch', label: 'Unisex Cotton T · Red swatch' })
  })
  it('labels order files with the order number, product and status; customer name only on completed orders', () => {
    expect(byKey['design-exports/11111111-aaaa-bbbb-cccc-000000000001/front.png']).toMatchObject({ kind: 'order_export', label: 'Order #16987 · Unisex Cotton T', status: 'completed', customer: 'Pat Example' })
    expect(byKey['design-exports/11111111-aaaa-bbbb-cccc-000000000001/front.svg']).toMatchObject({ kind: 'order_export' })
    expect(byKey['customer-uploads/11111111-aaaa-bbbb-cccc-000000000001/uploads/0_logo.png']).toMatchObject({ kind: 'order_upload', label: 'Order #16987 · Unisex Cotton T · customer upload' })
    expect(byKey['design-exports/saved/thumb-uuid.png']).toMatchObject({ kind: 'saved_design_thumbnail', label: 'Saved design · Reunion 2026 · Order 22222222 · Baby Onesie', status: 'draft', customer: '' })
  })
  it('includes the pet-photo bucket from its storage_path (the Shopify project table, read only)', () => {
    expect(byKey['pet-photos/2026/10/abc.png']).toMatchObject({ kind: 'pet_photo', label: 'Pet photo · #1001 · pet-portrait-hat' })
  })
  it('skips rows with no file and never emits Cloudinary refs', () => {
    expect(refs.some(r => r.ref === 'f2')).toBe(false)
    expect(refs.some(r => r.path.includes('cloudinary'))).toBe(false)
    expect(countCloudinaryRefs(sources.orders)).toBe(1)
  })
})

describe('reconcile — database references × rclone listing', () => {
  const refs = collectReferences(sources)
  const listing = [
    { bucket: 'clipart', path: 'Chicago/T1801_1792258071626.svg', bytes: 3214, modified: '2026-10-17T12:00:00Z' },
    { bucket: 'clipart', path: 'Activities/orphan.svg', bytes: 10, modified: '2026-01-01T00:00:00Z' },
    { bucket: 'fonts', path: 'rockwell.ttc', bytes: 100, modified: '' },
    { bucket: 'clipart', path: 'Chicago/T1801_1792258071626.svg', bytes: 3214, modified: '2026-10-17T12:00:00Z' }, // duplicate listing entry
  ]
  it('marks present+owned ok, present+unowned orphan, owned+absent missing; sorted; duplicates collapsed', () => {
    const rows = reconcile(refs, listing)
    const state = (b: string, p: string) => rows.find(r => r.bucket === b && r.path === p)?.state
    expect(state('clipart', 'Chicago/T1801_1792258071626.svg')).toBe('ok')
    expect(state('clipart', 'Activities/orphan.svg')).toBe('orphan')
    expect(state('fonts', 'rockwell.ttc')).toBe('ok')
    expect(state('clipart', 'Misc/old.svg')).toBe('missing')
    expect(state('pet-photos', '2026/10/abc.png')).toBe('missing')
    expect(rows.filter(r => r.path === 'Chicago/T1801_1792258071626.svg')).toHaveLength(1)
    const keys = rows.map(r => `${r.bucket}/${r.path}`)
    expect([...keys].sort()).toEqual(keys)
    const s = summarize(rows)
    expect(s).toMatchObject({ ok: 2, orphan: 1, missing: refs.length - 2, ref: 0 })
    expect(s.buckets).toEqual({ clipart: 2, fonts: 1 })
    expect(summaryLine(s, 1)).toContain('files=3 ok=2 orphan=1 missing=')
    expect(summaryLine(s, 1)).toContain('cloudinary_refs_not_in_this_backup=1 clipart=2 fonts=1')
  })
  it('with no listing (GET) every reference is a ref row with blank size/time', () => {
    const rows = reconcile(refs, null)
    expect(rows).toHaveLength(refs.length)
    expect(rows.every(r => r.state === 'ref' && r.bytes === '' && r.modified === '')).toBe(true)
  })
})

describe('CSV', () => {
  it('quotes commas, quotes and newlines; header is the column list', () => {
    expect(csvField('plain')).toBe('plain')
    expect(csvField('a, b')).toBe('"a, b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('two\nlines')).toBe('"two\nlines"')
    expect(csvField(null)).toBe('')
    expect(csvField(42)).toBe('42')
    const csv = toCsv(reconcile(collectReferences(sources), null))
    expect(csv.split('\n')[0]).toBe('bucket,path,bytes,modified,state,kind,label,ref,status,customer')
    expect(csv).toContain('Order #16987 · Unisex Cotton T,')
  })
  it('parseListing accepts the script body and rejects junk', () => {
    expect(parseListing({ files: [{ bucket: 'clipart', path: 'a.svg', bytes: 5, modified: 'x' }] })).toEqual([{ bucket: 'clipart', path: 'a.svg', bytes: 5, modified: 'x' }])
    expect(parseListing({ files: [{ bucket: 'clipart', path: 'a.svg' }] })).toEqual([{ bucket: 'clipart', path: 'a.svg', bytes: 0, modified: '' }])
    expect(parseListing({ files: [{ bucket: '', path: 'a.svg' }] })).toBeNull()
    expect(parseListing({ files: 'nope' })).toBeNull()
    expect(parseListing(null)).toBeNull()
  })
})
