'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../components/StringsProvider'
import type { Tables } from '@/types/database'

// This admin manages ONLY the Front/Back rows (sides 1/2). The new sleeve/hat zone rows have sides=NULL
// and no zone editor here yet (named follow-up before Print-Zones cutover), so they're filtered out at
// load and this type asserts the non-null sides the screen relies on.
type PricingRow = Omit<Tables<'designer_pricing'>, 'sides'> & { sides: number }
type PrintMethod = Tables<'designer_print_methods'>

// designer_pricing.sides is a SIDE IDENTITY, not a count: 1 = Front, 2 = Back.
// Each row is an independent per-side surcharge (see CLAUDE.md "designer_pricing
// operational rules"). The check constraint restricts sides to 1 or 2.
const SIDE_LABEL: Record<number, string> = { 1: 'Front', 2: 'Back' }

type EditFields = { price_add: string; label: string; shopify_variant_id: string }
type NewFields = { sides: string; price_add: string; label: string; shopify_variant_id: string }

const EMPTY_NEW: NewFields = { sides: '1', price_add: '0', label: '', shopify_variant_id: '' }

export default function PricingAdmin() {
  const t = useT()
  const [pricing, setPricing] = useState<PricingRow[]>([])
  const [methods, setMethods] = useState<PrintMethod[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [editValues, setEditValues] = useState<Record<string, EditFields>>({})

  // Inline add-row form: which method_key it's open for, its field values,
  // and an in-flight flag.
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [newRow, setNewRow] = useState<NewFields>(EMPTY_NEW)
  const [creating, setCreating] = useState(false)

  const showMessage = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  const seedEditValues = (rows: PricingRow[]) => {
    const vals: Record<string, EditFields> = {}
    rows.forEach(row => {
      vals[row.id] = {
        price_add: row.price_add.toString(),
        label: row.label,
        shopify_variant_id: row.shopify_variant_id ?? '',
      }
    })
    setEditValues(vals)
  }

  // Phase 4 Day 6: the variant-reachability check (and /api/admin/variant-check)
  // is deleted with the rest of the Print Charge cart machinery. Checkout no
  // longer adds Print Charge line items — price_add folds into the design
  // product's per-shirt price — so shopify_variant_id is legacy config that
  // can't fail a cart anymore.

  useEffect(() => {
    Promise.all([
      supabase.from('designer_pricing').select('*').order('print_method_key').order('sides'),
      supabase.from('designer_print_methods').select('*').order('sort_order'),
    ]).then(([p, m]) => {
      if (p.data) {
        // Front/Back rows only (sides 1/2); sleeve/hat zone rows (sides NULL) aren't editable here yet.
        const frontBack = p.data.filter(r => r.sides != null) as PricingRow[]
        setPricing(frontBack)
        seedEditValues(frontBack)
      }
      if (m.data) setMethods(m.data)
      setLoading(false)
    })
  }, [])

  const saveRow = async (row: PricingRow) => {
    setSaving(row.id)
    const vals = editValues[row.id]
    // Empty variant field → NULL (the resolver treats NULL as "not configured").
    const variant = vals.shopify_variant_id.trim() || null
    const price = parseFloat(vals.price_add) || 0
    const { error } = await supabase
      .from('designer_pricing')
      .update({ price_add: price, label: vals.label, shopify_variant_id: variant })
      .eq('id', row.id)
    setSaving(null)
    if (error) { showMessage('Error: ' + error.message, 'error'); return }
    showMessage('Saved!')
    setPricing(prev => prev.map(r => r.id === row.id
      ? { ...r, price_add: price, label: vals.label, shopify_variant_id: variant }
      : r))
  }

  // Whether a row's edit fields differ from what's persisted. Drives the
  // "Unsaved" marker and the Save button state so it's obvious an edit —
  // including the Shopify Variant ID — hasn't taken effect until Save is
  // clicked (the field does not save on blur).
  const rowDirty = (row: PricingRow): boolean => {
    const v = editValues[row.id]
    if (!v) return false
    return (
      v.label !== row.label ||
      (parseFloat(v.price_add) || 0) !== row.price_add ||
      (v.shopify_variant_id.trim() || null) !== (row.shopify_variant_id ?? null)
    )
  }

  const toggleActive = async (row: PricingRow) => {
    const { error } = await supabase
      .from('designer_pricing')
      .update({ is_active: !row.is_active })
      .eq('id', row.id)
    if (error) { showMessage('Error: ' + error.message, 'error'); return }
    setPricing(prev => prev.map(r => r.id === row.id ? { ...r, is_active: !r.is_active } : r))
  }

  const deleteRow = async (row: PricingRow) => {
    if (!confirm(`Delete the ${labelFor(row.print_method_key)} · ${SIDE_LABEL[row.sides] ?? row.sides} pricing row? This cannot be undone.`)) return
    const { error } = await supabase.from('designer_pricing').delete().eq('id', row.id)
    if (error) { showMessage('Error deleting: ' + error.message, 'error'); return }
    setPricing(prev => prev.filter(r => r.id !== row.id))
    showMessage('Deleted!')
  }

  const openAdd = (methodKey: string) => {
    setAddingFor(methodKey)
    setNewRow(EMPTY_NEW)
  }

  const createRow = async (methodKey: string) => {
    const sides = parseInt(newRow.sides, 10)
    if (sides !== 1 && sides !== 2) { showMessage('Side must be Front (1) or Back (2).', 'error'); return }
    // Guard against a duplicate (method × side) — no DB unique constraint exists,
    // and two rows for the same side would make the resolver ambiguous.
    if (pricing.some(r => r.print_method_key === methodKey && r.sides === sides)) {
      showMessage(`A ${SIDE_LABEL[sides]} row already exists for ${labelFor(methodKey)}.`, 'error')
      return
    }
    setCreating(true)
    const { data, error } = await supabase
      .from('designer_pricing')
      .insert({
        print_method_key: methodKey,
        sides,
        price_add: parseFloat(newRow.price_add) || 0,
        label: newRow.label.trim(),
        shopify_variant_id: newRow.shopify_variant_id.trim() || null,
        is_active: true,
      })
      .select()
      .single()
    setCreating(false)
    if (error) { showMessage('Error: ' + error.message, 'error'); return }
    if (data) {
      setPricing(prev => [...prev, data as PricingRow].sort(
        (a, b) => a.print_method_key.localeCompare(b.print_method_key) || a.sides - b.sides
      ))
      setEditValues(prev => ({
        ...prev,
        [data.id]: { price_add: data.price_add.toString(), label: data.label, shopify_variant_id: data.shopify_variant_id ?? '' },
      }))
      setAddingFor(null)
      showMessage('Row added!')
    }
  }

  // Group rows by method, and make sure every registered method shows up even
  // if it has zero rows yet (so you can add its first row).
  const grouped = pricing.reduce((acc, row) => {
    (acc[row.print_method_key] ||= []).push(row)
    return acc
  }, {} as Record<string, PricingRow[]>)
  const methodKeys = methods.length
    ? methods.map(m => m.key)
    : Object.keys(grouped)
  methodKeys.forEach(k => { grouped[k] ||= [] })

  const labelFor = (key: string) => {
    const s = t('method.' + key)
    return s.startsWith('method.') ? (methods.find(m => m.key === key)?.label ?? key.replace('_', ' ')) : s
  }

  return (
    <div className="p-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-mono font-bold text-black">Print Pricing</h1>
          <p className="text-gray-600 text-sm font-mono mt-1">Set print charges added to the blank product price</p>
        </div>

        {message && (
          <div className={`fixed top-6 right-6 px-4 py-3 rounded font-mono text-sm z-50 ${
            message.type === 'success' ? 'bg-[#dd3333] text-white' : 'bg-red-600 text-white'
          }`}>
            {message.text}
          </div>
        )}

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
          <h2 className="text-xs font-mono uppercase tracking-widest text-gray-600 mb-2">How it works</h2>
          <p className="text-sm text-black font-mono">
            Each row is a <span className="text-[#dd3333]">per-side</span> charge added to the blank price.
            <span className="text-[#dd3333]"> Front</span> (side 1) and <span className="text-[#dd3333]">Back</span> (side 2) are charged independently.<br />
            Example: $22.00 blank + $12.00 Front + $12.00 Back = <span className="text-[#dd3333]">$46.00 per item</span> for a 2-sided design.
          </p>
          <p className="text-xs text-gray-600 font-mono mt-2">
            These charges are <span className="text-black">folded into the per-shirt price</span> at checkout.
            The Shopify Variant ID field is legacy (pre&ndash;Phase 4 cart) — checkout no longer uses it.
            Embroidery is dormant: its cost is baked into the base product price.
          </p>
        </div>

        {loading ? (
          <p className="text-gray-600 font-mono text-center py-12">Loading...</p>
        ) : (
          <div className="flex flex-col gap-8">
            {methodKeys.map(method => (
              <div key={method}>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-mono uppercase tracking-widest text-[#dd3333]">{labelFor(method)}</h2>
                  {addingFor !== method && (
                    <button onClick={() => openAdd(method)}
                      className="text-xs text-[#dd3333] font-mono hover:text-red-700 transition-all">+ Add row</button>
                  )}
                </div>

                <div className="flex flex-col gap-3">
                  {grouped[method].map(row => (
                    <div key={row.id} className={`bg-white border rounded-lg p-4 ${row.is_active ? 'border-gray-200' : 'border-red-300 opacity-60'}`}>
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-gray-100 flex flex-col items-center justify-center shrink-0">
                          <span className="text-xl font-black text-[#dd3333]">{row.sides}</span>
                          <span className="text-[9px] text-gray-600 font-mono">{SIDE_LABEL[row.sides] ?? 'side'}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <label className="text-[10px] text-gray-600 font-mono uppercase">Label</label>
                          <input
                            value={editValues[row.id]?.label ?? ''}
                            onChange={e => setEditValues(prev => ({ ...prev, [row.id]: { ...prev[row.id], label: e.target.value } }))}
                            className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-sm text-black outline-none focus:border-[#dd3333] font-mono mt-1"
                          />
                          <label className="text-[10px] text-gray-600 font-mono uppercase mt-2 block">Shopify Variant ID <span className="normal-case text-gray-400">(legacy — unused by checkout)</span></label>
                          <input
                            value={editValues[row.id]?.shopify_variant_id ?? ''}
                            onChange={e => setEditValues(prev => ({ ...prev, [row.id]: { ...prev[row.id], shopify_variant_id: e.target.value } }))}
                            placeholder="legacy — leave blank"
                            className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-xs text-black outline-none focus:border-[#dd3333] font-mono mt-1 placeholder-gray-400"
                          />
                        </div>
                        <div className="w-28 shrink-0">
                          <label className="text-[10px] text-gray-600 font-mono uppercase">Add to price</label>
                          <div className="flex items-center mt-1">
                            <span className="text-black font-mono text-sm mr-1">$</span>
                            <input
                              type="number" step="0.01" min="0"
                              value={editValues[row.id]?.price_add ?? ''}
                              onChange={e => setEditValues(prev => ({ ...prev, [row.id]: { ...prev[row.id], price_add: e.target.value } }))}
                              className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-sm text-black outline-none focus:border-[#dd3333] font-mono"
                            />
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 shrink-0">
                          {rowDirty(row) && (
                            <span className="text-[10px] font-mono text-amber-600 text-center">● Unsaved</span>
                          )}
                          <button
                            onClick={() => saveRow(row)}
                            disabled={saving !== row.id && !rowDirty(row)}
                            title="Saves this row's label, price, and Shopify Variant ID"
                            className={`px-3 py-2 rounded text-xs font-mono transition-all ${
                              rowDirty(row)
                                ? 'bg-[#dd3333] text-white hover:bg-red-700'
                                : 'bg-gray-100 text-gray-400 cursor-default'
                            }`}
                          >
                            {saving === row.id ? '...' : rowDirty(row) ? 'Save' : 'Saved ✓'}
                          </button>
                          <button onClick={() => toggleActive(row)} className={`px-3 py-2 rounded text-xs font-mono transition-all border ${row.is_active ? 'bg-white text-green-700 border-green-300' : 'bg-red-50 text-red-700 border-red-300'}`}>
                            {row.is_active ? 'Active' : 'Off'}
                          </button>
                          <button onClick={() => deleteRow(row)} className="px-3 py-2 rounded text-xs font-mono bg-white text-red-600 border border-gray-300 hover:bg-red-50 hover:border-red-300 transition-all">
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}

                  {grouped[method].length === 0 && addingFor !== method && (
                    <p className="text-gray-500 font-mono text-xs py-2">No pricing rows yet. Use “+ Add row”.</p>
                  )}

                  {addingFor === method && (
                    <div className="bg-white border border-[#dd3333] rounded-lg p-4">
                      <div className="flex items-end gap-3 flex-wrap">
                        <div className="w-28">
                          <label className="text-[10px] text-gray-600 font-mono uppercase">Side</label>
                          <select
                            value={newRow.sides}
                            onChange={e => setNewRow(prev => ({ ...prev, sides: e.target.value }))}
                            className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-sm text-black outline-none focus:border-[#dd3333] font-mono mt-1"
                          >
                            <option value="1">1 — Front</option>
                            <option value="2">2 — Back</option>
                          </select>
                        </div>
                        <div className="w-24">
                          <label className="text-[10px] text-gray-600 font-mono uppercase">Add to price</label>
                          <div className="flex items-center mt-1">
                            <span className="text-black font-mono text-sm mr-1">$</span>
                            <input
                              type="number" step="0.01" min="0"
                              value={newRow.price_add}
                              onChange={e => setNewRow(prev => ({ ...prev, price_add: e.target.value }))}
                              className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-sm text-black outline-none focus:border-[#dd3333] font-mono"
                            />
                          </div>
                        </div>
                        <div className="flex-1 min-w-[8rem]">
                          <label className="text-[10px] text-gray-600 font-mono uppercase">Label</label>
                          <input
                            value={newRow.label}
                            onChange={e => setNewRow(prev => ({ ...prev, label: e.target.value }))}
                            placeholder="e.g. Front Print"
                            className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-sm text-black outline-none focus:border-[#dd3333] font-mono mt-1 placeholder-gray-400"
                          />
                        </div>
                        <div className="flex-1 min-w-[10rem]">
                          <label className="text-[10px] text-gray-600 font-mono uppercase">Shopify Variant ID</label>
                          <input
                            value={newRow.shopify_variant_id}
                            onChange={e => setNewRow(prev => ({ ...prev, shopify_variant_id: e.target.value }))}
                            placeholder={method === 'screen_print' ? 'required' : 'dormant — optional'}
                            className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-xs text-black outline-none focus:border-[#dd3333] font-mono mt-1 placeholder-gray-400"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => createRow(method)} disabled={creating}
                            className="px-3 py-2 rounded text-xs font-mono bg-[#dd3333] text-white hover:bg-red-700 transition-all disabled:opacity-60">
                            {creating ? '...' : 'Add'}
                          </button>
                          <button onClick={() => setAddingFor(null)}
                            className="px-3 py-2 rounded text-xs font-mono bg-white text-black border border-gray-300 hover:bg-gray-50 transition-all">
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
