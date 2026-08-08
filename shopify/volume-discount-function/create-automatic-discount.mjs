// Create the automatic app discount that RUNS the volume-tier-discount function.
//
// WHY A SCRIPT: the function has no settings UI, so Shopify admin won't let you pick it under
// "Select discount type" — the discount must be created via the Admin API. And it MUST be created by
// the **tshirtdeli-discounts** app, because (a) discountAutomaticAppCreate needs the `write_discounts`
// scope that app has, and (b) `functionHandle` only resolves within the app that OWNS the function.
// (The main site app, "Tee Studio Server", can't do it — verified: ACCESS_DENIED write_discounts.)
//
// RUN IT with tshirtdeli-discounts credentials. Two ways — set env vars, then `node create-automatic-discount.mjs`:
//   A) a ready Admin API access token for the app:
//        STORE_DOMAIN=your-store.myshopify.com  DISCOUNTS_APP_TOKEN=shpat_or_offline_token
//   B) client-credentials (if that grant is enabled for the app):
//        STORE_DOMAIN=your-store.myshopify.com  DISCOUNTS_CLIENT_ID=...  DISCOUNTS_CLIENT_SECRET=...
// Optional: FUNCTION_HANDLE (default "volume-tier-discount"), API_VERSION (default "2026-07").

const DOMAIN = process.env.STORE_DOMAIN
const VER = process.env.API_VERSION || '2026-07'
const HANDLE = process.env.FUNCTION_HANDLE || 'volume-tier-discount'
if (!DOMAIN) { console.error('Set STORE_DOMAIN=your-store.myshopify.com'); process.exit(1) }

async function getToken() {
  if (process.env.DISCOUNTS_APP_TOKEN) return process.env.DISCOUNTS_APP_TOKEN
  const id = process.env.DISCOUNTS_CLIENT_ID, secret = process.env.DISCOUNTS_CLIENT_SECRET
  if (!id || !secret) { console.error('Provide DISCOUNTS_APP_TOKEN, or DISCOUNTS_CLIENT_ID + DISCOUNTS_CLIENT_SECRET'); process.exit(1) }
  const r = await fetch(`https://${DOMAIN}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
  })
  if (!r.ok) { console.error('token mint failed', r.status, (await r.text()).slice(0, 300)); process.exit(1) }
  return (await r.json()).access_token
}

const token = await getToken()
const gql = async (query, variables) => {
  const r = await fetch(`https://${DOMAIN}/admin/api/${VER}/graphql.json`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  })
  return r.json()
}

// Only send fields this API version accepts.
const intro = await gql(`{ __type(name: "DiscountAutomaticAppInput") { inputFields { name } } }`)
const fields = (intro.data?.__type?.inputFields ?? []).map(f => f.name)

const input = { title: 'Volume discount', functionHandle: HANDLE }
if (fields.includes('startsAt')) input.startsAt = new Date(Date.now() - 60000).toISOString() // active now
if (fields.includes('discountClasses')) input.discountClasses = ['PRODUCT']
if (fields.includes('combinesWith')) input.combinesWith = { orderDiscounts: true, productDiscounts: false, shippingDiscounts: true }

const res = await gql(
  `mutation Create($d: DiscountAutomaticAppInput!) {
     discountAutomaticAppCreate(automaticAppDiscount: $d) {
       automaticAppDiscount { discountId title status startsAt endsAt }
       userErrors { field message }
     }
   }`, { d: input })

if (res.errors) { console.error('GraphQL ERRORS:', JSON.stringify(res.errors, null, 2)); process.exit(2) }
const out = res.data?.discountAutomaticAppCreate
if (out?.userErrors?.length) { console.error('USER ERRORS:', JSON.stringify(out.userErrors, null, 2)); process.exit(3) }
console.log('✅ CREATED:', JSON.stringify(out?.automaticAppDiscount, null, 2))
