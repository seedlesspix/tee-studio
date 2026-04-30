'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/admin/clipart', label: 'Clipart' },
  { href: '/admin/orders', label: 'Orders' },
  { href: '/admin/pricing', label: 'Pricing' },
]

export default function AdminTabs() {
  const pathname = usePathname()
  return (
    <nav className="flex gap-1">
      {tabs.map(tab => {
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
