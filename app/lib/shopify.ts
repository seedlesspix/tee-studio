import { createStorefrontApiClient } from '@shopify/storefront-api-client'
import { supabase } from './supabase'

export const shopifyClient = createStorefrontApiClient({
  storeDomain: process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN!,
  apiVersion: '2026-04',
  publicAccessToken: process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN!,
})

export async function getProduct(productId: string) {
  const query = `
    query GetProduct($id: ID!) {
      product(id: $id) {
        id
        title
        handle
        options {
          name
          values
        }
        variants(first: 250) {
          edges {
            node {
              id
              title
              availableForSale
              price {
                amount
                currencyCode
              }
              selectedOptions {
                name
                value
              }
            }
          }
        }
        images(first: 50) {
          edges {
            node {
              url
              altText
            }
          }
        }
        printArea: metafield(namespace: "designer", key: "print_area") {
          value
        }
        printMethod: metafield(namespace: "designer", key: "print_method") {
          value
        }
      }
    }
  `
  const { data, errors } = await shopifyClient.request(query, {
    variables: {
      id: `gid://shopify/Product/${productId}`
    }
  })
  if (errors) {
    console.error('Shopify API errors:', errors)
    return null
  }
  return data?.product
}

export type CartItem = {
  variantId: string
  quantity: number
  properties: Record<string, string>
}

export type CartAddResult =
  | { ok: true }
  | { ok: false; error: string }

// Returns the configured store origin (e.g. "https://tshirtdeli.com") with no trailing slash.
// Throws if the env var is missing — caller should surface the error to the user.
export function getStoreOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN
  if (!raw) throw new Error('NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN is not configured')
  // Normalize: always return https://<host>, regardless of what the env var
  // contains. Strip any http:// or https:// prefix, strip trailing slash,
  // then force https:// — Shopify session cookies are Secure-only so http
  // would never work anyway.
  const host = raw.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
  return `https://${host}`
}

// Adds line items to the customer's Shopify session cart by POSTing to our
// own /api/cart-add proxy route. Same-origin avoids the CORS issue that
// blocks direct calls to Shopify's /cart/add.js; the proxy forwards to
// Shopify with the customer's session cookies. Sequential adds (one item per
// request) — stop on first failure, partial cart state is acceptable.
export async function addItemsToShopifyCart(items: CartItem[]): Promise<CartAddResult> {
  if (items.length === 0) return { ok: false, error: 'No items to add' }

  for (const item of items) {
    const body = new URLSearchParams()
    body.set('id', item.variantId)
    body.set('quantity', String(item.quantity))
    for (const [key, value] of Object.entries(item.properties)) {
      body.set(`properties[${key}]`, value)
    }

    try {
      const res = await fetch('/api/cart-add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: body.toString(),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => null)
        const message = errBody?.description || errBody?.message || errBody?.error || `Shopify returned HTTP ${res.status}`
        return { ok: false, error: message }
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error
          ? `Could not reach cart proxy (${err.message})`
          : 'Could not reach cart proxy',
      }
    }
  }

  return { ok: true }
}

export type PrintChargeVariantResult =
  | { ok: true; variantId: string }
  | { ok: false; error: string }

// Looks up the Shopify Print Charge variant for a given (print_method, sides)
// from designer_pricing. NULL shopify_variant_id is a configuration error —
// fail loud rather than silently dropping the surcharge from the cart. See
// CLAUDE.md "designer_pricing operational rules".
export async function resolvePrintChargeVariant(
  printMethodKey: string,
  sides: 1 | 2,
): Promise<PrintChargeVariantResult> {
  const { data, error } = await supabase
    .from('designer_pricing')
    .select('shopify_variant_id, label')
    .eq('print_method_key', printMethodKey)
    .eq('sides', sides)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    return { ok: false, error: `Could not look up Print Charge (${error.message})` }
  }
  if (!data) {
    return { ok: false, error: `No Print Charge configured for ${printMethodKey} (sides=${sides}) — please contact support` }
  }
  if (!data.shopify_variant_id) {
    return { ok: false, error: `Print Charge "${data.label}" is missing its Shopify variant ID — please contact support` }
  }
  return { ok: true, variantId: data.shopify_variant_id }
}
