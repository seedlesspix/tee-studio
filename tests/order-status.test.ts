import { describe, it, expect } from 'vitest'
import { displayStatusKey, cancelReasonLabel } from '../app/lib/orderStatus'

describe('displayStatusKey — cancellation is derived, status stays paid', () => {
  it('a cancelled paid order shows as cancelled', () => {
    expect(displayStatusKey({ status: 'completed', cancelled_at: '2026-10-20T10:00:00Z' })).toBe('cancelled')
  })
  it('otherwise the stored status, defaulting to draft', () => {
    expect(displayStatusKey({ status: 'completed', cancelled_at: null })).toBe('completed')
    expect(displayStatusKey({ status: 'cart_created' })).toBe('cart_created')
    expect(displayStatusKey({ status: null })).toBe('draft')
    expect(displayStatusKey({ status: 'weird' })).toBe('draft')
  })
  it('reasons read as plain words', () => {
    expect(cancelReasonLabel('customer')).toBe('customer changed their mind')
    expect(cancelReasonLabel('something_new')).toBe('something_new')
    expect(cancelReasonLabel(null)).toBe('no reason given')
  })
})
