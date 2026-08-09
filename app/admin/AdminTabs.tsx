'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Order per Denise (BETA #18): Orders / Pricing / Templates / Clipart / Fonts / Colors, then Language.
const tabs = [
  { href: '/admin/orders', label: 'Orders' },
  { href: '/admin/pricing', label: 'Pricing' },
  { href: '/admin/templates', label: 'Templates' },
  { href: '/admin/clipart', label: 'Clipart' },
  { href: '/admin/fonts', label: 'Fonts' },
  { href: '/admin/colors', label: 'Colors' },
  { href: '/admin/language', label: 'Language' },
]

// The Admins screen is OWNER-only (BETA #23), so its tab shows only for the owner.
export default function AdminTabs({ isOwner = false }: { isOwner?: boolean }) {
  const pathname = usePathname()
  const shown = isOwner ? [...tabs, { href: '/admin/users', label: 'Admins' }] : tabs
  return (
    <nav className="flex gap-1">
      {shown.map(tab => {
        const active = pathname === tab.href || pathname?.startsWith(tab.href + '/')
        return (
          <Link key={tab.href} href={tab.href}
            className={`px-3 py-1.5 rounded text-xs font-mono uppercase tracking-wide transition-all ${
              active
                ? 'bg-[#dd3333] text-white font-bold'
                : 'text-black hover:bg-gray-100'
            }`}>
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
