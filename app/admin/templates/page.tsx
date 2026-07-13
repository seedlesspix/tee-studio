'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { normalizeShopifyProductId } from '../../lib/productImages'
import type { Tables } from '@/types/database'
import PrintAreaEditor from './PrintAreaEditor'
import TemplateColorsEditor from './TemplateColorsEditor'

type Template = Tables<'product_templates'>
type PrintMethod = Tables<'designer_print_methods'>

type Draft = {
  name: string
  shopify_product_id: string
  supported_print_methods: string[]
  default_print_method: string
  is_active: boolean
}

const EMPTY_DRAFT: Draft = {
  name: '',
  shopify_product_id: '',
  supported_print_methods: [],
  default_print_method: '',
  is_active: true,
}

export default function TemplatesAdmin() {
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

  const showMessage = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
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

  const labelFor = (key: string) => methods.find(m => m.key === key)?.label ?? key.replace('_', ' ')

  const openNew = () => { setDraft(EMPTY_DRAFT); setEditing({ id: null }) }
  const openEdit = (t: Template) => {
    setDraft({
      name: t.name,
      shopify_product_id: t.shopify_product_id,
      supported_print_methods: [...t.supported_print_methods],
      default_print_method: t.default_print_method,
      is_active: t.is_active,
    })
    setEditing({ id: t.id })
  }

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
      supported_print_methods: draft.supported_print_methods,
      default_print_method: draft.default_print_method,
      is_active: draft.is_active,
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
                    <th className="text-left px-4 py-3">Name</th>
                    <th className="text-left px-4 py-3">Shopify product</th>
                    <th className="text-left px-4 py-3">Methods</th>
                    <th className="text-left px-4 py-3">Areas</th>
                    <th className="text-left px-4 py-3">Active</th>
                    <th className="text-right px-4 py-3">Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map(t => (
                    <tr key={t.id} className={`border-t border-gray-100 ${t.is_active ? '' : 'opacity-60'}`}>
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
                <label className="text-[10px] text-gray-600 font-mono uppercase">Supported print methods</label>
                <div className="flex gap-4 mt-2 flex-wrap">
                  {methods.map(m => (
                    <label key={m.key} className="flex items-center gap-2 text-sm font-mono text-black">
                      <input type="checkbox"
                        checked={draft.supported_print_methods.includes(m.key)}
                        onChange={() => toggleSupported(m.key)}
                        className="accent-[#dd3333]" />
                      {m.label}
                    </label>
                  ))}
                </div>
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
