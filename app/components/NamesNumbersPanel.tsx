'use client'
// Names & Numbers roster panel (the `names` rail tab). Presentational + controlled: the parent
// (DesignerCanvas) owns the roster array + the placeholder objects on the canvas. Light designer-
// panel palette; red = ACTION only (per the locked red-vocabulary rule).
import { useState } from 'react'
import { Plus, Trash2, Type, Hash, ClipboardPaste } from 'lucide-react'
import { type RosterEntry, emptyEntry, parseBulkRoster, rosterShirtCount } from '../lib/namesNumbers'

export default function NamesNumbersPanel({
  roster,
  onChange,
  onAddNameField,
  onAddNumberField,
  hasName,
  hasNumber,
  sizes = [],
}: {
  roster: RosterEntry[]
  onChange: (roster: RosterEntry[]) => void
  onAddNameField: () => void
  onAddNumberField: () => void
  hasName: boolean
  hasNumber: boolean
  sizes?: string[]
}) {
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')

  const rows = roster.length ? roster : [emptyEntry(sizes[0] ?? '')]
  const update = (i: number, patch: Partial<RosterEntry>) =>
    onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const addRow = () => onChange([...rows, emptyEntry(sizes[0] ?? '')])
  const removeRow = (i: number) => onChange(rows.filter((_, k) => k !== i).length ? rows.filter((_, k) => k !== i) : [emptyEntry(sizes[0] ?? '')])
  const applyPaste = () => {
    const parsed = parseBulkRoster(pasteText, sizes[0] ?? '')
    if (parsed.length) onChange(parsed)
    setPasteText(''); setPasteOpen(false)
  }

  const count = rosterShirtCount(rows)

  const fieldBtn = (active: boolean) =>
    `flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
      active ? 'border-gray-800 bg-gray-100 text-gray-900' : 'border-dashed border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-900'
    }`

  return (
    <div className="flex flex-col gap-3 p-3 text-gray-900">
      <div>
        <h3 className="text-sm font-semibold">Names &amp; Numbers</h3>
        <p className="mt-0.5 text-[11px] leading-snug text-gray-500">
          Add a Name and/or Number field to the shirt, then list who gets what — one shirt per row.
        </p>
      </div>

      {/* Placeholder fields on the shirt */}
      <div className="flex gap-2">
        <button type="button" onClick={onAddNameField} className={fieldBtn(hasName)}>
          <Type size={14} /> {hasName ? 'Name field ✓' : 'Add Name field'}
        </button>
        <button type="button" onClick={onAddNumberField} className={fieldBtn(hasNumber)}>
          <Hash size={14} /> {hasNumber ? 'Number field ✓' : 'Add Number field'}
        </button>
      </div>

      {/* Roster table */}
      <div className="rounded-lg border border-gray-200">
        <div className="grid grid-cols-[1fr_56px_64px_44px_28px] gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1.5 text-[10px] font-mono uppercase tracking-wide text-gray-500">
          <span>Name</span><span>Number</span><span>Size</span><span>Qty</span><span />
        </div>
        <div className="max-h-[46vh] overflow-y-auto">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_56px_64px_44px_28px] items-center gap-1 border-b border-gray-100 px-2 py-1 last:border-b-0">
              <input value={r.name} onChange={e => update(i, { name: e.target.value })} placeholder="SMITH"
                className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs outline-none focus:border-[#dd3333]" />
              <input value={r.number} onChange={e => update(i, { number: e.target.value })} placeholder="12"
                className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs outline-none focus:border-[#dd3333]" />
              {sizes.length ? (
                <select value={r.size} onChange={e => update(i, { size: e.target.value })}
                  className="w-full rounded border border-gray-200 px-1 py-1 text-xs outline-none focus:border-[#dd3333]">
                  <option value=""></option>
                  {sizes.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <input value={r.size} onChange={e => update(i, { size: e.target.value })} placeholder="L"
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs outline-none focus:border-[#dd3333]" />
              )}
              <input type="number" min={1} value={r.qty} onChange={e => update(i, { qty: Math.max(1, parseInt(e.target.value) || 1) })}
                className="w-full rounded border border-gray-200 px-1 py-1 text-xs outline-none focus:border-[#dd3333]" />
              <button type="button" onClick={() => removeRow(i)} title="Remove" className="flex justify-center text-gray-400 hover:text-[#dd3333]">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={addRow} className="flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
          <Plus size={13} /> Add row
        </button>
        <button type="button" onClick={() => setPasteOpen(v => !v)} className="flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
          <ClipboardPaste size={13} /> Paste list
        </button>
        <span className="ml-auto text-xs font-medium text-gray-600">{count} shirt{count === 1 ? '' : 's'}</span>
      </div>

      {pasteOpen && (
        <div className="flex flex-col gap-1.5">
          <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={4}
            placeholder={'Paste rows, one per line:\nSMITH  12  L  1\nJONES, 8, M, 1'}
            className="w-full rounded-lg border border-gray-300 p-2 text-xs outline-none focus:border-[#dd3333]" />
          <div className="flex gap-2">
            <button type="button" onClick={applyPaste} className="rounded-lg bg-[#dd3333] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#c62828]">Apply list</button>
            <button type="button" onClick={() => { setPasteOpen(false); setPasteText('') }} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700">Cancel</button>
          </div>
          <p className="text-[10px] text-gray-400">Tab, comma, or space separated. Replaces the current list.</p>
        </div>
      )}
    </div>
  )
}
