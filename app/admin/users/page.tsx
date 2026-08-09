'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Owner-only admin management (BETA #23). Everyone in `admins` gets full admin access; only the OWNER
// can add/remove. The admins table RLS enforces owner-only writes, so this screen is safe even if a
// non-owner reaches it — but we also gate the UI (restricted message) for clarity. Guards: can't remove
// yourself, can't remove the owner, can't remove the last admin.
type Admin = { email: string; is_owner: boolean; note: string | null; created_at: string }

export default function AdminsPage() {
  const [me, setMe] = useState<string | null>(null)
  const [isOwner, setIsOwner] = useState<boolean | null>(null) // null = still checking
  const [admins, setAdmins] = useState<Admin[]>([])
  const [newEmail, setNewEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const showMessage = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type }); setTimeout(() => setMessage(null), 3500)
  }

  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    setMe(user?.email?.toLowerCase() ?? null)
    const { data: owner } = await supabase.rpc('is_admin_owner')
    setIsOwner(!!owner)
    if (owner) {
      const { data } = await supabase
        .from('admins').select('email, is_owner, note, created_at')
        .order('is_owner', { ascending: false }).order('email')
      setAdmins((data as Admin[]) ?? [])
    }
  }
  useEffect(() => { load() }, [])

  const add = async () => {
    const email = newEmail.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showMessage('Enter a valid email address.', 'error'); return }
    if (admins.some(a => a.email === email)) { showMessage('That email is already an admin.', 'error'); return }
    setBusy(true)
    const { error } = await supabase.from('admins').insert({ email, is_owner: false, added_by: me })
    setBusy(false)
    if (error) { showMessage('Error: ' + error.message, 'error'); return }
    setNewEmail(''); showMessage(`Added ${email}. They can sign in at the admin login with an emailed code.`)
    load()
  }

  const remove = async (a: Admin) => {
    if (a.email === me) { showMessage("You can't remove yourself.", 'error'); return }
    if (a.is_owner) { showMessage("The owner can't be removed.", 'error'); return }
    if (admins.length <= 1) { showMessage("Can't remove the last admin.", 'error'); return }
    if (!confirm(`Remove ${a.email} from the admins? They'll lose access immediately.`)) return
    setBusy(true)
    const { error } = await supabase.from('admins').delete().eq('email', a.email)
    setBusy(false)
    if (error) { showMessage('Error: ' + error.message, 'error'); return }
    showMessage(`Removed ${a.email}.`); load()
  }

  if (isOwner === null) {
    return <div className="p-6 max-w-3xl mx-auto"><p className="text-gray-500 font-mono text-sm">Loading…</p></div>
  }
  if (!isOwner) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <h1 className="text-2xl font-mono font-bold text-black mb-2">Admins</h1>
        <p className="text-gray-600 text-sm">Only the account owner can add or remove admins.</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-mono font-bold text-black">Admins</h1>
        {message && (
          <span className={`text-sm font-mono ${message.type === 'error' ? 'text-red-600' : 'text-green-600'}`}>{message.text}</span>
        )}
      </div>
      <p className="text-gray-600 text-sm mb-6">
        Everyone here has full admin access. Add someone by email — they then sign in at the admin login
        with an emailed code (no account setup). Only you (the owner) can manage this list.
      </p>

      <div className="flex gap-2 mb-6">
        <input
          type="email" value={newEmail} placeholder="name@example.com"
          onChange={e => setNewEmail(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          className="flex-1 bg-white border border-gray-300 rounded px-3 py-2 text-sm text-black outline-none focus:border-[#dd3333]"
        />
        <button onClick={add} disabled={busy || !newEmail.trim()}
          className="px-4 py-2 rounded text-sm font-mono bg-[#dd3333] text-white hover:bg-red-700 transition-all disabled:opacity-40">
          Add admin
        </button>
      </div>

      <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
        {admins.map(a => (
          <div key={a.email} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <span className="text-sm text-black font-mono truncate">{a.email}</span>
              {a.is_owner && (
                <span className="ml-2 text-[10px] font-mono uppercase tracking-wide bg-gray-900 text-white rounded px-1.5 py-0.5">Owner</span>
              )}
              {a.email === me && !a.is_owner && (
                <span className="ml-2 text-[10px] font-mono uppercase tracking-wide bg-gray-200 text-gray-700 rounded px-1.5 py-0.5">You</span>
              )}
            </div>
            <button
              onClick={() => remove(a)}
              disabled={busy || a.email === me || a.is_owner || admins.length <= 1}
              title={a.is_owner ? "The owner can't be removed" : a.email === me ? "You can't remove yourself" : 'Remove'}
              className="shrink-0 px-3 py-1 rounded text-xs bg-white text-red-600 border border-gray-300 hover:bg-red-50 hover:border-red-300 disabled:opacity-30 disabled:hover:bg-white disabled:hover:border-gray-300">
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
