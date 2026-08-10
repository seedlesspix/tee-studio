'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { normalizeShopifyProductId } from '../../lib/productImages'
import { normalizeTiers, type VolumeTier } from '../../lib/volumeTiers'
import { useT } from '../../components/StringsProvider'
import type { Tables } from '@/types/database'
import PrintAreaEditor from './PrintAreaEditor'
import TemplateColorsEditor from './TemplateColorsEditor'

type Template = Tables<'product_templates'>
type PrintMethod = Tables<'designer_print_methods'>

// BETA #24 — simple product categories so the designer picker can advise (same category first).
const TEMPLATE_CATEGORIES = ['Unisex', "Women's", "Kid's", "Baby's", 'Accessories'] as const

type Draft = {
  name: string
  shopify_product_id: string
  category: string
  supported_print_methods: string[]
  default_print_method: string
  supports_names_numbers: boolean
  is_active: boolean
  volume_tiers: VolumeTier[]
  volume_tiers_embroidery: VolumeTier[]
  embroideryOverride: boolean // dual-method only: give embroidery its own ladder
}

const EMPTY_DRAFT: Draft = {
  name: '',
  shopify_product_id: '',
  category: '',
  supported_print_methods: [],
  default_print_method: '',
  supports_names_numbers: true,
  is_active: true,
  volume_tiers: [],
  volume_tiers_embroidery: [],
  embroideryOverride: false,
}

