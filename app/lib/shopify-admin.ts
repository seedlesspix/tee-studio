// Shopify Admin API client (Phase 4, server-only — never import from a client
// component). The Dev Dashboard app "Tee Studio Server" has NO static token:
// the server mints short-lived Admin tokens itself via the client-credentials
// grant and caches them in module scope. Day-1 probe ground truth (2026-07-16):
// mint returns { access_token, scope, expires_in: 86399 } (~24h); we re-mint
// 1h before expiry so a token never goes stale mid-request.
//
// Rate-limit ground truth: bucket 2000 pts, restore 100 pts/s (Standard tier).
// Measured costs: productSet ~23 pts, publishablePublish 10 pts,
// productDelete 10 pts — a full design cart is a rounding error.

const API_VERSION = '2026-01'

type CachedToken = { token: string; expiresAt: number }
let cachedToken: CachedToken | null = null
let mintInFlight: Promise<CachedToken> | null = null

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`shopify-admin: missing env var ${name}`)
  return value
}

async function mintToken(): Promise<CachedToken> {
  const domain = env('SHOPIFY_ADMIN_DOMAIN')
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env('SHOPIFY_ADMIN_CLIENT_ID'),
      client_secret: env('SHOPIFY_ADMIN_CLIENT_SECRET'),
    }),
  })
  if (!res.ok) {
    // Error bodies are Shopify's OAuth error page (HTML) or JSON — they never
    // contain a token, so a short slice is safe to surface in logs.
    const detail = (await res.text()).replace(/<[^>]*>/g, ' ').slice(0, 200)
    throw new Error(`shopify-admin: token mint failed (HTTP ${res.status}): ${detail}`)
  }
  const data = (await res.json()) as { access_token: string; expires_in: number }
  return {
    token: data.access_token,
    // refresh 1h early; floor at 60s in case Shopify ever shortens expires_in
    expiresAt: Date.now() + Math.max(data.expires_in - 3600, 60) * 1000,
  }
}

async function getToken(forceFresh = false): Promise<string> {
  if (!forceFresh && cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token
  }
  // single-flight: concurrent callers share one mint instead of stampeding
  if (!mintInFlight) {
    mintInFlight = mintToken().finally(() => {
      mintInFlight = null
    })
  }
  cachedToken = await mintInFlight
  return cachedToken.token
}

/**
 * Run an Admin GraphQL operation. Throws on transport or GraphQL-level errors;
 * mutation userErrors are returned in `data` for the caller to handle (they're
 * per-field business errors, not transport failures).
 */
export async function adminGraphQL<T = unknown>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const domain = env('SHOPIFY_ADMIN_DOMAIN')
  const exec = (token: string) =>
    fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    })

  let res = await exec(await getToken())
  if (res.status === 401) {
    // token revoked/rotated server-side — mint fresh once and retry
    res = await exec(await getToken(true))
  }
  if (!res.ok) {
    throw new Error(`shopify-admin: GraphQL HTTP ${res.status}`)
  }
  const json = (await res.json()) as {
    data?: T
    errors?: Array<{ message: string }>
  }
  if (json.errors?.length) {
    throw new Error(
      `shopify-admin: GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`
    )
  }
  if (json.data === undefined) {
    throw new Error('shopify-admin: GraphQL response had no data')
  }
  return json.data
}

// Channel map, proven empirically on Day 1 (publish to Headless only →
// Storefront API getProduct visible; Online Store URL still 404):
export const PUBLICATION_ONLINE_STORE = 'gid://shopify/Publication/2110128158'
export const PUBLICATION_HEADLESS = 'gid://shopify/Publication/291451601212'
