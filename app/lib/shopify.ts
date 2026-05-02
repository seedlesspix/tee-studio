import { createStorefrontApiClient } from '@shopify/storefront-api-client'

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

// Adds line items to the customer's Shopify session cart via /cart/add.js.
// Relies on cookies for the Shopify domain — only works when the calling
// page is same-site as the storefront (e.g. create.tshirtdeli.com → tshirtdeli.com).
export async function addItemsToShopifyCart(items: CartItem[]): Promise<CartAddResult> {
  if (items.length === 0) return { ok: false, error: 'No items to add' }

  let storeOrigin: string
  try {
    storeOrigin = getStoreOrigin()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Store domain not configured' }
  }

  // Form-encoded body keeps the request a CORS "simple request" — no preflight
  // OPTIONS (which Shopify's /cart/add.js doesn't handle). Form encoding can't
  // express arrays cleanly, so we POST one line item at a time. If any single
  // add fails, stop and surface the error — Shopify's session cart accepts
  // partial state and the customer can retry from where it failed.
  for (const item of items) {
    const body = new URLSearchParams()
    body.set('id', item.variantId)
    body.set('quantity', String(item.quantity))
    for (const [key, value] of Object.entries(item.properties)) {
      body.set(`properties[${key}]`, value)
    }

    try {
      const res = await fetch(`${storeOrigin}/cart/add.js`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: body.toString(),
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => null)
        const message = errBody?.description || errBody?.message || `Shopify returned HTTP ${res.status}`
        return { ok: false, error: message }
      }
    } catch (err) {
      // Network error or CORS block (browser refuses to expose the response).
      return {
        ok: false,
        error: err instanceof Error
          ? `Could not reach Shopify (${err.message})`
          : 'Could not reach Shopify',
      }
    }
  }

  return { ok: true }
}