export default function TemplatesAdmin() {
  const t = useT()
  const [templates, setTemplates] = useState<Template[]>([])
  const [methods, setMethods] = useState<PrintMethod[]>([])
  const [areaCounts, setAreaCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // 'list' shows the table; otherwise we're editing an existing template (by id)
  // or creating a new one (id === null).
  const [editing, setEditing] = useState<{ id: string | null } | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [reordering, setReordering] = useState(false)

  const showMessage = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  // Reorder the product list (drives the designer's product picker order). ▲▼ swaps two rows and
  // reindexes sort_order to a clean 0..n-1, persisting only the rows whose value actually changed
  // (mirrors the admin colors/fonts reorder). Optimistic; re-syncs from the server on error.
  const moveTemplate = async (row: Template, dir: 'up' | 'down') => {
    const idx = templates.findIndex(t => t.id === row.id)
    const swapWith = dir === 'up' ? idx - 1 : idx + 1
    if (idx < 0 || swapWith < 0 || swapWith >= templates.length) return
    setReordering(true)
    const arr = [...templates]
    ;[arr[idx], arr[swapWith]] = [arr[swapWith], arr[idx]]
    const next = arr.map((t, i) => ({ ...t, sort_order: i }))
    const toPersist = next.filter(t => (templates.find(o => o.id === t.id)?.sort_order ?? -1) !== t.sort_order)
    setTemplates(next) // optimistic
    const results = await Promise.all(
      toPersist.map(t => supabase.from('product_templates').update({ sort_order: t.sort_order }).eq('id', t.id))
    )
    setReordering(false)
    const err = results.find(r => r.error)?.error
    if (err) { showMessage('Error reordering: ' + err.message, 'error'); fetchData() }
  }

  const fetchData = () =>
    Promise.all([
      supabase.from('product_templates').select('*').order('sort_order').order('name'),
      supabase.from('designer_print_methods').select('*').order('sort_order'),
      supabase.from('product_template_print_areas').select('template_id'),
    ]).then(([t, m, a]) => {
      if (t.data) setTemplates(t.data)
      if (m.data) setMethods(m.data)
      if (a.data) {
        const counts: Record<string, number> = {}
        a.data.forEach((r: { template_id: string }) => {
          counts[r.template_id] = (counts[r.template_id] ?? 0) + 1
        })
        setAreaCounts(counts)
      }
    })

  // Refresh helper for the "Back to templates" button (event handler → the
  // synchronous setLoading is fine there).
  const load = () => { setLoading(true); fetchData().then(() => setLoading(false)) }

  // Mount fetch: state is only set inside the async .then (no synchronous
  // setState in the effect body).
  useEffect(() => { fetchData().then(() => setLoading(false)) }, [])

  // Method display name via the Language editor (so admin shows "Print", not the DB "Screen Print" — BETA
  // #15); falls back to the DB label / key for any unregistered method.
  const labelFor = (key: string) => {
    const s = t('method.' + key)
    return s.startsWith('method.') ? (methods.find(m => m.key === key)?.label ?? key.replace('_', ' ')) : s
  }

  const openNew = () => { setDraft(EMPTY_DRAFT); setEditing({ id: null }) }
  const openEdit = (t: Template) => {
    const embTiers = normalizeTiers(t.volume_tiers_embroidery)
    setDraft({
      name: t.name,
      shopify_product_id: t.shopify_product_id,
      category: t.category ?? '',
      supported_print_methods: [...t.supported_print_methods],
      default_print_method: t.default_print_method,
      supports_names_numbers: t.supports_names_numbers ?? true,
      is_active: t.is_active,
      volume_tiers: normalizeTiers(t.volume_tiers),
      volume_tiers_embroidery: embTiers,
      embroideryOverride: embTiers.length > 0,
    })
    setEditing({ id: t.id })
  }

  // Volume-tier editor helpers, parameterized by ladder (default vs. the dual-method embroidery
  // override). Rows stay freeform in the draft; normalizeTiers (sort/validate/de-dupe) runs on SAVE so a
  // half-typed row never corrupts the stored ladder.
  type Ladder = 'volume_tiers' | 'volume_tiers_embroidery'
  const addTier = (field: Ladder) => setDraft(p => ({ ...p, [field]: [...p[field], { minQty: 0, pct: 0 }] }))
  const updateTier = (field: Ladder, i: number, key: 'minQty' | 'pct', value: number) =>
    setDraft(p => ({ ...p, [field]: p[field].map((t, j) => j === i ? { ...t, [key]: value } : t) }))
  const removeTier = (field: Ladder, i: number) =>
    setDraft(p => ({ ...p, [field]: p[field].filter((_, j) => j !== i) }))

  // Dual-method = supports embroidery AND at least one other method, so "default vs. embroidery" is a
  // real distinction. Embroidery-only (or print-only) templates use the single default ladder — the
  // override UI stays hidden there (don't complicate single-method products).
  const isDualMethod = (d: Draft) => d.supported_print_methods.includes('embroidery') && d.supported_print_methods.length > 1

  // One tier-ladder editor (rows of "buy N → save P%", + Add). Shared by the default and the
  // dual-method embroidery ladders so they can't drift.
  const ladderRows = (field: Ladder) => (
    <div className="mt-2 flex flex-col gap-2">
      {draft[field].map((t, i) => (
        <div key={i} className="flex items-center gap-2 text-sm font-mono text-black">
          <span className="text-gray-500 text-xs w-8">Buy</span>
          <input type="number" min={2} value={t.minQty || ''} placeholder="6"
            onChange={e => updateTier(field, i, 'minQty', parseInt(e.target.value) || 0)}
            className="w-20 bg-white border border-gray-300 rounded px-2 py-1 text-sm text-black outline-none focus:border-[#dd3333]" />
          <span className="text-gray-500 text-xs">or more → save</span>
          <input type="number" min={1} max={99} value={t.pct || ''} placeholder="10"
            onChange={e => updateTier(field, i, 'pct', parseInt(e.target.value) || 0)}
            className="w-16 bg-white border border-gray-300 rounded px-2 py-1 text-sm text-black outline-none focus:border-[#dd3333]" />
          <span className="text-gray-500 text-xs">%</span>
          <button onClick={() => removeTier(field, i)} title="Remove tier"
            className="ml-1 text-gray-400 hover:text-[#dd3333] text-lg leading-none px-1">×</button>
        </div>
      ))}
      <button onClick={() => addTier(field)}
        className="self-start mt-1 px-3 py-1 rounded text-xs bg-white text-black border border-gray-300 hover:bg-gray-50 font-mono">
        + Add tier
      </button>
    </div>
  )

  const toggleSupported = (key: string) => {
    setDraft(prev => {
      const has = prev.supported_print_methods.includes(key)
      const supported = has
        ? prev.supported_print_methods.filter(k => k !== key)
        : [...prev.supported_print_methods, key]
      // Keep default valid: clear it if it's no longer supported; default to the
      // first supported method if none chosen yet.
      let def = prev.default_print_method
      if (!supported.includes(def)) def = supported[0] ?? ''
      return { ...prev, supported_print_methods: supported, default_print_method: def }
    })
  }

  const validateDraft = (): string | null => {
    if (!draft.name.trim()) return 'Template name is required.'
    if (!draft.shopify_product_id.trim()) return 'Shopify product ID is required.'
    if (!normalizeShopifyProductId(draft.shopify_product_id))
      return 'Shopify product ID must contain a numeric ID (a full gid://…, a bare number, or a product URL).'
    if (draft.supported_print_methods.length === 0) return 'Pick at least one supported print method.'
    if (!draft.default_print_method) return 'Choose a default print method.'
    if (!draft.supported_print_methods.includes(draft.default_print_method))
      return 'Default method must be one of the supported methods.'
    return null
  }

  const saveTemplate = async () => {
    const err = validateDraft()
    if (err) { showMessage(err, 'error'); return }
    setSavingTemplate(true)
    const payload = {
      name: draft.name.trim(),
      // Canonicalize to gid://shopify/Product/<n> so the designer's template
      // lookup (keyed off the GID) always matches, regardless of what form the
      // admin pasted (GID, bare numeric, product URL, or a "Products" typo).
      shopify_product_id: normalizeShopifyProductId(draft.shopify_product_id)!,
      category: draft.category.trim() || null,
      supported_print_methods: draft.supported_print_methods,
      default_print_method: draft.default_print_method,
      supports_names_numbers: draft.supports_names_numbers,
      is_active: draft.is_active,
      // Normalize on save (sort asc, drop invalid, de-dupe); empty ladder → null = no volume discount.
      volume_tiers: normalizeTiers(draft.volume_tiers).length ? normalizeTiers(draft.volume_tiers) : null,
      // Embroidery override: only when the toggle is on AND it has real rows; otherwise clear it (embroidery
      // falls back to the default ladder). Meaningless on non-dual-method templates, so also null there.
      volume_tiers_embroidery:
        draft.embroideryOverride && isDualMethod(draft) && normalizeTiers(draft.volume_tiers_embroidery).length
          ? normalizeTiers(draft.volume_tiers_embroidery)
          : null,
    }
    if (editing?.id) {
      const { data, error } = await supabase
        .from('product_templates').update(payload).eq('id', editing.id).select().single()
      setSavingTemplate(false)
      if (error) { showMessage('Error: ' + error.message, 'error'); return }
      setTemplates(prev => prev.map(t => t.id === editing.id ? data : t))
      showMessage('Template saved!')
    } else {
      const { data, error } = await supabase
        .from('product_templates').insert(payload).select().single()
      setSavingTemplate(false)
      if (error) { showMessage('Error: ' + error.message, 'error'); return }
      setTemplates(prev => [...prev, data])
      setEditing({ id: data.id })   // switch into edit mode so print areas can be added
      showMessage('Template created — now add print areas below.')
    }
  }

  const toggleActive = async (t: Template) => {
    const { error } = await supabase
      .from('product_templates').update({ is_active: !t.is_active }).eq('id', t.id)
    if (error) { showMessage('Error: ' + error.message, 'error'); return }
    setTemplates(prev => prev.map(r => r.id === t.id ? { ...r, is_active: !r.is_active } : r))
  }

  const deleteTemplate = async (t: Template) => {
    if (!confirm(`Delete "${t.name}" and all its print areas? This cannot be undone.`)) return
    const { error } = await supabase.from('product_templates').delete().eq('id', t.id)
    if (error) { showMessage('Error deleting: ' + error.message, 'error'); return }
    setTemplates(prev => prev.filter(r => r.id !== t.id))
    showMessage('Deleted!')
  }

  const editingTemplate = editing?.id ? templates.find(t => t.id === editing.id) ?? null : null

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-mono font-bold text-black">Product Templates</h1>
            <p className="text-gray-600 text-sm font-mono mt-1">
              Designable products, their supported print methods, and print areas.
            </p>
          </div>
          {!editing && (
            <button onClick={openNew}
              className="px-4 py-2 rounded text-sm font-mono bg-[#dd3333] text-white hover:bg-red-700 transition-all">
              + New Template
            </button>
          )}
        </div>

        {message && (
          <div className={`fixed top-6 right-6 px-4 py-3 rounded font-mono text-sm z-50 ${
            message.type === 'success' ? 'bg-[#dd3333] text-white' : 'bg-red-600 text-white'
          }`}>
            {message.text}
          </div>
        )}

        {/* ---------- LIST ---------- */}
        {!editing && (
          loading ? (
            <p className="text-gray-600 font-mono text-center py-12">Loading...</p>
          ) : templates.length === 0 ? (
            <p className="text-gray-600 font-mono text-center py-12">No templates yet. Use “+ New Template”.</p>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm font-mono">
                <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-2 py-3" title="Order shown in the designer's product picker">Order</th>
                    <th className="text-left px-4 py-3">Name</th>
                    <th className="text-left px-4 py-3">Shopify product</th>
                    <th className="text-left px-4 py-3">Methods</th>
                    <th className="text-left px-4 py-3">Areas</th>
                    <th className="text-left px-4 py-3">Active</th>
                    <th className="text-right px-4 py-3">Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t, i) => (
                    <tr key={t.id} className={`border-t border-gray-100 ${t.is_active ? '' : 'opacity-60'}`}>
                      <td className="px-2 py-3">
                        <div className="flex flex-col leading-none">
                          <button onClick={() => moveTemplate(t, 'up')} disabled={i === 0 || reordering} title="Move up"
                            className="px-1 text-xs text-gray-500 hover:text-[#dd3333] disabled:opacity-25 disabled:hover:text-gray-500">▲</button>
                          <button onClick={() => moveTemplate(t, 'down')} disabled={i === templates.length - 1 || reordering} title="Move down"
                            className="px-1 text-xs text-gray-500 hover:text-[#dd3333] disabled:opacity-25 disabled:hover:text-gray-500">▼</button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-black">{t.name}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs truncate max-w-[16rem]" title={t.shopify_product_id}>
                        {t.shopify_product_id}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          {t.supported_print_methods.map(k => (
                            <span key={k} className={`text-[10px] px-1.5 py-0.5 rounded border ${
                              k === t.default_print_method
                                ? 'bg-[#dd3333] text-white border-[#dd3333]'
                                : 'bg-gray-100 text-gray-700 border-gray-200'
                            }`} title={k === t.default_print_method ? 'default' : ''}>
                              {labelFor(k)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {(areaCounts[t.id] ?? 0) === 0 ? (
                          <span
                            title="No print areas defined — the designer will have no printable zone on this product. Add at least one area."
                            className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-300">
                            ⚠ 0 areas
                          </span>
                        ) : (
                          <span className="text-gray-700">{areaCounts[t.id]}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => toggleActive(t)}
                          className={`px-2 py-1 rounded text-xs border ${
                            t.is_active ? 'bg-white text-green-700 border-green-300' : 'bg-red-50 text-red-700 border-red-300'
                          }`}>
                          {t.is_active ? 'Active' : 'Off'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button onClick={() => openEdit(t)}
                          className="px-3 py-1 rounded text-xs bg-white text-black border border-gray-300 hover:bg-gray-50">
                          Edit
                        </button>
                        <button onClick={() => deleteTemplate(t)}
                          className="ml-2 px-3 py-1 rounded text-xs bg-white text-red-600 border border-gray-300 hover:bg-red-50 hover:border-red-300">
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* ---------- EDIT ---------- */}
        {editing && (
          <div>
            <button onClick={() => { setEditing(null); load() }}
              className="text-xs font-mono text-gray-600 hover:text-[#dd3333] mb-4">← Back to templates</button>

            <div className="bg-white border border-gray-200 rounded-lg p-5 mb-6">
              <h2 className="text-sm font-mono uppercase tracking-widest text-[#dd3333] mb-4">
                {editing.id ? 'Edit template' : 'New template'}
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] text-gray-600 font-mono uppercase">Name</label>
                  <input value={draft.name}
                    onChange={e => setDraft(p => ({ ...p, name: e.target.value }))}
                    className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-sm text-black outline-none focus:border-[#dd3333] font-mono mt-1" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-600 font-mono uppercase">
                    Shopify product ID <span className="text-gray-400 normal-case">(GID form, e.g. gid://shopify/Product/…)</span>
                  </label>
                  <input value={draft.shopify_product_id}
                    onChange={e => setDraft(p => ({ ...p, shopify_product_id: e.target.value }))}
                    placeholder="gid://shopify/Product/10042340507964"
                    className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-xs text-black outline-none focus:border-[#dd3333] font-mono mt-1 placeholder-gray-400" />
                </div>
              </div>

              <div className="mt-4">
                <label className="text-[10px] text-gray-600 font-mono uppercase">
                  Category <span className="text-gray-400 normal-case">(groups + prioritizes this product in the designer&apos;s picker)</span>
                </label>
                <select value={draft.category}
                  onChange={e => setDraft(p => ({ ...p, category: e.target.value }))}
                  className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-sm text-black outline-none focus:border-[#dd3333] font-mono mt-1">
                  <option value="">— none —</option>
                  {TEMPLATE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="mt-4">
                <label className="text-[10px] text-gray-600 font-mono uppercase">Supported print methods</label>
                <div className="flex gap-4 mt-2 flex-wrap">
                  {methods.map(m => (
                    <label key={m.key} className="flex items-center gap-2 text-sm font-mono text-black">
                      <input type="checkbox"
                        checked={draft.supported_print_methods.includes(m.key)}
                        onChange={() => toggleSupported(m.key)}
                        className="accent-[#dd3333]" />
                      {labelFor(m.key)}
                    </label>
                  ))}
                </div>
              </div>

              {/* Volume discount ladder for THIS garment (per-product). Empty = no volume discount.
                  Enforced at checkout by the Shopify discount Function via the volume.tiers metafield;
                  also drives the Order-Page incentive ladder. Rows validate/sort on save. On a dual-method
                  product the default ladder applies to Print, and Embroidery can override it below. */}
              <div className="mt-5 border-t border-gray-100 pt-4">
                <label className="text-[10px] text-gray-600 font-mono uppercase">
                  Volume discount tiers{' '}
                  <span className="text-gray-400 normal-case">
                    {isDualMethod(draft) ? '(default — applies to Print, and Embroidery unless overridden below)' : '(this garment — leave empty for none)'}
                  </span>
                </label>
                <p className="text-[11px] text-gray-500 mt-1">
                  Buy N or more of this design → % off, applied automatically at checkout. e.g. 6 → 10%, 12 → 15%, 24 → 20%.
                </p>
                {ladderRows('volume_tiers')}

                {/* Embroidery override — dual-method only. Embroidery amortizes differently, so it can
                    carry its own (usually flatter) ladder; unchecked = embroidery uses the default above. */}
                {isDualMethod(draft) && (
                  <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <label className="flex items-center gap-2 text-sm font-mono text-black">
                      <input type="checkbox" checked={draft.embroideryOverride}
                        onChange={e => setDraft(p => ({ ...p, embroideryOverride: e.target.checked }))}
                        className="accent-[#dd3333]" />
                      Set different tiers for Embroidery
                    </label>
                    {draft.embroideryOverride ? (
                      <>
                        <p className="text-[11px] text-gray-500 mt-1">
                          Used when this product is designed in <span className="font-semibold">Embroidery</span> mode. Leave empty to fall back to the default ladder.
                        </p>
                        {ladderRows('volume_tiers_embroidery')}
                      </>
                    ) : (
                      <p className="text-[11px] text-gray-500 mt-1">Embroidery uses the default ladder above.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-end gap-6 flex-wrap">
                <div>
                  <label className="text-[10px] text-gray-600 font-mono uppercase">Default method (opens with)</label>
                  <select value={draft.default_print_method}
                    onChange={e => setDraft(p => ({ ...p, default_print_method: e.target.value }))}
                    className="block bg-white border border-gray-300 rounded px-2 py-1 text-sm text-black outline-none focus:border-[#dd3333] font-mono mt-1">
                    <option value="">— choose —</option>
                    {draft.supported_print_methods.map(k => (
                      <option key={k} value={k}>{labelFor(k)}</option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm font-mono text-black" title="Uncheck for products the jersey name/number stack should never go on (accessories, etc.)">
                  <input type="checkbox" checked={draft.supports_names_numbers}
                    onChange={e => setDraft(p => ({ ...p, supports_names_numbers: e.target.checked }))}
                    className="accent-[#dd3333]" />
                  Offers Names &amp; Numbers
                </label>
                <label className="flex items-center gap-2 text-sm font-mono text-black">
                  <input type="checkbox" checked={draft.is_active}
                    onChange={e => setDraft(p => ({ ...p, is_active: e.target.checked }))}
                    className="accent-[#dd3333]" />
                  Active
                </label>
                <button onClick={saveTemplate} disabled={savingTemplate}
                  className="ml-auto px-4 py-2 rounded text-sm font-mono bg-[#dd3333] text-white hover:bg-red-700 transition-all disabled:opacity-60">
                  {savingTemplate ? 'Saving…' : editing.id ? 'Save template' : 'Create template'}
                </button>
              </div>
            </div>

            {/* Print-area + color editors only once the template exists (both FK to it). */}
            {editing.id && editingTemplate ? (
              <>
                <PrintAreaEditor
                  templateId={editing.id}
                  shopifyProductId={editingTemplate.shopify_product_id}
                  supportedMethods={editingTemplate.supported_print_methods}
                  methodLabel={labelFor}
                  onMessage={showMessage}
                />
                <TemplateColorsEditor
                  templateId={editing.id}
                  shopifyProductId={editingTemplate.shopify_product_id}
                  onMessage={showMessage}
                />
              </>
            ) : (
              <p className="text-gray-500 font-mono text-xs">
                Save the template first — then you can add print areas and colors over its Shopify mockup.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
