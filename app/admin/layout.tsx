import { redirect } from 'next/navigation'
import { createClient } from '../lib/supabase/server'
import SignOutButton from './SignOutButton'
import AdminTabs from './AdminTabs'
import BrandMark from '../components/BrandMark'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user?.email) {
    redirect('/admin-login')
  }

  // Admin access is now the `admins` list (BETA #23) — is_admin() checks it by email. is_admin_owner()
  // gates the owner-only Admins screen. Both are SECURITY DEFINER so they read the list regardless of RLS.
  const [{ data: isAdmin }, { data: isOwner }] = await Promise.all([
    supabase.rpc('is_admin'),
    supabase.rpc('is_admin_owner'),
  ])
  if (!isAdmin) {
    await supabase.auth.signOut()
    redirect('/admin-login?error=not_authorized')
  }

  return (
    <div className="min-h-screen bg-white text-black">
      <header className="bg-white border-b border-gray-200 px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-black text-lg tracking-widest text-black">
            <BrandMark />
            <span className="text-gray-500 font-mono text-xs ml-2">/ ADMIN</span>
          </span>
          <AdminTabs isOwner={!!isOwner} />
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
