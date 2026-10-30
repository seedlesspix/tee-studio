import { describe, it, expect } from 'vitest'
import {
  pickProvider, buildLeonardoRequest, buildRemoveBgRequest, parseLeonardoResult, describeProviderFailure,
  extractErrorDetail, LEONARDO_SYNC_URL, REMOVE_BG_URL,
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
  it('body: model remove-bg, ephemeral, full-size png, the image as a URL reference', () => {
    const body = JSON.parse(r.init.body as string)
    expect(body.model).toBe('remove-bg')
    expect(body.ephemeral).toBe(true)
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
  it('reads results[0].url and cost.amount', () => {
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
