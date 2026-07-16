// Ephemeral design products (Phase 4 Days 4–6). Server-only.
//
// The DB (design_orders) is the source of truth; the Shopify product created
// here is a DISPOSABLE RENDERING of one design so the cart can sell it —
// per-size variants at a single folded price (closes BLOCKER-3: size is a
// real variant, not a text property). Reorders RECREATE the product; the
// Day-7 retention job deletes old ones — but ONLY behind the
// paid-or-cart-expired gates, because productDelete silently empties any
// live cart holding the product (Day-1 probe 7b).
//
// Lifecycle (revised Day 6 after the cart-requirement correction; every step
// probe-verified against the live store):
//   productSet (channel-invisible at creation, ~23 pts; seo.hidden=1 so the
//     product never appears in store search or the sitemap)
//   → publishablePublish to the ONLINE STORE (~10 pts) — REQUIRED for the
//     customer's session cart: carts have an owning channel, and the Online
//     Store cart only accepts merchandise published to the Online Store
//     (probed: /cart/add.js AND Storefront cartLinesAdd both reject
//     headless-only variants with "cannot find"/"does not exist")
//   → the customer's own /cart/add.js (cookie-forwarded, same-site via
//     create.tshirtdeli.com) joins the design to their REAL cart, mixed with
//     off-the-shelf products; checkout is native Shopify from /cart.
//
// Visibility trade (approved 2026-07-16, revising the original hard
// requirement): Online Store publication exposes the product in
// /products.json + its direct URL for the shopping window; seo.hidden kills
// search/sitemap; no collections; the retention job ends the exposure.
//
// The design_order_id rides in two places: a product tag (cleanup jobs map
// product → design without a schema change) and a cart line-item property
// (which is what the ORDERS_PAID webhook reads).

import { adminGraphQL, PUBLICATION_ONLINE_STORE } from './shopify-admin'

// Cleanup jobs find these products by tag. NOTE (proven Days 4–5): tag values
// containing a colon MUST be quoted in Admin search syntax —
//   query: "tag:'design_order:<uuid>'"   ← finds it
//   query: "tag:design_order:<uuid>"     ← silently returns nothing
export const DESIGN_PRODUCT_TAG = '_design_product'

type ProductSetResult = {
  productSet: {
    product: {
      id: string
      handle: string
      variants: { nodes: Array<{ id: string; title: string }> }
    } | null
    userErrors: Array<{ field: string[] | null; message: string }>
  }
}

type PublishResult = {
  publishablePublish: {
    userErrors: Array<{ field: string[] | null; message: string }>
  }
}

export type CreateDesignProductInput = {
  designOrderId: string
  title: string // customer-facing at checkout, e.g. "Custom Cotton Tee"
  price: number // single price for every size (blank + print charges)
  sizes: string[] // in Shopify variant order — never sorted
  previewUrls: string[] // public PNG URLs (front/back) → product media
}

export type DesignProduct = {
  productId: string
  handle: string
  variantsBySize: Record<string, string> // size → variant GID
}

export async function createDesignProduct(
  input: CreateDesignProductInput
): Promise<DesignProduct> {
  if (input.sizes.length === 0) throw new Error('createDesignProduct: no sizes')
  const price = input.price.toFixed(2)

  const data = await adminGraphQL<ProductSetResult>(
    `mutation ($input: ProductSetInput!) {
      productSet(input: $input) {
        product {
          id
          handle
          variants(first: 50) { nodes { id title } }
        }
        userErrors { field message }
      }
    }`,
    {
      input: {
        title: input.title,
        status: 'ACTIVE', // sellable; invisible until published
        // seo.hidden=1: out of Online Store search + sitemap even once
        // published (the visibility-minimization half of the Day-6 trade).
        metafields: [
          { namespace: 'seo', key: 'hidden', type: 'number_integer', value: '1' },
        ],
        tags: [DESIGN_PRODUCT_TAG, `design_order:${input.designOrderId}`],
        productOptions: [
          {
            name: 'Size',
            position: 1,
            values: input.sizes.map((name) => ({ name })),
          },
        ],
        variants: input.sizes.map((size) => ({
          optionValues: [{ optionName: 'Size', name: size }],
          price,
        })),
        files: input.previewUrls.map((url) => ({
          originalSource: url,
          contentType: 'IMAGE',
        })),
      },
    }
  )

  const errors = data.productSet.userErrors
  if (errors.length > 0 || !data.productSet.product) {
    throw new Error(
      `createDesignProduct: ${errors.map((e) => e.message).join('; ') || 'no product returned'}`
    )
  }

  const product = data.productSet.product
  const variantsBySize: Record<string, string> = {}
  for (const v of product.variants.nodes) variantsBySize[v.title] = v.id

  // Every requested size must have come back as a variant — a partial product
  // would sell some sizes and silently drop others.
  const missing = input.sizes.filter((s) => !variantsBySize[s])
  if (missing.length > 0) {
    await deleteDesignProduct(product.id).catch(() => {})
    throw new Error(`createDesignProduct: variants missing for sizes ${missing.join(', ')}`)
  }

  return { productId: product.id, handle: product.handle, variantsBySize }
}

export async function publishProduct(
  productId: string,
  publicationId: string = PUBLICATION_ONLINE_STORE
): Promise<void> {
  const data = await adminGraphQL<PublishResult>(
    `mutation ($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) { userErrors { field message } }
    }`,
    { id: productId, input: [{ publicationId }] }
  )
  const errors = data.publishablePublish.userErrors
  if (errors.length > 0) {
    throw new Error(`publishProduct: ${errors.map((e) => e.message).join('; ')}`)
  }
}

export async function deleteDesignProduct(productId: string): Promise<void> {
  const data = await adminGraphQL<{
    productDelete: { userErrors: Array<{ message: string }> }
  }>(
    `mutation ($input: ProductDeleteInput!) {
      productDelete(input: $input) { userErrors { message } }
    }`,
    { input: { id: productId } }
  )
  const errors = data.productDelete.userErrors
  if (errors.length > 0) {
    throw new Error(`deleteDesignProduct: ${errors.map((e) => e.message).join('; ')}`)
  }
}

// NOTE: the Day-4/5 server-side Storefront cart (createCartForDesign →
// checkoutUrl) was deleted in the Day-6 revision — carts have an owning
// channel, so a server-created Storefront cart could never merge with the
// customer's real Online Store cart. The cart handoff now happens in
// /api/design-orders/[id]/add-to-cart via the customer's own session.
