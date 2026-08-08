'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { groupedStrings, UI_STRINGS } from '../../lib/uiStrings'

// Language editor (BETA item 9). Every registered string (app/lib/uiStrings.ts) grouped by area, each
// editable inline. Save writes an override to ui_strings; Reset deletes it (back to the code default).
export default function LanguageAdmin() {
  const groups = groupedStrings()
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const showMessage = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type }); setTimeout(() => setMessage(null), 2500)
  }

  const load = () =>
    supabase.from('ui_strings').select('key, value').then(({ data }) => {
      const m: Record<string, string> = {}
      for (const r of data ?? []) m[r.key] = r.value
      setOverrides(m); setLoading(false)
    })
  useEffect(() => { load() }, [])

  const defaultOf = (key: string) => UI_STRINGS[key as keyof typeof UI_STRINGS]?.default ?? ''
  const currentValue = (key: string) => draft[key] ?? overrides[key] ?? defaultOf(key)
  const isOverridden = (key: string) => overrides[key] !== undefined
  const isEdited = (key: string) => draft[key] !== undefined && draft[key] !== (overrides[key] ?? defaultOf(key))

  const save = async (key: string) => {
    const value = (draft[key] ?? '').trim()
    if (!value) { showMessage('Wording can’t be empty — use Reset to go back to the default.', 'error'); return }
    setBusyKey(key)
    const { error } = await supabase.from('ui_strings').upsert({ key, value }, { onConflict: 'key' })
    setBusyKey(null)
    if (error) { showMessage('Error: ' + error.message, 'error'); return }
    setOverrides(prev => ({ ...prev, [key]: value }))
    setDraft(prev => { const n = { ...prev }; delete n[key]; return n })
    showMessage('Saved!')
  }

  const reset = async (key: string) => {
    setBusyKey(key)
    const { error } = await supabase.from('ui_strings').delete().eq('key', key)
    setBusyKey(null)
    if (error) { showMessage('Error: ' + error.message, 'error'); return }
    setOverrides(prev => { const n = { ...prev }; delete n[key]; return n })
    setDraft(prev => { const n = { ...prev }; delete n[key]; return n })
    showMessage('Reset to default.')
  }

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-mono font-bold text-black">Language</h1>
        {message && (
          <span className={`text-sm font-mono ${message.type === 'error' ? 'text-red-600' : 'text-green-600'}`}>{message.text}</span>
        )}
      </div>
      <p className="text-gray-600 text-sm mb-6">
        Reword any customer- or admin-facing text. The box shows the current wording; <strong>Save</strong> applies your
        change, <strong>Reset</strong> removes it and goes back to the built-in default. Changes appear on the next page load.
      </p>

      {loading ? (
        <p className="text-gray-500 font-mono text-sm">Loading…</p>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map(({ group, items }) => (
            <div key={group}>
              <h2 className="text-sm font-mono uppercase tracking-widest text-[#dd3333] mb-3">{group}</h2>
              <div className="flex flex-col gap-3">
                {items.map(({ key, def }) => (
                  <div key={key} className="bg-white border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs text-gray-600">{def.desc}</span>
                      {isOverridden(key) && (
                        <span className="shrink-0 text-[10px] font-mono uppercase tracking-wide bg-amber-100 text-amber-800 rounded px-1.5 py-0.5">
                          customized
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        value={currentValue(key)}
                        onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))}
                        className="flex-1 bg-white border border-gray-300 rounded px-2.5 py-1.5 text-sm text-black outline-none focus:border-[#dd3333]"
                      />
                      <button onClick={() => save(key)} disabled={!isEdited(key) || busyKey === key}
                        className="px-3 py-1.5 rounded text-xs font-mono bg-[#dd3333] text-white hover:bg-red-700 transition-all disabled:opacity-40">
                        Save
                      </button>
                      <button onClick={() => reset(key)} disabled={!isOverridden(key) || busyKey === key}
                        className="px-3 py-1.5 rounded text-xs font-mono bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:opacity-40">
                        Reset
                      </button>
                    </div>
                    <p className="mt-1.5 text-[10px] font-mono text-gray-400">default: “{def.default}” · key: {key}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  )
}
