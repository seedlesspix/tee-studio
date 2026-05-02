# Phase 1 Plan — Shopify Customer Account API Integration

Status: planning approved 2026-05-02. This is the source of truth for Phase 1 of [BUILD_PLAN.md](BUILD_PLAN.md). Update only after explicit replanning.

## Decisions locked in

- **Design-state survival across OAuth round-trip:** anonymous-draft row in `design_orders` (status `draft`) created before redirect; UUID carried in a short-lived OAuth-flow cookie; restored on callback by redirecting to `/designer?restore=<uuid>`. Robust to high-res image uploads that would blow past sessionStorage's ~5MB cliff. Doubles as Phase 3 groundwork for "My Designs."
- **Cleanup for abandoned drafts:** nightly job deletes `design_orders` rows with `status='draft' AND created_at < now() - interval '7 days'`. Implementation deferred to Phase 4 alongside the `_design_product` cleanup job.
- **OAuth client type:** Confidential client. Token endpoint auth method `client_secret_basic` (HTTP Basic header, the Shopify default). Verified supported on shopify.dev.
- **OAuth scopes:** `openid email customer-account-api:full`. Verified current literal against shopify.dev as of 2026-05-02.
- **Endpoint discovery:** OIDC discovery document fetched from the storefront domain at first use, cached in module memory for the process lifetime. Verified working at `https://tshirtdeli.com/.well-known/openid-configuration` — issuer `https://shopify.com/authentication/24068267`, all endpoints on `account.tshirtdeli.com`.
- **Cookie scope:** all `cust_*` cookies set host-only on `create.tshirtdeli.com` by omitting the `Domain` attribute entirely. Canonical pattern; do not set `Domain=create.tshirtdeli.com` even though it's equivalent.

## A. Shopify Admin Configuration

1. **Headless channel** — Shopify admin → Sales channels → Headless → open the storefront for `tshirtdeli.com` → Customer Account API tab.
2. **Application type:** Confidential.
3. **Callback URI(s):**
   - `https://create.tshirtdeli.com/auth/customer/callback`
   - `https://create.tshirtdeli.com/auth/customer/logout-callback`
   - `https://<cloudflare-tunnel-host>/auth/customer/callback` (dev)
4. **JavaScript origin(s):** `https://create.tshirtdeli.com` plus the tunnel host.
5. **Logout URI:** `https://create.tshirtdeli.com/`
6. **Scopes:** `openid email customer-account-api:full`

After saving, copy two values:
- **Client ID** (string starting `shp_…`)
- **Client secret** (revealed once — paste straight into Vercel env settings; do not commit anywhere)

The shop ID is *not* needed as an env var since we use discovery. (For the record, `24068267`.)

**Local dev tunneling — Cloudflare Tunnel** (chosen over ngrok for persistent named hostnames on the free tier; ngrok randomizes URLs every restart, which would mean re-editing the Shopify callback list each session):
```
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create tee-dev
cloudflared tunnel route dns tee-dev <hostname>
cloudflared tunnel run --url http://localhost:3000 tee-dev
```

Add the tunnel hostname to the Shopify callback list once.

**Env vars** (add to `.env.local` for dev and Vercel for prod):
```
SHOPIFY_STOREFRONT_DOMAIN=tshirtdeli.com                # used to fetch discovery doc; not Shopify Admin
SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID=shp_xxx
SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET=xxx              # server-only, no NEXT_PUBLIC_
NEXT_PUBLIC_APP_URL=https://create.tshirtdeli.com       # used to build redirect_uri; overridden in dev
```

## B. Code Architecture

**New files:**

