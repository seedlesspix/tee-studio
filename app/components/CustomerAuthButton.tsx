'use client'

import { useEffect, useRef, useState } from 'react'
import { useCustomerSession } from '../hooks/useCustomerSession'

type Props = {
  // Anon "Log in" styling. 'default' is the filled-red style used on its own;
  // 'quiet' is a gray outline meant to sit next to a primary button (e.g. the
  // designer's red "Next Step") without competing with it.
  variant?: 'default' | 'quiet'
  // Optional hook run when an anonymous user clicks "Log in", before the OAuth
  // redirect. The host (the designer) uses it to snapshot in-progress work to a
  // draft and return the path to come back to afterwards
  // (e.g. "/designer?...&restore=<uuid>"). Return null to fall back to simply
  // returning to the current URL. Absent → plain login, no snapshot.
  onBeforeLogin?: () => Promise<string | null>
}

// Minimal customer auth button. Renders one of three states:
//   - loading:  a subdued placeholder (avoids flicker between logged-out
//               and logged-in on first paint).
//   - anon:     a "Log in" control that kicks off the OAuth flow.
//   - logged in: "Hi, <firstName> ▾" with a dropdown containing Logout.
export function CustomerAuthButton({ variant = 'default', onBeforeLogin }: Props) {
  const { loggedIn, customer, isLoading } = useCustomerSession()
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)
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

  // Kick off login. If a host provided onBeforeLogin (the designer), let it
  // snapshot work and choose the return path; otherwise just come back to the
  // current URL. Either way tokens are handled server-side by /api/customer/login.
  const startLogin = async () => {
    let returnTo: string | null = null
    if (onBeforeLogin) {
      setBusy(true)
      try {
        returnTo = await onBeforeLogin()
      } catch {
        returnTo = null
      }
      setBusy(false)
    }
    if (!returnTo) {
      returnTo = window.location.pathname + window.location.search
    }
    window.location.href = `/api/customer/login?return_to=${encodeURIComponent(returnTo)}`
  }

  if (isLoading) {
    return (
      <span
        className="inline-block h-8 w-20 animate-pulse rounded bg-gray-200"
        aria-hidden="true"
      />
    )
  }

  if (!loggedIn || !customer) {
    const anonClass =
      variant === 'quiet'
        ? 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
        : 'bg-[#dd3333] text-white hover:bg-[#c22a2a]'
    return (
      <button
        type="button"
        onClick={startLogin}
        disabled={busy}
        className={`inline-flex h-8 items-center rounded px-3 text-sm font-medium disabled:opacity-60 ${anonClass}`}
      >
        {busy ? 'Saving…' : 'Log in'}
      </button>
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

            return_to carries the current page (e.g. the designer URL) so the
            post-logout redirect lands back here instead of the homepage, the
            same shape as login. The menu only renders after a client-side
            click, so window is defined.
          */}
          <a
            href={`/api/customer/logout?return_to=${encodeURIComponent(
              window.location.pathname + window.location.search,
            )}`}
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
