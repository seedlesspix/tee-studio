import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const auth = cookieStore.get('admin_auth')

  if (auth?.value !== process.env.ADMIN_PASSWORD) {
    redirect('/admin-login')
  }

  return <>{children}</>
}
