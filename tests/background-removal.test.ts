import { describe, it, expect } from 'vitest'
import {
  pickProvider, buildLeonardoRequest, buildRemoveBgRequest, parseLeonardoResult, describeProviderFailure,
  extractErrorDetail, extractLeonardoError, LEONARDO_SYNC_URL, REMOVE_BG_URL,
} from '../app/lib/backgroundRemoval'

describe('pickProvider — Leonardo wins, remove.bg is the legacy path, nothing = not set up', () => {
  it('prefers Leonardo when both keys exist (the cutover switch)', () => {
    expect(pickProvider({ LEONARDO_API_KEY: 'leo', REMOVE_BG_API_KEY: 'rbg' })).toEqual({ provider: 'leonardo', key: 'leo' })
  })
  it('falls back to remove.bg until the Leonardo key exists', () => {
    expect(pickProvider({ REMOVE_BG_API_KEY: 'rbg' })).toEqual({ provider: 'removebg', key: 'rbg' })
    expect(pickProvider({ LEONARDO_API_KEY: '   ', REMOVE_BG_API_KEY: 'rbg' })).toEqual({ provider: 'removebg', key: 'rbg' })
  })
  it('null when no key is configured', () => {
    expect(pickProvider({})).toBeNull()
    expect(pickProvider({ LEONARDO_API_KEY: '', REMOVE_BG_API_KEY: '' })).toBeNull()
  })
})

describe('buildLeonardoRequest — the documented sync call, URL in, PNG out, nothing kept in their library', () => {
  const r = buildLeonardoRequest('https://res.cloudinary.com/demo/image/upload/v1/x.jpg', 'KEY')
  it('targets the sync endpoint with bearer auth and JSON', () => {
    expect(r.url).toBe(LEONARDO_SYNC_URL)
    expect(r.init.method).toBe('POST')
    expect(r.init.headers.authorization).toBe('Bearer KEY')
    expect(r.init.headers['content-type']).toBe('application/json')
  })
  it('body: model remove-bg, ephemeral, public:false (the live API rejects its absence), full-size png, the image as a URL reference', () => {
    const body = JSON.parse(r.init.body as string)
    expect(body.model).toBe('remove-bg')
    expect(body.ephemeral).toBe(true)
    expect(body.public).toBe(false) // production 2026-10-30: 200 + [{"message":"public must be boolean"}] without it
    expect(body.parameters.size).toBe('full')
    expect(body.parameters.format).toBe('png')
    expect(body.parameters.guidances.image_reference).toEqual([{ image: { type: 'URL', url: 'https://res.cloudinary.com/demo/image/upload/v1/x.jpg' } }])
  })
})

describe('buildRemoveBgRequest — the legacy call, unchanged', () => {
  it('multipart image_url + size=auto with the X-Api-Key header', () => {
    const r = buildRemoveBgRequest('https://res.cloudinary.com/demo/x.jpg', 'KEY')
    expect(r.url).toBe(REMOVE_BG_URL)
    expect(r.init.headers['X-Api-Key']).toBe('KEY')
    const form = r.init.body as FormData
    expect(form.get('image_url')).toBe('https://res.cloudinary.com/demo/x.jpg')
    expect(form.get('size')).toBe('auto')
  })
})

describe('parseLeonardoResult', () => {
  it('reads the LIVE shape: everything under a top-level generateSync key (production success body, 2026-10-30)', () => {
    const prod = { generateSync: { id: '1f1d497b-1745-6f20-9758-4458c74526db', blockedCount: 0, cost: { amount: '0.1047', unit: 'DOLLARS' },
      results: [{ contentType: 'image/png', url: 'https://leonardoai-generations-temporary-assets-prod.s3.us-east-1.amazonaws.com/ephemeral/users/u/generations/g/remove-bg_-0.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=1800' }] } }
    const res = parseLeonardoResult(prod)
    expect(res?.url).toBe(prod.generateSync.results[0].url)
    expect(res?.costUsd).toBe(0.1047)
    expect(res?.width).toBeUndefined() // the live body carries no width/height
  })
  it('reads results[0].url and cost.amount in the documented (unwrapped) shape too', () => {
    const res = parseLeonardoResult({ id: 'g1', blockedCount: 0, cost: { amount: '0.1047', unit: 'DOLLARS' }, results: [{ url: 'https://cdn.leonardo.ai/out.png', contentType: 'image/png', width: 1200, height: 900 }] })
    expect(res).toEqual({ url: 'https://cdn.leonardo.ai/out.png', costUsd: 0.1047, width: 1200, height: 900 })
  })
  it('tolerates a missing cost, rejects a missing / non-https url and junk', () => {
    expect(parseLeonardoResult({ results: [{ url: 'https://x/y.png' }] })).toMatchObject({ url: 'https://x/y.png', costUsd: null })
    expect(parseLeonardoResult({ results: [{ url: 'http://x/y.png' }] })).toBeNull()
    expect(parseLeonardoResult({ results: [] })).toBeNull()
    expect(parseLeonardoResult({})).toBeNull()
    expect(parseLeonardoResult(null)).toBeNull()
    expect(parseLeonardoResult('nope')).toBeNull()
  })
})

describe('extractLeonardoError — a 200 that carries an error list (the exact production body, 2026-10-30)', () => {
  const prodBody = [{ extensions: { code: 'BAD_REQUEST', errorCode: 1, errorMessages: ['public must be boolean'], statusCode: 400 }, locations: [], message: 'public must be boolean', path: [] }]
  it('surfaces Leonardo\'s message from an array body and from a GraphQL errors object', () => {
    expect(parseLeonardoResult(prodBody)).toBeNull()
    expect(extractLeonardoError(prodBody)).toBe('public must be boolean')
    expect(extractLeonardoError({ errors: [{ message: 'model not found' }] })).toBe('model not found')
    expect(extractLeonardoError([{ extensions: { errorMessages: ['a', 'b'] } }])).toBe('a; b')
    expect(extractLeonardoError([{}])).toBe('request rejected')
  })
  it('is null for a real result or junk, so a good response is never mistaken for an error', () => {
    expect(extractLeonardoError({ results: [{ url: 'https://x/y.png' }] })).toBeNull()
    expect(extractLeonardoError([])).toBeNull()
    expect(extractLeonardoError(null)).toBeNull()
    expect(extractLeonardoError('nope')).toBeNull()
  })
})

describe('failure wording', () => {
  it('names the right key and vendor per provider', () => {
    expect(describeProviderFailure('leonardo', 401)).toContain('LEONARDO_API_KEY')
    expect(describeProviderFailure('removebg', 403)).toContain('REMOVE_BG_API_KEY')
    expect(describeProviderFailure('leonardo', 402)).toContain('Leonardo.Ai account is out of credits')
    expect(describeProviderFailure('leonardo', 429)).toContain('rate limit')
    expect(describeProviderFailure('leonardo', 422)).toContain('rejected the image')
    expect(describeProviderFailure('removebg', 500)).toBe('remove.bg returned 500')
  })
  it('extracts a detail from either vendor\'s error JSON', () => {
    expect(extractErrorDetail(JSON.stringify({ errors: [{ title: 'Insufficient credits', code: 'x' }] }))).toBe('Insufficient credits')
    expect(extractErrorDetail(JSON.stringify({ error: 'Unauthorized' }))).toBe('Unauthorized')
    expect(extractErrorDetail(JSON.stringify({ message: 'Model not found' }))).toBe('Model not found')
    expect(extractErrorDetail(JSON.stringify({ error: { message: 'nested' } }))).toBe('nested')
    expect(extractErrorDetail('<html>502</html>')).toBe('')
  })
})
