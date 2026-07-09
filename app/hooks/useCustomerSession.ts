'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'

// Minimal SWR-style hook for /api/customer/me. All components sharing the
// hook read from a single module-level cache, so mounting the auth button
// in five places on the same page still results in one network round-trip.
//
// The cache is intentionally small: no polling, no revalidation-on-focus,
// no error retries — page navigation is enough for our use case. `refresh`
// is exposed for the rare case where the caller knows the session changed
// (e.g., after a successful login redirect back to the SPA).
//
// Uses useSyncExternalStore so React can subscribe to the module-level cache
// without any setState-in-effect gymnastics.

export type CustomerSummary = {
  id: string
  email: string | null
  firstName: string | null
  lastName: string | null
}

export type CustomerSessionState = {
  loggedIn: boolean
  customer: CustomerSummary | null
  isLoading: boolean
  refresh: () => Promise<void>
}

type CachedResult = {
  loggedIn: boolean
  customer: CustomerSummary | null
}

let _cache: CachedResult | null = null
let _inflight: Promise<CachedResult> | null = null
const _subscribers = new Set<() => void>()

function notify(): void {
  for (const cb of _subscribers) cb()
}

async function fetchMe(): Promise<CachedResult> {
  const res = await fetch('/api/customer/me', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  })
  if (!res.ok) {
    return { loggedIn: false, customer: null }
  }
  const data = (await res.json()) as
    | { loggedIn: true; customer: CustomerSummary }
    | { loggedIn: false }
  if (data.loggedIn) {
    return { loggedIn: true, customer: data.customer }
  }
  return { loggedIn: false, customer: null }
}

async function loadOnce(force = false): Promise<CachedResult> {
  if (!force && _cache) return _cache
  // Dedup even when forced: if a fetch is already in flight it's fresh enough,
  // so piggyback on it rather than firing a parallel one. This keeps the
  // focus/visibility revalidation (which can fire from many mounted components
  // and from two events at once) from stampeding /api/customer/me.
  if (_inflight) return _inflight

  _inflight = fetchMe()
    .then((result) => {
      _cache = result
      notify()
      return result
    })
    .finally(() => {
      _inflight = null
    })
  return _inflight
}

// Cross-tab freshness without a BroadcastChannel: when a tab becomes visible or
// regains focus, revalidate. Covers the "logged in on tab A, tab B still says
// Log in" case the moment the user looks at tab B. Installed once for the whole
// app, guarded so repeated hook mounts don't stack listeners.
let _focusRevalidationInstalled = false
function installFocusRevalidation(): void {
  if (_focusRevalidationInstalled || typeof window === 'undefined') return
  _focusRevalidationInstalled = true
  const revalidate = () => {
    if (document.visibilityState === 'visible') void loadOnce(true)
  }
  document.addEventListener('visibilitychange', revalidate)
  window.addEventListener('focus', revalidate)
}

function subscribe(callback: () => void): () => void {
  _subscribers.add(callback)
  return () => {
    _subscribers.delete(callback)
  }
}

function getSnapshot(): CachedResult | null {
  return _cache
}

function getServerSnapshot(): CachedResult | null {
  // Server render always shows a logged-out placeholder — we don't have
  // session cookies plumbed through the render layer, and this hook is
  // client-only anyway.
  return null
}

export function useCustomerSession(): CustomerSessionState {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  useEffect(() => {
    installFocusRevalidation()
    if (!_cache && !_inflight) {
      void loadOnce()
    }
  }, [])

  const refresh = useCallback(async () => {
    await loadOnce(true)
  }, [])

  return {
    loggedIn: state?.loggedIn ?? false,
    customer: state?.customer ?? null,
    isLoading: state === null,
    refresh,
  }
}
