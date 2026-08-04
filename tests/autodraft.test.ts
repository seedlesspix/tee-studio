import { describe, it, expect } from 'vitest'
import { buildEnvelope, parseEnvelope, shouldRestore } from '../app/lib/autodraft'

describe('autodraft — the restore-decision gate', () => {
  const env = buildEnvelope({ productId: 'gid://P/1', foo: 'bar' } as never, 1000)

  it('restores on a reload of the same product', () => {
    expect(shouldRestore(env, { isReload: true, currentProductId: 'gid://P/1' })).toBe(true)
  })

  it('does NOT restore on a fresh navigation — only on reload (the anti-hijack rule)', () => {
    expect(shouldRestore(env, { isReload: false, currentProductId: 'gid://P/1' })).toBe(false)
  })

  it('does NOT restore a snapshot from a different product', () => {
    expect(shouldRestore(env, { isReload: true, currentProductId: 'gid://P/2' })).toBe(false)
  })

  it('restores when the current product is unknown (avoids a false mismatch)', () => {
    expect(shouldRestore(env, { isReload: true, currentProductId: undefined })).toBe(true)
  })

  it('rejects null / corrupt / wrong-version envelopes', () => {
    expect(shouldRestore(null, { isReload: true })).toBe(false)
    expect(parseEnvelope(null)).toBeNull()
    expect(parseEnvelope('{not json')).toBeNull()
    expect(parseEnvelope(JSON.stringify({ v: 999, state: {} }))).toBeNull()
    expect(parseEnvelope(JSON.stringify({ v: 1, state: null }))).toBeNull()
  })

  it('round-trips a valid envelope', () => {
    const parsed = parseEnvelope(JSON.stringify(env))
    expect(parsed?.productId).toBe('gid://P/1')
    expect((parsed?.state as { foo: string }).foo).toBe('bar')
  })
})
