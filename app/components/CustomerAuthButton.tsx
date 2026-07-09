'use client'

import { useEffect, useRef, useState } from 'react'
import { useCustomerSession } from '../hooks/useCustomerSession'

// Minimal customer auth button. Renders one of three states:
//   - loading:  a subdued placeholder (avoids flicker between logged-out
//               and logged-in on first paint).
//   - anon:     a "Log in" link that kicks off the OAuth flow.
//   - logged in: "Hi, <firstName> ▾" with a dropdown containing Logout.
//
// Styling is deliberately minimal — Day 5 will restyle this when it gets
// embedded in the designer's top bar.
export function CustomerAuthButton() {
  const { loggedIn, customer, isLoading } = useCustomerSession()
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onClickOutside = (e: MouseEvent) => {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [menuOpen])

  if (isLoading) {
    return (
      <span
        className="inline-block h-8 w-20 animate-pulse rounded bg-gray-200"
        aria-hidden="true"
      />
    )
  }

  if (!loggedIn || !customer) {
    return (
      <a
        href="/api/customer/login"
        className="inline-flex h-8 items-center rounded bg-[#dd3333] px-3 text-sm font-medium text-white hover:bg-[#c22a2a]"
      >
        Log in
      </a>
    )
  }

  const displayName =
    customer.firstName?.trim() || customer.email?.split('@')[0] || 'there'

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="inline-flex h-8 items-center gap-1 rounded border border-gray-300 bg-white px-3 text-sm font-medium text-black hover:bg-gray-50"
      >
        <span>Hi, {displayName}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 w-40 rounded border border-gray-200 bg-white shadow-md"
        >
          {/*
            Plain GET link (not a POST form): the browser navigates to the
            logout route with GET, so the method stays GET all the way through
            to Shopify's end_session_endpoint, which only accepts GET. A POST
            form here relied on the route's 303 downgrading POST→GET on the
            redirect; a GET link removes that dependency entirely. CSRF risk is
            negligible — the worst case is an unwanted logout, no data exposure.
          */}
          <a
            href="/api/customer/logout"
            role="menuitem"
            className="block w-full px-3 py-2 text-left text-sm text-black hover:bg-gray-100"
          >
            Log out
          </a>
        </div>
      )}
    </div>
  )
}
