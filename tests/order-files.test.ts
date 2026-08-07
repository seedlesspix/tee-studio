import { describe, it, expect } from 'vitest'
import { orderFileStem, orderLastName } from '../app/lib/orderFiles'

describe('orderLastName', () => {
  it('prefers the shipping address last_name', () => {
    expect(orderLastName({ customer_name: 'Jane Smith', shipping_address: { last_name: 'Doe' } })).toBe('Doe')
  })
  it('falls back to billing address last_name', () => {
    expect(orderLastName({ customer_name: 'Jane Smith', billing_address: { last_name: 'Roe' } })).toBe('Roe')
  })
  it('takes the last token of the full name when no address', () => {
    expect(orderLastName({ customer_name: 'Jane Q Smith' })).toBe('Smith')
  })
  it('strips filename-unsafe characters', () => {
    expect(orderLastName({ customer_name: "Mary O'Brien-Lee" })).toBe('OBrienLee')
  })
  it('returns empty when nothing usable', () => {
    expect(orderLastName({})).toBe('')
    expect(orderLastName({ customer_name: '   ' })).toBe('')
  })
  it('handles a single-token name (email local-part fallback)', () => {
    expect(orderLastName({ customer_name: 'jdoe' })).toBe('jdoe')
  })
})

describe('orderFileStem', () => {
  it('builds <orderNumber>-<LastName>', () => {
    expect(orderFileStem({ shopify_order_number: '1042', customer_name: 'Jane Smith' })).toBe('1042-Smith')
  })
  it('order number alone when no name', () => {
    expect(orderFileStem({ shopify_order_number: '1042' })).toBe('1042')
  })
  it('draft: short id when no order number', () => {
    expect(orderFileStem({ id: '2e5b815c-3fdd-4cd3-adaa-ea9c78cc2621' })).toBe('2e5b815c')
  })
  it('draft with a known name still appends it', () => {
    expect(orderFileStem({ id: '2e5b815c-3fdd', customer_name: 'Jane Smith' })).toBe('2e5b815c-Smith')
  })
  it('prefers address last name in the stem', () => {
    expect(orderFileStem({ shopify_order_number: '77', shipping_address: { last_name: 'Ng' }, customer_name: 'X Y' })).toBe('77-Ng')
  })
})
