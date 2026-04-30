import { redirect } from 'next/navigation'
import { createClient } from '../lib/supabase/server'
import SignOutButton from './SignOutButton'

function getAllowedEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) {
    redirect('/admin-login')
  }

  const allowed = getAllowedEmails()
  if (!allowed.includes(user.email.toLowerCase())) {
    await supabase.auth.signOut()
    redirect('/admin-login?error=not_authorized')
  }

  return (
    <>
      <header className="bg-[#0a0a0a] border-b border-[#2a2a2a] px-4 py-2 flex items-center justify-between">
        <span className="text-xs font-mono text-gray-500 uppercase tracking-widest">
          Admin · <span className="text-gray-300">{user.email}</span>
        </span>
        <SignOutButton />
      </header>
      {children}
    </>
  )
}