| Path | Purpose |
|---|---|
| `app/lib/customer-account.ts` | All Customer Account API plumbing: discovery doc fetch + cache, JWKS fetch + cache, PKCE generation, authorize-URL builder, code exchange, refresh, logout, ID-token JWT verification, GraphQL helper. The single import surface for everything else. |
| `app/lib/customer-session.ts` | Cookie read/write helpers (`getSession()`, `setSession()`, `clearSession()`) — analog of `app/lib/supabase/server.ts`. Wraps `next/headers` `cookies()` the same way. |
| `app/api/customer/login/route.ts` | `GET` — creates an anonymous-draft row in `design_orders` when called from the designer, generates PKCE verifier + nonce + state, stashes them in short-lived HttpOnly cookies (including the draft UUID), redirects to the discovered authorization endpoint. |
| `app/auth/customer/callback/route.ts` | `GET` — validates `state` cookie, exchanges `code` for tokens, verifies ID token JWT against JWKS and validates `nonce`, writes `cust_*` session cookies, redirects to `/designer?restore=<draft_uuid>` (or `/` if no draft). Distinct path from existing `/auth/callback` (Supabase admin). |
| `app/api/customer/me/route.ts` | `GET` — reads `cust_id_token` cookie, verifies JWT signature against cached JWKS, returns `{ loggedIn, customer: { id, email, firstName, lastName } }` from JWT claims. **Zero Shopify network calls on the hot path.** Refresh access token if `cust_at_exp` is within 60s of expiry. |
| `app/api/customer/logout/route.ts` | `POST` — clears `cust_*` cookies, redirects browser to discovered `end_session_endpoint` with `id_token_hint` and `post_logout_redirect_uri`. |
| `app/auth/customer/logout-callback/route.ts` | `GET` — Shopify redirects here after server-side logout; bounces home. |
| `app/components/CustomerAuthButton.tsx` | Client component. Calls `/api/customer/me` on mount, renders "Log in" or "Hi, {firstName} ▾" with logout. Handles snapshot-before-redirect by POSTing canvas JSON to `/api/customer/login` and following the redirect. |
| `app/hooks/useCustomerSession.ts` | Tiny hook wrapping `/api/customer/me` so multiple components share the result. |

**Modified files:**

| Path | Change |
|---|---|
| `app/components/DesignerCanvas.tsx` | (1) render `<CustomerAuthButton />` in the floating top-right area of the canvas; (2) `snapshotDesignState()` helper called by the button — serializes color/variant/view/printMethod/quantities/frontObjects/backObjects/uploadedFiles, POSTs to `/api/customer/login` which writes the draft row before redirecting; (3) `restoreDesignState()` runs on mount when `?restore=<uuid>` is present, fetches the draft, repopulates state, then clears the URL param. |
| `proxy.ts` | No change. Customer session refresh happens lazily inside `/api/customer/me`. |
| `app/layout.tsx` | No change for Phase 1. No global header exists; login button lives inside the designer. |
| `.env.local.example` | New file at repo root with all env var names (Phase 1 vars plus existing Supabase/Shopify ones). |

**Runtime:** all new route handlers pin `export const runtime = 'nodejs'` (matching `app/api/cart-add/route.ts`) — needed for Node's `crypto` module (PKCE, JWT verification).

## C. Token & Session Model

**Cookies written on successful login** (all `HttpOnly`, `Secure`, `Path=/`, `SameSite=Lax`, no `Domain` attribute → host-only on `create.tshirtdeli.com`):

| Cookie | Lifetime | Contents |
|---|---|---|
| `cust_at` | matches access-token expiry (~1h per Shopify) | Customer Account API access token. Server-side only. |
| `cust_rt` | 30 days | Refresh token. Server-side only. |
| `cust_id_token` | matches `cust_at` | OIDC ID token (JWT). Source of truth for "am I logged in" — verified against JWKS, claims read directly. Also carried as `id_token_hint` at logout. |
| `cust_at_exp` | matches `cust_at` | Numeric epoch-ms expiry. Lets `/api/customer/me` decide proactive-refresh without parsing the JWT first. |

**Short-lived OAuth-flow cookies** (HttpOnly, Secure, SameSite=Lax, 10-minute Max-Age, deleted on callback completion):
- `cust_pkce_verifier` — PKCE verifier
- `cust_oauth_state` — random nonce; compared to incoming `state` query param (CSRF)
- `cust_oauth_nonce` — OIDC nonce; compared to JWT `nonce` claim (replay protection)
- `cust_oauth_draft_id` — UUID of the anonymous draft row (if login initiated from designer)

