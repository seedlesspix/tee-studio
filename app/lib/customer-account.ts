import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'

// Subset of the OIDC discovery doc fields we use.
type DiscoveryDoc = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  end_session_endpoint: string
  jwks_uri: string
}

// Module-level cache. Discovery responses are stable for hours; refetching
// on every request would add latency for no benefit. Refresh hourly.
let _discoveryCache: { doc: DiscoveryDoc; fetchedAt: number } | null = null
const DISCOVERY_TTL_MS = 60 * 60 * 1000

export async function getDiscovery(): Promise<DiscoveryDoc> {
  if (_discoveryCache && Date.now() - _discoveryCache.fetchedAt < DISCOVERY_TTL_MS) {
    return _discoveryCache.doc
  }

  const domain = process.env.SHOPIFY_STOREFRONT_DOMAIN
  if (!domain) throw new Error('SHOPIFY_STOREFRONT_DOMAIN is not configured')

  const url = `https://${domain}/.well-known/openid-configuration`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    throw new Error(`Failed to fetch OIDC discovery doc from ${url} (HTTP ${res.status})`)
  }

  const doc = (await res.json()) as DiscoveryDoc
  for (const key of [
    'issuer',
    'authorization_endpoint',
    'token_endpoint',
    'end_session_endpoint',
    'jwks_uri',
  ] as const) {
    if (typeof doc[key] !== 'string') {
      throw new Error(`Discovery doc missing or invalid field: ${key}`)
    }
  }

  _discoveryCache = { doc, fetchedAt: Date.now() }
  return doc
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

// PKCE per RFC 7636: 256-bit random verifier, S256 challenge.
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

// 256-bit random base64url. Used for OAuth `state` (CSRF) and OIDC `nonce`
// (replay protection on the ID token).
export function generateRandom(): string {
  return b64url(randomBytes(32))
}

export type AuthorizeParams = {
  state: string
  nonce: string
  codeChallenge: string
  redirectUri: string
}

export async function buildAuthorizeUrl(params: AuthorizeParams): Promise<string> {
  const { authorization_endpoint } = await getDiscovery()

  const clientId = process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID
  if (!clientId) throw new Error('SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID is not configured')

  const url = new URL(authorization_endpoint)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', params.redirectUri)
  // If Shopify returns a scope error during consent, fall back to the
  // explicit pair: 'openid email customer-account-api:read customer-account-api:write'.
  url.searchParams.set('scope', 'openid email customer-account-api:full')
  url.searchParams.set('state', params.state)
  url.searchParams.set('nonce', params.nonce)
  url.searchParams.set('code_challenge', params.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

// The redirect URI must match what's registered in Shopify exactly. Built
// from NEXT_PUBLIC_APP_URL so prod and dev work without code changes.
export function getRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL
  if (!base) throw new Error('NEXT_PUBLIC_APP_URL is not configured')
  return `${base.replace(/\/$/, '')}/auth/customer/callback`
}

// Constant-time string comparison. Caller is responsible for ensuring both
// arguments come from a controlled source (we don't accept user-controlled
// length differences as a side channel).
export function safeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  return timingSafeEqual(aBuf, bBuf)
}

export type TokenBundle = {
  accessToken: string
  refreshToken: string
  idToken: string
  // Epoch milliseconds when the access token expires. Stored separately so
  // /api/customer/me can decide whether to refresh without parsing the JWT.
  accessTokenExpiresAt: number
  // Epoch milliseconds when the refresh token expires. Shopify documents
  // 30-day refresh tokens; we use whatever the response says, defaulting to
  // 30 days if the field is absent.
  refreshTokenExpiresAt: number
}

type RawTokenResponse = {
  access_token: string
  refresh_token: string
  id_token: string
  token_type: string
  expires_in: number
  refresh_token_expires_in?: number
  scope?: string
}

const REFRESH_TOKEN_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000

// Confidential-client auth header: client_secret_basic per RFC 6749 §2.3.1.
function buildClientAuthHeader(): string {
  const clientId = process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID
  const clientSecret = process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET
  if (!clientId) throw new Error('SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID is not configured')
  if (!clientSecret) throw new Error('SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET is not configured')
  const encoded = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')
  return `Basic ${encoded}`
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<TokenBundle> {
  const { token_endpoint } = await getDiscovery()

  const body = new URLSearchParams()
  body.set('grant_type', 'authorization_code')
  body.set('code', code)
  body.set('redirect_uri', redirectUri)
  body.set('code_verifier', codeVerifier)

  const res = await fetch(token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: buildClientAuthHeader(),
    },
    body: body.toString(),
  })

  const responseText = await res.text()
  if (!res.ok) {
    throw new Error(`Token exchange failed (HTTP ${res.status}): ${responseText.slice(0, 500)}`)
  }

  let data: RawTokenResponse
  try {
    data = JSON.parse(responseText) as RawTokenResponse
  } catch {
    throw new Error(`Token endpoint returned non-JSON: ${responseText.slice(0, 200)}`)
  }

  if (!data.access_token || !data.refresh_token || !data.id_token) {
    throw new Error('Token response missing required fields')
  }

  const now = Date.now()
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
    accessTokenExpiresAt: now + data.expires_in * 1000,
    refreshTokenExpiresAt:
      now + (data.refresh_token_expires_in ?? REFRESH_TOKEN_DEFAULT_TTL_MS / 1000) * 1000,
  }
}

// JWKS cache. jose's createRemoteJWKSet handles HTTP fetch, in-memory caching,
// and automatic refresh on `kid` miss (e.g., during key rotation).
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null
let _jwksUri: string | null = null

async function getJwks() {
  const { jwks_uri } = await getDiscovery()
  if (!_jwks || _jwksUri !== jwks_uri) {
    _jwks = createRemoteJWKSet(new URL(jwks_uri))
    _jwksUri = jwks_uri
  }
  return _jwks
}

export type IdTokenClaims = {
  sub: string
  iss: string
  aud: string | string[]
  exp: number
  iat: number
  nonce?: string
  email?: string
  email_verified?: boolean
  given_name?: string
  family_name?: string
  // Customer Account API may include a structured customer object — kept loose
  // to avoid coupling to undocumented shape changes.
  [key: string]: unknown
}

// Verifies the ID token JWT against the discovered JWKS, then validates the
// audience matches our client_id, the issuer matches discovery, and the nonce
// matches what we stored in the OAuth-flow cookie. Throws on any failure.
export async function verifyIdToken(
  idToken: string,
  expectedNonce: string,
): Promise<IdTokenClaims> {
  const discovery = await getDiscovery()
  const clientId = process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID
  if (!clientId) throw new Error('SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID is not configured')

  const jwks = await getJwks()
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: discovery.issuer,
    audience: clientId,
    // jose enforces exp by default; clockTolerance lets tiny drift slide.
    clockTolerance: 30,
  })

  const claims = payload as IdTokenClaims
  if (!claims.nonce || !safeStringEqual(claims.nonce, expectedNonce)) {
    throw new Error('ID token nonce does not match expected value')
  }
  return claims
}
