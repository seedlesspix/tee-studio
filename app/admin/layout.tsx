import { redirect } from 'next/navigation'
import { createClient } from '../lib/supabase/server'
import SignOutButton from './SignOutButton'
import AdminTabs from './AdminTabs'

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
    <div className="min-h-screen bg-white text-black">
      <header className="bg-white border-b border-gray-200 px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-black text-lg tracking-widest text-black">
            TEE<span className="text-[#dd3333]">STUDIO</span>
            <span className="text-gray-500 font-mono text-xs ml-2">/ ADMIN</span>
          </span>
          <AdminTabs />
        </div>
        <div className="flex items-center gap-4">
          <a href="/designer?product_id=10043960623420&variant_id=51740953837884&title=Unisex+Heavyweight+T&price=2400"
            className="text-xs font-mono text-black hover:text-[#dd3333] transition-all">
            ← Designer
          </a>
          <span className="text-xs font-mono text-gray-600 hidden sm:inline">{user.email}</span>
          <SignOutButton />
        </div>
      </header>
      {children}
    </div>
  )
}
