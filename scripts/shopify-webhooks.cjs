// List or create this app's Shopify webhook subscriptions.
//
//   node scripts/shopify-webhooks.cjs list
//   node scripts/shopify-webhooks.cjs create ORDERS_CANCELLED https://create.tshirtdeli.com/api/shopify-webhook
//
// WHY A SCRIPT: our webhooks are APP subscriptions, created through the Admin API by the custom app
// (client-credentials grant with SHOPIFY_ADMIN_CLIENT_ID/SECRET from .env.local — the same auth as
// app/lib/shopify-admin.ts). Shopify admin → Settings → Notifications → Webhooks lists ONLY hand-made
// webhooks, so that page is empty by design and can't be used to see or add ours (the blind-surfaces
// rule in CLAUDE.md, in the other direction). App subscriptions are signed with the app's CLIENT SECRET,
// which /api/shopify-webhook accepts as its first candidate. Prints no secrets.
const fs = require('fs')
const env = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const API_VERSION = '2026-01'
const [mode, topic, callbackUrl] = process.argv.slice(2)

async function main() {
  const tok = await fetch(`https://${env.SHOPIFY_ADMIN_DOMAIN}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.SHOPIFY_ADMIN_CLIENT_ID, client_secret: env.SHOPIFY_ADMIN_CLIENT_SECRET }),
  })
  if (!tok.ok) { console.error('token mint failed', tok.status); process.exit(1) }
  const { access_token } = await tok.json()
  const gql = async (query, variables) => {
    const r = await fetch(`https://${env.SHOPIFY_ADMIN_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': access_token }, body: JSON.stringify({ query, variables }),
    })
    const j = await r.json()
    if (j.errors) { console.error('GraphQL errors:', JSON.stringify(j.errors)); process.exit(1) }
    return j.data
  }
  const list = async () => {
    const d = await gql(`{ webhookSubscriptions(first: 50) { nodes { id topic format createdAt apiVersion { handle } endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } } }`)
    console.log(`app webhook subscriptions: ${d.webhookSubscriptions.nodes.length}`)
    for (const n of d.webhookSubscriptions.nodes) {
      console.log(`  ${n.topic.padEnd(18)} ${n.format.padEnd(5)} api=${n.apiVersion.handle.padEnd(8)} created=${n.createdAt.slice(0, 10)}  → ${n.endpoint.callbackUrl ?? n.endpoint.__typename}   [${n.id.split('/').pop()}]`)
    }
  }
  if (mode === 'list') return list()
  if (mode === 'create' && topic && callbackUrl) {
    const d = await gql(`mutation($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
        webhookSubscription { id topic } userErrors { field message }
      } }`, { topic, sub: { callbackUrl, format: 'JSON' } })
    console.log(JSON.stringify(d.webhookSubscriptionCreate, null, 2))
    return list()
  }
  console.log('usage: node scripts/shopify-webhooks.cjs list | create <TOPIC> <callbackUrl>')
}
main()
