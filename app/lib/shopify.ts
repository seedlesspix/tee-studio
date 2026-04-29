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

export async function createShopifyCart(
  variantId: string,
  quantities: Record<string, number>,
  designOrderId: string,
  printCharge: number,
  selectedColor: string
) {
  // Build line items - one per size with quantity > 0
  const lines = Object.entries(quantities)
    .filter(([_, qty]) => qty > 0)
    .map(([size, qty]) => ({
      merchandiseId: `gid://shopify/ProductVariant/${variantId}`,
      quantity: qty,
      attributes: [
        { key: '_design_order_id', value: designOrderId },
        { key: '_size', value: size },
        { key: '_print_charge', value: `$${printCharge.toFixed(2)}` },
        { key: '_color', value: selectedColor },
        { key: 'Custom Design', value: 'Yes' },
      ]
    }))

  if (lines.length === 0) return null

  const mutation = `
    mutation CreateCart($lines: [CartLineInput!]!) {
      cartCreate(input: { lines: $lines }) {
        cart {
          id
          checkoutUrl
          lines(first: 1) {
            edges {
              node {
                id
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `

  const { data, errors } = await shopifyClient.request(mutation, {
    variables: { lines }
  })

  if (errors || data?.cartCreate?.userErrors?.length > 0) {
    console.error('Cart creation errors:', errors || data?.cartCreate?.userErrors)
    return null
  }

  return data?.cartCreate?.cart
}