**Refresh logic:** `/api/customer/me` reads `cust_at_exp`. If `< now + 60s`, calls token endpoint with `grant_type=refresh_token` *before* anything else, writes new cookies on the response, then proceeds. If refresh fails (revoked/expired), clears all `cust_*` cookies and responds `{ loggedIn: false }`.

**"Am I logged in?" hot path:** `/api/customer/me` verifies the `cust_id_token` JWT signature against cached JWKS, decodes the claims, returns `{ loggedIn, customer: { id, email, firstName, lastName } }` from the JWT itself. **No network call to Shopify.** GraphQL is reserved for cases where we need fresher data than the token (none in Phase 1).

Tokens never reach the browser. XSS in the designer cannot steal the customer's Shopify session.

**Patterns mirrored from `app/lib/supabase/server.ts`:** `cookies()` from `next/headers`, the server-component try/catch around `cookieStore.set()` (server components cannot write cookies; only route handlers and middleware can), and the factory shape (`createCustomerClient()` returning an object with `getSession`, `refresh`, `clearSession`, `gql<T>()` methods). Same mental model, different backend.

## D. Forward-Compatibility for Phase 4 Cart Association

`app/lib/customer-account.ts` exports:

```
getCustomerAccessTokenForRequest(req): Promise<string | null>
```

Reads `cust_at` from request cookies, refreshes if expired, returns the bearer string — or `null` if anonymous. Phase 4's dynamic-product cart-add will call this and, when a token is present, also call Storefront API `cart.buyerIdentityUpdate` with `customerAccessToken: <token>` to bind the cart.

The existing `app/api/cart-add/route.ts` does not change in Phase 1; Phase 4 will replace it wholesale per BUILD_PLAN.md.

Caveat: Storefront API and Customer Account API use different access-token formats. When Phase 4 lands, decide whether to (a) issue a Storefront customer token alongside the CA API token at login, or (b) do all cart operations via Customer Account API's GraphQL surface. Decision deferred — the helper is the seam.

## E. Risks & Open Questions

1. **🟡 Two callback paths share `/auth/`.** `/auth/callback` is Supabase admin; `/auth/customer/callback` is Shopify customer. Distinct paths, no collision, but the directory now serves two unrelated auth systems. Not worth renaming Supabase's path (would require updating its magic-link template URL).
2. **🟡 No global header today.** Designer is full-screen; `app/page.tsx` is boilerplate. Phase 1 puts login button inside the designer. Real shared header is a Phase 3 concern.
3. **🟡 `proxy.ts` already runs Supabase session refresh per request** for anonymous designer users. Adding a second middleware refresh for Customer Account API would double the cost; lazy refresh inside `/api/customer/me` keeps the anonymous path fast.
4. **🟢 ID token JWT verification** removes the rate-limit concern. JWKS cached in module memory, refreshed on `kid` miss.

## F. Build Order (~1 week)

- **Day 1** — Shopify config + Cloudflare Tunnel + env vars. (User-side; non-coding.) **STOP and verify Shopify-side config before Day 2.**
- **Day 2** — Auth lib (`customer-account.ts`, `customer-session.ts`) + `/api/customer/login`. Test redirect to Shopify consent screen.
- **Day 3** — `/auth/customer/callback` route + JWKS fetch/verify. Test full round-trip lands cookies. Inspect in DevTools.
- **Day 4** — `/api/customer/me` (JWT-verified hot path) + logout + `<CustomerAuthButton />` + `useCustomerSession`. Test login/logout/refresh.
- **Day 5** — Designer integration: anonymous-draft creation, snapshot, restore. Test full design-survival round-trip.
- **Day 6** — Hardening: mobile Safari, refresh-token expiry, denied consent, interrupted callback, concurrent tabs. Minimal logging.
- **Day 7** — Buffer + `CLAUDE.md` updates (env vars, auth flow overview).
