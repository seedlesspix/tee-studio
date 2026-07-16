// Ephemeral design products (Phase 4 Days 4–5). Server-only.
//
// The DB (design_orders) is the source of truth; the Shopify product created
// here is a DISPOSABLE RENDERING of one design so checkout can sell it —
// per-size variants at a single price (closes BLOCKER-3: size is a real
// variant, not a text property). Reorders RECREATE the product; the Day-7
// retention job deletes old ones — but ONLY behind the paid-or-cart-expired
// gates, because productDelete silently empties any live cart holding the
// product (Day-1 probe 7b).
//
// Lifecycle, proven end-to-end against the live store on Day 1:
//   productSet (channel-invisible by default — 0 publications, ~23 pts)
//   → publishablePublish to the Headless publication ONLY (~10 pts;
//     Online Store stays blind: URL 404s, absent from /products.json)
//   → Storefront cartCreate → checkoutUrl (checkout is channel-agnostic).
//
// The design_order_id rides in two places: a product tag (design cleanup jobs
// map product → design without a schema change) and a cart line attribute
// (becomes an order line property, which is what the ORDERS_PAID webhook
// already reads).

import { adminGraphQL, PUBLICATION_HEADLESS } from './shopify-admin'

// Cleanup jobs find these products by tag. NOTE (proven Days 4–5): tag values
// containing a colon MUST be quoted in Admin search syntax —
//   query: "tag:'design_order:<uuid>'"   ← finds it
//   query: "tag:design_order:<uuid>"     ← silently returns nothing
export const DESIGN_PRODUCT_TAG = '_design_product'

const STOREFRONT_API_VERSION = '2024-10'

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
        status: 'ACTIVE', // sellable; invisible until (and unless) published
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

export async function publishToHeadless(productId: string): Promise<void> {
  const data = await adminGraphQL<PublishResult>(
    `mutation ($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) { userErrors { field message } }
    }`,
    { id: productId, input: [{ publicationId: PUBLICATION_HEADLESS }] }
  )
  const errors = data.publishablePublish.userErrors
  if (errors.length > 0) {
    throw new Error(`publishToHeadless: ${errors.map((e) => e.message).join('; ')}`)
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

// ---------------------------------------------------------------------------
// Storefront cart (server-side). Uses the same public Storefront token as the
// browser client — Day 1 proved it already has cart write scopes.

type CartLine = { variantId: string; quantity: number }

type CartCreateResponse = {
  data?: {
    cartCreate: {
      cart: { id: string; checkoutUrl: string } | null
      userErrors: Array<{ field: string[] | null; message: string }>
    }
  }
  errors?: Array<{ message: string }>
}

function storefrontEnv() {
  const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN
  const token = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN
  if (!domain || !token) throw new Error('Storefront API env vars are not configured')
  return { domain, token }
}

/**
 * Create a Storefront cart for a freshly-published design product and return
 * its checkoutUrl. A just-published product can take a moment to propagate to
 * the Storefront API (Day-1 probe needed ~3s), so "merchandise not found"
 * retries with a short backoff before failing for real.
 */
export async function createCartForDesign(
  designOrderId: string,
  lines: CartLine[]
): Promise<{ cartId: string; checkoutUrl: string }> {
  if (lines.length === 0) throw new Error('createCartForDesign: no lines')
  const { domain, token } = storefrontEnv()

  const body = JSON.stringify({
    query: `mutation ($lines: [CartLineInput!]!) {
      cartCreate(input: { lines: $lines }) {
        cart { id checkoutUrl }
        userErrors { field message }
      }
    }`,
    variables: {
      lines: lines.map((l) => ({
        merchandiseId: l.variantId,
        quantity: l.quantity,
        attributes: [{ key: '_design_order_id', value: designOrderId }],
      })),
    },
  })

  const MAX_ATTEMPTS = 6
  let lastError = ''
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`https://${domain}/api/${STOREFRONT_API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': token,
      },
      body,
    })
    const json = (await res.json()) as CartCreateResponse
    const cart = json.data?.cartCreate.cart
    if (cart?.checkoutUrl) return { cartId: cart.id, checkoutUrl: cart.checkoutUrl }

    lastError =
      json.data?.cartCreate.userErrors.map((e) => e.message).join('; ') ||
      json.errors?.map((e) => e.message).join('; ') ||
      `HTTP ${res.status}`
    // publish propagation: variant not visible to the Storefront API yet
    if (/merchandise|does not exist|not found|invalid/i.test(lastError) && attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 1500))
      continue
    }
    break
  }
  throw new Error(`createCartForDesign: ${lastError}`)
}
