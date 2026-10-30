// Background-removal provider glue (2026-10-30) — PURE: request builders, response parsing and error
// wording for the designer's "Remove Background" button. The route (/api/remove-bg) does the fetching.
//
// Why two providers: remove.bg's self-serve API ends on 1 December 2026 (it moves to Leonardo.Ai,
// part of Canva). Leonardo is the official successor — same engine lineage, URL in, JSON out, billed
// per image (USD, pay-as-you-go). The provider is chosen by which key is configured: LEONARDO_API_KEY
// wins; REMOVE_BG_API_KEY is the legacy path that keeps working until the cutover and is to be deleted
// after it. Either way the route downloads the cutout bytes and re-hosts them on Cloudinary — order
// artwork is kept forever, and Leonardo's ephemeral result URLs live only ~30 minutes.
//
// Leonardo contract (docs.leonardo.ai → "Migrate from the remove.bg API"):
//   POST https://cloud.leonardo.ai/api/rest/v2/generationssync   Authorization: Bearer <key>, JSON only
//   { model: "remove-bg", ephemeral: true, parameters: { size: "full", format: "png",
//     guidances: { image_reference: [ { image: { type: "URL", url } } ] } } }
//   → { id, blockedCount, cost: { amount, unit }, results: [ { url, contentType, width, height } ] }
// ephemeral:true = nothing is kept in the Leonardo library (customer images stay ours), result URL is a
// short-lived download link. HTTPS URLs only, ~20 MB max input.

export type Provider = 'leonardo' | 'removebg'

export type ProviderEnv = { LEONARDO_API_KEY?: string; REMOVE_BG_API_KEY?: string }

// Which provider the deployment uses, from the keys present. Leonardo first (the successor); remove.bg
// only while no Leonardo key exists; null = the feature is not set up.
export function pickProvider(env: ProviderEnv): { provider: Provider; key: string } | null {
  const leo = (env.LEONARDO_API_KEY || '').trim()
  if (leo) return { provider: 'leonardo', key: leo }
  const rbg = (env.REMOVE_BG_API_KEY || '').trim()
  if (rbg) return { provider: 'removebg', key: rbg }
  return null
}

export const LEONARDO_SYNC_URL = 'https://cloud.leonardo.ai/api/rest/v2/generationssync'
export const REMOVE_BG_URL = 'https://api.remove.bg/v1.0/removebg'

export type ProviderRequest = { url: string; init: { method: 'POST'; headers: Record<string, string>; body: BodyInit } }

export function buildLeonardoRequest(imageUrl: string, key: string): ProviderRequest {
  const body = {
    model: 'remove-bg',
    ephemeral: true, // keep nothing in the Leonardo library; we re-host the result ourselves
    // Documented as optional (default false) but the live API REJECTS its absence: production log
    // 2026-10-30, HTTP 200 with [{"message":"public must be boolean", ...}]. Always send it.
    public: false,
    parameters: {
      size: 'full',   // full-resolution cutout (what remove.bg's size=auto gave us)
      format: 'png',  // transparency
      guidances: { image_reference: [{ image: { type: 'URL', url: imageUrl } }] },
    },
  }
  return {
    url: LEONARDO_SYNC_URL,
    init: {
      method: 'POST',
      headers: { accept: 'application/json', authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  }
}

export function buildRemoveBgRequest(imageUrl: string, key: string): ProviderRequest {
  const form = new FormData()
  form.append('image_url', imageUrl)
  form.append('size', 'auto')
  return { url: REMOVE_BG_URL, init: { method: 'POST', headers: { 'X-Api-Key': key }, body: form } }
}

export type LeonardoResult = { url: string; costUsd: number | null; width?: number; height?: number }

// The cutout's download URL (and what the call cost) out of Leonardo's JSON, or null when the shape
// isn't what the docs promise — the route treats that as "unexpected response", never as success.
export function parseLeonardoResult(json: unknown): LeonardoResult | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null
  // The LIVE sync endpoint wraps the documented object under a top-level `generateSync` key (production
  // success body, 2026-10-30: `{"generateSync":{"id":…,"cost":{…},"results":[{"contentType":"image/png",
  // "url":"https://…s3…?X-Amz-Expires=1800…"}]}}`). The migration guide shows it unwrapped; accept both.
  const outer = json as { generateSync?: unknown; results?: unknown }
  const inner = outer.generateSync && typeof outer.generateSync === 'object' && !Array.isArray(outer.generateSync)
    ? outer.generateSync : json
  const j = inner as { results?: unknown; cost?: unknown }
  const results = Array.isArray(j.results) ? j.results : []
  const first = results[0] as { url?: unknown; width?: unknown; height?: unknown } | undefined
  if (!first || typeof first.url !== 'string' || !/^https:\/\//.test(first.url)) return null
  const cost = j.cost as { amount?: unknown } | undefined
  const amount = cost && typeof cost === 'object' ? Number(cost.amount) : NaN
  return {
    url: first.url,
    costUsd: Number.isFinite(amount) ? amount : null,
    width: typeof first.width === 'number' ? first.width : undefined,
    height: typeof first.height === 'number' ? first.height : undefined,
  }
}

// Leonardo can answer HTTP 200 with an ERROR LIST instead of a result (seen in production 2026-10-30:
// `[{"extensions":{"code":"BAD_REQUEST",...},"message":"public must be boolean","path":[]}]`), or the
// GraphQL-style `{ errors: [{ message }] }`. Return the first message so the customer and the log see
// Leonardo's own words rather than "unexpected response"; null when the body isn't an error list.
export function extractLeonardoError(json: unknown): string | null {
  const list = Array.isArray(json) ? json : (json && typeof json === 'object' && Array.isArray((json as { errors?: unknown }).errors))
    ? (json as { errors: unknown[] }).errors : null
  if (!list || !list.length) return null
  const first = list[0] as { message?: unknown; extensions?: { errorMessages?: unknown } } | undefined
  const fromExt = Array.isArray(first?.extensions?.errorMessages) ? first!.extensions!.errorMessages!.filter(m => typeof m === 'string').join('; ') : ''
  const msg = typeof first?.message === 'string' && first.message ? first.message : fromExt
  return msg ? msg.slice(0, 200) : 'request rejected'
}

// Customer-facing failure wording per provider + HTTP status. The detail (when the provider's JSON
// error carries one) is appended by the route.
export function describeProviderFailure(provider: Provider, status: number): string {
  const name = provider === 'leonardo' ? 'Leonardo.Ai' : 'remove.bg'
  const keyName = provider === 'leonardo' ? 'LEONARDO_API_KEY' : 'REMOVE_BG_API_KEY'
  if (status === 401 || status === 403) return `authentication — the ${keyName} looks wrong or unauthorized`
  if (status === 402) return `quota/credits — the ${name} account is out of credits`
  if (status === 429) return 'rate limit — too many requests, wait a moment'
  if (status === 400 || status === 422) return `${name} rejected the image (is the image URL publicly reachable?)`
  return `${name} returned ${status}`
}

// Pull a human detail string out of either provider's error body, if there is one.
export function extractErrorDetail(bodyText: string): string {
  try {
    const j = JSON.parse(bodyText)
    const rbg = j?.errors?.[0]?.title            // remove.bg: { errors: [{ title, code }] }
    const leo = j?.error ?? j?.message ?? j?.detail // Leonardo: { error } / { message } / { detail }
    const d = rbg ?? leo
    if (typeof d === 'string') return d.slice(0, 200)
    if (d && typeof d === 'object' && typeof d.message === 'string') return d.message.slice(0, 200)
  } catch { /* not JSON */ }
  return ''
}
