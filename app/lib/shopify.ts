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

// Batched featured-image lookup for the product picker — ONE Storefront call for all products, so the
// picker shows the real garment mockup (the product's main photo), not the little color swatches.
// Returns a map of product GID → image URL. Missing/typed-wrong ids are simply absent from the map.
// Batched picker data: for a set of product GIDs, return each one's featured image AND which GIDs actually
// resolve to a live Product on the Storefront channel (= availability — a deleted/unpublished product
// returns a null node, exactly like getProduct()). `available` is null when the whole call fails so the
// caller can fail OPEN (show everything) instead of emptying its list on a transient Storefront hiccup;
// a Set (possibly missing some ids) is authoritative — those ids are genuinely unavailable.
export async function getFeaturedImages(
  gids: string[]
): Promise<{ images: Record<string, string>; available: Set<string> | null }> {
  const ids = gids.filter(Boolean)
  if (ids.length === 0) return { images: {}, available: new Set() }
  const query = `
    query FeaturedImages($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product { id featuredImage { url } }
      }
    }
  `
  try {
    const { data, errors } = await shopifyClient.request(query, { variables: { ids } })
    if (errors) { console.error('Shopify featured-images errors:', errors); return { images: {}, available: null } }
    const images: Record<string, string> = {}
    const available = new Set<string>()
    for (const n of ((data?.nodes ?? []) as Array<{ id?: string; featuredImage?: { url?: string } }>)) {
      if (n?.id) { available.add(n.id); if (n.featuredImage?.url) images[n.id] = n.featuredImage.url }
    }
    return { images, available }
  } catch (e) {
    console.error('Shopify featured-images request failed:', e)
    return { images: {}, available: null }
  }
}

// Phase 4 Day 6: the Print Charge line-item machinery that lived here
// (addItemsToShopifyCart, resolvePrintChargeVariant, /api/cart-add,
// /api/admin/variant-check) is DELETED, not bypassed. A finished design now
// becomes an ephemeral product (print charges folded into the variant price)
// which joins the customer's real session cart via
// POST /api/design-orders/[id]/add-to-cart.

// Returns the configured store origin (e.g. "https://tshirtdeli.com") with no
// trailing slash. Throws if the env var is missing — caller should surface
// the error. Normalize: strip any scheme/trailing slash, force https —
// Shopify session cookies are Secure-only so http would never work anyway.
export function getStoreOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN
  if (!raw) throw new Error('NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN is not configured')
  const host = raw.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
  return `https://${host}`
}
