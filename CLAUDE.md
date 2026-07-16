# Tee Studio — Development Guide

## Project Overview

**Tee Studio** is a custom t-shirt design tool that integrates with Shopify for product management and checkout. Users can design t-shirts using a canvas-based interface with text, clipart, and image uploads, then add personalized designs to their cart.

## Planning & Roadmap

The current path-to-replacing-ImprintNext build plan lives in [BUILD_PLAN.md](BUILD_PLAN.md) — read it before starting work that touches cart, designer, pricing, or admin areas, since today's code may need to evolve to fit the documented architecture.

## Full Stack

- **Frontend Framework**: Next.js 16.2.4 (App Router)
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS 4 + PostCSS
- **Canvas Library**: Fabric.js 7.3.1
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage (clipart, design previews)
- **E-commerce**: Shopify Storefront API
- **Hosting**: Vercel (implied from package.json and deployment structure)
- **UI Components**: Radix UI (dialog, slider, tabs)
- **Icons**: Lucide React
- **Export**: html2canvas 1.4.1, pdfjs-dist 5.7.284
- **Utilities**: clsx (classname management)

## Main File Structure

```
tee-studio/
├── proxy.ts                          # Root proxy (Next.js 16 — formerly middleware.ts) — refreshes Supabase session per request
│
├── app/
│   ├── layout.tsx                    # Root layout with custom fonts
│   ├── page.tsx                      # Landing page (boilerplate)
│   ├── globals.css                   # Tailwind + @font-face declarations
│   │
│   ├── designer/
│   │   └── page.tsx                  # Designer interface entry point
│   │
│   ├── components/
│   │   ├── DesignerCanvas.tsx        # Main canvas (800+ lines) - Fabric.js integration
│   │   └── ClipartPanel.tsx          # Clipart browser sidebar
│   │
│   ├── lib/
│   │   ├── supabase.ts               # Singleton browser client (@supabase/ssr) — used by designer + admin
│   │   ├── supabase/
│   │   │   ├── browser.ts            # createBrowserClient factory (used by login page)
│   │   │   ├── server.ts             # createServerClient factory (server components, route handlers)
│   │   │   └── middleware.ts         # updateSession helper for root proxy.ts
│   │   └── shopify.ts                # Shopify Storefront API client
│   │
│   ├── api/
│   │   ├── product/route.ts          # GET product data from Shopify
│   │   ├── preview/route.ts          # CORS proxy for shirt images
│   │   ├── admin-upload/route.ts     # POST clipart (auth-gated by Supabase session + ADMIN_EMAILS)
│   │   └── shopify-webhook/route.ts  # Updates design_orders on Shopify order completion (service role)
│   │
│   ├── auth/
│   │   └── callback/route.ts         # Magic-link callback (still wired as fallback)
│   │
│   ├── admin/
│   │   ├── layout.tsx                # Auth gate (Supabase session + email allowlist) + shared header
│   │   ├── AdminTabs.tsx             # Active-tab nav (Clipart / Orders / Pricing)
│   │   ├── SignOutButton.tsx         # Calls supabase.auth.signOut()
│   │   ├── clipart/page.tsx          # Clipart management
│   │   ├── orders/page.tsx           # Design orders history
│   │   └── pricing/page.tsx          # Pricing configuration
│   │
│   ├── admin-login/
│   │   └── page.tsx                  # OTP code login (8-digit code via email)
│   │
│   ├── order/
│   │   └── page.tsx                  # Order summary & Shopify cart creation
│   │
│   └── types/                        # (empty - types defined inline)
│
├── public/
│   └── fonts/
│       └── Rockwell.ttc              # Custom fonts
│
├── package.json                      # Dependencies & scripts
├── tsconfig.json                     # TypeScript strict mode config
├── next.config.ts                    # Minimal Next.js config
├── eslint.config.mjs                 # ESLint with Next.js standards
├── postcss.config.mjs                # PostCSS/Tailwind config
├── tailwind.config.ts                # (inferred from Tailwind setup)
│
├── AGENTS.md                         # Next.js version notes
├── CLAUDE.md                         # This file
├── README.md                         # Default Next.js README
│
└── Utility Scripts (local development)
    └── bulk-clipart.mjs              # Bulk upload clipart to Supabase
```

## Database Schema (Supabase)

All public tables have **RLS enabled**. Admin DB writes are gated by `app_metadata.is_admin = true` on the user's `auth.users` row, checked via the `public.is_admin()` SQL function from policies.

Active tables:
- **clipart_categories** - Category groupings for clipart (`is_active`, `sort_order`, `print_method_key`). Public read.
- **clipart_items** - Individual clipart files (`file_url`, `file_type`, `tags`, `is_active`, `sort_order`). Public read of active items; admin full CRUD.
- **designer_print_methods** - Print method registry (e.g. `screen_print`). Public read.
- **designer_fonts** - Font library per print method. Public read.
- **designer_colors** - Color palette per print method. Public read.
- **designer_pricing** - Print charges per method × sides. Public read of active rows; admin full CRUD.
- **design_orders** - Anonymous design + order records. Public read/insert/update for non-completed orders; once `status='completed'` (set by Shopify webhook), only admin + service role can touch the row. PII (customer email/phone/address) is only present on completed orders.

Scaffolding (unused by current app, but RLS-policied for future "customer accounts" feature):
- **profiles** - User profile rows. Auto-created by `on_auth_user_created` trigger when `auth.users` row is inserted.
- **designs** - Saved designs tied to `user_id`.
- **orders** - Orders tied to `user_id`.

Storage:
- **clipart** bucket - Public-readable, used for clipart file uploads

### designer_pricing operational rules

> **⚡ PHASE 4 (2026-07-16) RETIRED THE PRINT CHARGE CART MACHINERY.** A
> finished design now becomes an **ephemeral Shopify product** whose per-size
> variants carry the design's full `price_per_item` (blank + print charges
> folded in), published to the Online Store with `seo.hidden=1`, and joins the
> **customer's real session cart** via
> `POST /api/design-orders/[id]/add-to-cart` (their own `/cart/add.js`,
> cookies forwarded — the app lives at create.tshirtdeli.com, same site as the
> store). Designs mix with off-the-shelf products in one cart / one checkout;
> the webhook processes every `_design_order_id` in an order. There are **no
> Print Charge line items** anymore, and
> **`designer_pricing.shopify_variant_id` is legacy config that checkout never
> reads** (the admin field is labeled accordingly). `price_add` is still fully
> live — the designer sums it into `price_per_item` at design time. Deleted,
> not bypassed: `addItemsToShopifyCart`, `resolvePrintChargeVariant`,
> `/api/cart-add`, `/api/admin/variant-check` + the pricing admin's
> reachability badge. Blank products are **designer-only** (Option A,
> 2026-07-16): never sold standalone, so a blank line can never coexist with
> its folded design product (no double-charge shape). The historical rules
> below are kept for context on rows/orders created before Phase 4.

> **(Historical, pre-Phase 4)** When adding a new row to `designer_pricing`, both `price_add` AND `shopify_variant_id` had to be set, or cart-add failed with a clear error message for that print method × sides combination.

The `shopify_variant_id` column points at a Shopify Print Charge product variant. In the pre-Phase-4 flow, when a customer added a screen-print design to their cart, the cart-add flow looked up this variant per side that has rendered content (`canvas_png_front` → `(screen_print, sides=1)`; `canvas_png_back` → `(screen_print, sides=2)`) and added a separate Print Charge line item with quantity equal to the total shirt count. A NULL `shopify_variant_id` was treated as a configuration error — the resolver aborted the entire cart-add (no partial cart state) and surfaced a "missing Shopify variant ID" message to the customer.

> **⚠️ A populated `shopify_variant_id` is NOT enough — the variant must also be
> PUBLISHED to the Online Store sales channel.** Phase 3 sign-off hit
> `Could not add to cart: Cannot find variant` with all three Print Charge
> variant IDs present and **exactly matching** Shopify. Root cause: the Print
> Charge product wasn't published to the **Online Store** channel. Cart-add
> proxies to `/cart/add.js` (Online Store), so an unpublished product's variants
> don't exist as far as the cart is concerned. The rule above only guards
> *presence*, not *reachability* — that's the hole.
>
> **Channels are independent, and this store proves it:** after publishing to
> Online Store, cart-add works while the **Storefront API still returns `null`**
> for those same variants (the Storefront token's channel is a separate
> publication). So **never validate cart-ability via the Storefront API** — it is
> not the surface the cart uses. Garment products need BOTH (Storefront API for
> the designer's `getProduct`, Online Store for the cart); Print Charge needs
> only the Online Store.

**Print pricing is FLAT PER SIDE regardless of garment — decided 2026-07-15.**
A baby onesie print costs the same as an adult tee print. This surfaced at Phase 3
sign-off (`designer_pricing` is keyed by `print_method_key` × `sides` only, with
no product dimension) and was **reviewed and kept deliberately** — the charge
represents the print, not the garment. It is a business decision, not an
oversight: don't "fix" it. Per-product pricing remains expressible through the
pricing admin if the business ever changes course.

**Embroidery is intentionally dormant.** Embroidery products currently bake the embroidery cost into the base product price (a $32 polo includes embroidery, not $22 + $10 surcharge), so the embroidery rows in `designer_pricing` carry `price_add = 0` in effect. (Historical: the Shopify Print Charge product had a third variant for embroidery, `53029191123260`, deliberately left unwired — moot since Phase 4 retired Print Charge variants from checkout entirely.)

**To switch embroidery to a surcharge model in the future (post-Phase 4, much simpler):**
1. Lower base product prices in Shopify by the embroidery cost (e.g., $32 polo → $22).
2. Set `price_add` on the embroidery row(s) in `designer_pricing`. That's it — the designer folds `price_add` into `price_per_item`, and the ephemeral checkout product carries the folded price. No Shopify variant, no cart code change.

**Terminology note.** Customer-facing UI uses the word **"print"**; the internal database key in `designer_pricing.print_method_key` and `design_orders.print_method` remains `screen_print`. Cosmetic-only inconsistency, not functional. Rename later if it causes confusion.

### Database TypeScript types

Generated from the live schema and committed at **`types/database.ts`**. The four Supabase clients in `app/lib/supabase.ts` and `app/lib/supabase/{browser,server,middleware}.ts` are typed with `<Database>`, so `supabase.from(...)` calls have full autocomplete and type-checking.

Use the generated types directly in components:

```ts
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database'

type ClipartItem = Tables<'clipart_items'>            // SELECT shape
type NewItem = TablesInsert<'clipart_items'>          // INSERT shape
type ItemPatch = TablesUpdate<'clipart_items'>        // UPDATE shape
```

JSON columns (`quantities`, `uploaded_files`, `shipping_address`) come back as the broad `Json` type. When a component knows the actual shape, override with `Omit<...> & {...}`:

```ts
type Order = Omit<Tables<'design_orders'>, 'quantities'> & {
  quantities: Record<string, number> | null
}
```

**Regenerating after schema changes:**

The types file is a snapshot. Whenever the schema changes (migration applied, column added/dropped/altered, table created), regenerate with:

```bash
npx supabase gen types typescript --project-id yatiairlyensmcwbpldx > types/database.ts
```

Or ask Claude in any session — the Supabase MCP has `generate_typescript_types` wired up. After regenerating, run `npx tsc --noEmit` to surface any code that no longer matches the schema.

### Database migrations

> **🚨 HARD RULE — DO NOT SKIP, EVEN FOR "TRIVIAL" CHANGES 🚨**
>
> **Before applying any migration via the Supabase MCP `apply_migration` tool, the SQL must be shown to the user in plain language with a clear explanation of what it does, and explicit approval must be received. Never apply a migration without this step, even for changes that seem trivial.**
>
> "Trivial" includes: adding a column, dropping a column, changing a default, renaming, adding/removing an index, changing an RLS policy, seeding data, granting permissions. All of them require the show-and-approve step. No exceptions.
>
> The user is non-technical. "Plain language" means: name the table, describe what's changing in everyday terms, and call out anything irreversible (dropped columns, deleted rows, policy changes that affect access).

**Where migration files live:**

```
supabase/migrations/<YYYYMMDDHHMMSS>_<snake_case_name>.sql
```

The folder is the canonical record of the schema. The 9 pre-existing migrations were backfilled from the Supabase server on 2026-05-01 by reading `supabase_migrations.schema_migrations.statements`.

**Workflow for a new schema change (always all five steps, in order):**

1. **Show the user the SQL** in plain language with a clear explanation. Wait for explicit approval.
2. **Apply via MCP** `apply_migration` — Supabase records it server-side and assigns a timestamp version.
3. **Write the SQL to a file** at `supabase/migrations/<version>_<name>.sql` so git captures it. Use the same `<version>` and `<name>` you passed to `apply_migration` so the file matches the server's migration history exactly.
4. **Regenerate types** at `types/database.ts` (see "Regenerating after schema changes" above) and run `npx tsc --noEmit`.
5. **Commit** the migration file + regenerated types + any code changes together, in one commit, so the schema and the code that depends on it stay in lockstep.

**Verifying the repo and the live DB are in sync:**

Compare versions in `supabase/migrations/` filenames against the output of MCP `list_migrations`. If a row exists on the server with no matching file (or vice versa), there's drift — investigate before doing anything else.

## Code Patterns & Conventions

### Component Architecture
- **Functional React components** with hooks (`useState`, `useEffect`, `useCallback`, `useRef`)
- **Server Components** for protected routes (admin layout checks auth)
- **Client Components** ("use client") for interactive features
- **Suspense** wrappers for loading states

### State Management
- **React hooks** only — no Redux, Zustand, or Context API
- Heavy use of `useState` and `useCallback` for local state
- Module-level variables for persistence across re-renders (e.g., `_activeObj`)

### Styling
- **Tailwind classes** throughout
- **Designer / main app**: dark UI palette (`#0d0d0d`, `#1e1e1e`, `#2a2a2a` surfaces)
- **Admin + admin-login**: light UI palette (white surfaces, gray-100/200/300, black text)
- Accent: `#dd3333` (red) — primary buttons everywhere are red bg with white text
- Responsive breakpoints: `sm:`, `md:` prefixes

### TypeScript Usage
- **Interfaces** for component props and API responses (inline, not in separate files)
- **Type unions** for state (`'text' | 'upload' | 'clipart' | 'style'`)
- **`Record<string, type>`** for flexible object maps

### API Route Patterns
- Simple `GET`/`POST` handlers
- Error responses with 400/401/404/500 status codes
- Environment variable access via `process.env`

### Data Flow
1. Query params passed to page components (productId, variantId, designId)
2. Components fetch from APIs (Shopify, Supabase)
3. User designs stored to `design_orders` table
4. Cart creation via Shopify Storefront API

## Known Issues / Tech Debt

### Architecture & Structure
- **Monolithic component**: `DesignerCanvas.tsx` is 800+ lines and mixes canvas logic, UI rendering, API calls, and business logic — should be split into smaller components
- **No TypeScript interfaces**: Types defined inline throughout; should create a centralized `types/index.ts` file
- **No error boundaries**: Canvas operations could crash the app without recovery UI
- **Module-level global state**: `_activeObj` persists across re-renders — should use proper React patterns

### Authentication & Security (current state — addressed 2026-04-30)
- **Admin auth**: Supabase Auth with OTP code flow (8-digit emailed code). Email allowlist via `ADMIN_EMAILS` env var enforced in `app/admin/layout.tsx` and `app/api/admin-upload/route.ts`. SMTP routed through Resend (`noreply@auth.tshirtdeli.com`).
- **Admin DB role**: orthogonal to the env-var allowlist — `auth.users.app_metadata.is_admin = true` controls RLS write access. New admins must have BOTH the env var entry AND the `is_admin` flag set, then sign out/in to mint a fresh JWT.
- **RLS**: enabled on all 10 public tables. `design_orders` has the only nuanced policy — public can read/write non-completed rows; completed rows are admin/service-role only (PII protection).
- **Open URL-as-key model on draft orders**: anyone with a `design_orders.id` UUID can read/modify a draft. Acceptable given UUIDs are unguessable; "real" fix is the deferred customer-accounts feature (the empty `profiles`/`designs`/`orders` tables).
- **Customer session — revoked-token staleness (known Phase 1 limitation, revisit Phase 4)**: `/api/customer/me` decides "am I logged in?" by verifying the ID-token JWT signature locally against the cached JWKS — it makes **no** live Shopify API call on the hot path (by design, for speed). So if a customer's Shopify session is server-side revoked or their account is deleted while our access token is still unexpired, the JWT still verifies and the UI shows them as logged in with stale name/email. **Bound: max ~1 hour** — at the next access-token expiry the proactive refresh in `/api/customer/me` runs, Shopify rejects the (also-revoked) refresh token with `invalid_grant`, and all `cust_*` cookies are cleared. **No functional impact in Phase 1** because we make no authenticated Shopify calls that could 401 — it's purely a cosmetic "ghost logged-in" window. Phase 4 (cart association via Customer Account API) will make real authenticated calls, so revisit then: either verify against Shopify on sensitive actions or shorten the access-token lifetime.
- **`/api/debug` is gated** behind `DEBUG_SECRET` (query param `?secret=`, constant-time compared). Fails closed → 404 when the env var is unset or the secret is missing/wrong, so the endpoint isn't discoverable. Returns only presence + length of the client secret, never any bytes. `DEBUG_SECRET` must be set in `.env.local` (dev) and Vercel (prod).

### Missing Infrastructure
- **Empty types directory**: No shared types or interfaces
- **Boilerplate landing page**: `app/page.tsx` still shows default Next.js template
- **No environment validation**: Missing `.env.local` documentation or runtime validation
- **No testing setup**: No Jest, Vitest, or testing libraries configured
- ~~**Partial migration history**~~: ✅ Resolved 2026-05-01 — all 9 prior migrations backfilled from `supabase_migrations.schema_migrations` into `supabase/migrations/`. Going-forward workflow + hard approval rule documented in the "Database migrations" section above.

### Code Quality
- **Inconsistent naming**: Snake_case in database, camelCase in components
- **Hardcoded values**: Color maps, sizes (`SIZES = ['S', 'M', 'L', ...]`), pricing scattered throughout
- **Magic numbers**: Font sizes, canvas constraints, percentage calculations

### Performance & Optimization
- **Large bundle size**: All fonts loaded upfront (Google Fonts + local fonts)
- **No image optimization**: Product images fetched directly from Shopify without resizing
- **Unoptimized Fabric.js**: Canvas operations could batch updates or use Web Workers
- **No caching**: No Redis or HTTP cache layer for expensive queries
- **Download all clipart**: `ClipartPanel` loads all items for search (no pagination)

### Features & Missing Pieces
- **Incomplete print methods**: Code references `printMethod` but configuration unclear
- **Back image support**: Logic for front/back shirt designs exists but incomplete
- **No undo/redo**: Canvas doesn't track action history
- **No save drafts**: Designs only saved at checkout
- **No design sharing**: No public gallery or social sharing
- **Webhook**: `shopify-webhook/route.ts` updates `design_orders` on Shopify `order/paid` — sets `status='completed'`, customer info, shipping. Not pointed at by Shopify yet — register the webhook URL in Shopify admin to activate.
- **Volume discount removed (2026-05-02)**: The order page UI used to apply 10/15/20% off at 6/12/24 shirts, but Shopify wasn't honoring it at checkout — the discount was UI-only math, never sent to Shopify. After Print Charges became real cart line items, the UI total would have undercharged customers visibly, so the discount feature was removed entirely from `app/order/page.tsx` and `app/components/DesignerCanvas.tsx`. **To reintroduce:** use Shopify automatic discounts (admin → Discounts → Automatic) keyed off cart quantity, not custom UI math. This avoids the UI/checkout pricing-mismatch bug.

### Documentation
- **No API docs**: Endpoint parameters and responses undocumented
- **No database schema documentation**: Supabase tables not formally documented
- **No environment guide**: Missing `.env.local.example` or setup instructions
- **No deployment guide**: Vercel setup not documented

### Dependencies
- **Next.js 16.2.4** is very recent; may have stability or compatibility issues
- **React 19.2.4** (RC/beta at training cutoff) — consider pinning if issues arise
- **Supabase clients**: Now using `@supabase/ssr` for SSR-aware browser/server clients. Legacy `@supabase/auth-helpers-nextjs` is still in `package.json` but unused — safe to remove.

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.local.example .env.local
# Edit with your Supabase and Shopify credentials

# Run development server
npm run dev
# Open http://localhost:3000

# Build for production
npm run build

# Lint code
npm run lint
```

## Environment Variables

Every variable the app reads. `NEXT_PUBLIC_*` values are inlined into the
client bundle at build time (visible in the browser) — never put a secret
behind that prefix. Everything else is server-only. A `.env.local.example`
lives at the repo root with placeholders; copy it to `.env.local` for dev and
set the same names in the Vercel dashboard for prod.

**"Sensitive in Vercel"** = mark the variable Sensitive when adding it in
Vercel so its value can't be read back in the dashboard/logs. Only true
secrets need this; `NEXT_PUBLIC_*` values ship to the browser anyway so there's
nothing to hide.

| Variable | Req? | Server/Public | Sensitive in Vercel | What it's for |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Required | Public | No | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required | Public | No | Supabase anon key; RLS-gated, safe in the browser. |
| `SUPABASE_SERVICE_ROLE_KEY` | Required | Server | **Yes** | Full-access DB key. Used by the Shopify webhook to write completed orders. |
| `ADMIN_EMAILS` | Required | Server | No | Comma-separated allowlist for the `/admin` area. |
| `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` | Required | Public | No | Storefront domain for the Storefront API client (`app/lib/shopify.ts`). |
| `NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN` | Required | Public | No | Storefront API public access token (product data + cart). |
| `SHOPIFY_WEBHOOK_SECRET` | Required¹ | Server | **Yes** | Verifies inbound `order/paid` webhook HMAC signatures. |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` | Optional | Public | No | Cloudinary cloud for AI/PSD/EPS upload conversion in the designer. |
| `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET` | Optional | Public | No | Cloudinary unsigned upload preset (pairs with the cloud name). |
| `SHOPIFY_STOREFRONT_DOMAIN` | Required² | Server | No | Domain used to fetch the OIDC discovery doc (`/.well-known/openid-configuration`). |
| `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID` | Required² | Server | No | Confidential OAuth client ID (Customer Account API). |
| `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET` | Required² | Server | **Yes** | Confidential OAuth client secret (`client_secret_basic` at the token endpoint). |
| `NEXT_PUBLIC_APP_URL` | Required² | Public | No | Public origin used to build the OAuth `redirect_uri`; must match Shopify's registered callback. |
| `DEBUG_SECRET` | Optional | Server | **Yes** | Shared secret gating `/api/debug` (`?secret=…`). Unset → endpoint 404s (fails closed). |

¹ Required only once the Shopify `order/paid` webhook is registered (see the
webhook note in Known Issues). ² Required for the Phase 1 customer-login flow.

> **Legacy/unused:** `.env.local` also contains `SHOPIFY_STOREFRONT_PRIVATE_TOKEN`,
> which is **not referenced anywhere in the code** — the Storefront client uses the
> public token above. Left in place harmlessly; safe to remove.

## Customer Auth Flow

Plain-English walkthrough of a customer logging in from the designer (Shopify
Customer Account API, OpenID Connect). All tokens stay server-side in HttpOnly
cookies — they never touch the browser's JS.

1. **Click "Log in"** (`CustomerAuthButton` in the designer top bar). Before
   redirecting, the designer **snapshots the in-progress design** — colors,
   view, quantities, front/back canvas, uploads — to a `design_orders` row with
   `status='draft'` via `POST /api/designs/draft`, which returns a `draftId`.
2. **Redirect to login** at `/api/customer/login?return_to=/designer?…&restore=<draftId>`.
   That route generates a random `state` (CSRF) and `nonce` (replay protection),
   stashes them plus `return_to` in three short-lived (10 min) HttpOnly
   `cust_oauth_*` cookies, and 302s the browser to Shopify's authorization
   endpoint (discovered from the OIDC doc).
3. **Customer logs in at Shopify** (`account.<domain>`) and consents.
4. **Shopify redirects back** to `/auth/customer/callback?code=…&state=…`. The
   callback **verifies `state`** against the cookie (constant-time), then does a
   **server-side token exchange** (`authorization_code` grant, authenticated
   with `client_secret_basic`) to get access/refresh/ID tokens.
5. **ID token verified locally** — JWT signature checked against Shopify's JWKS
   (cached in memory), plus issuer, audience (our client ID), and the `nonce`
   claim against the cookie. No network call to Shopify beyond the one-time
   token exchange.
6. **Session cookies set** — `cust_at`, `cust_rt`, `cust_id_token`, `cust_at_exp`
   (all HttpOnly/Secure/SameSite=Lax, host-only). The flow cookies are cleared.
7. **Redirect to `return_to`** (`/designer?…&restore=<draftId>`). On mount the
   designer fetches `GET /api/designs/draft?id=<draftId>` and **rehydrates the
   canvas**, then strips `?restore=` from the URL so a refresh doesn't re-restore.

**"Am I logged in?"** — `GET /api/customer/me` verifies the ID-token JWT
locally (network-free after the first JWKS fetch) and returns the customer
summary from the token claims. It proactively refreshes the access token when
it's within 60s of expiry; if the refresh fails (e.g. expired/revoked refresh
token) it clears all `cust_*` cookies and returns `{ loggedIn: false }`. The
`useCustomerSession` hook caches this app-wide and revalidates on tab focus.

**Logout** — the "Log out" control is a plain **GET** link to
`/api/customer/logout` (GET, not a POST form, so the browser stays on GET
through the whole redirect chain). That route clears the `cust_*` cookies and
redirects to Shopify's `end_session_endpoint` (with `id_token_hint`), which
signs the customer out at Shopify and bounces back to
`/auth/customer/logout-callback` → home. Shopify's `end_session_endpoint`
**only accepts GET** — hence the GET link (and a 303 fallback on the route).

### Known bounds / future considerations

- **No PKCE — intentional.** We're a **Confidential** OAuth client and
  authenticate with `client_secret_basic`. Shopify **rejects** requests that
  combine `client_secret_basic` with a PKCE `code_verifier`, and the error it
  returns is a misleading `invalid_client` (cost ~2 days to diagnose once).
  Do **not** reintroduce PKCE into this flow. If a future phase adds a **Public**
  client for a different surface (native mobile app, browser extension), PKCE
  comes back **for that flow only** — never mixed with the confidential one.
- **Revoked-account ghost (~1 hour bound).** `/api/customer/me` verifies the ID
  token locally and makes no live Shopify call, so if a customer's Shopify
  account is deleted or their session revoked while the access token is still
  unexpired, the UI keeps showing them logged in (with stale name/email) until
  the next proactive refresh (≤ ~1h), at which point the refresh fails and
  cookies clear. **No functional impact in Phase 1** — we make no authenticated
  Shopify calls that could 401. Revisit for **Phase 4** cart binding (verify
  against Shopify on sensitive actions, or shorten the access-token lifetime).
- **Draft rows accumulate.** Every login-from-designer (and every "Next Step")
  writes a `status='draft'` row to `design_orders`; abandoned ones are never
  cleaned up today. **Phase 4/5 should add a nightly cron** that deletes
  `WHERE status='draft' AND created_at < now() - interval '7 days'`. The
  `created_at` column is set explicitly on draft insert so the job can find them.
  > **🚨 THE CRON MUST EXCLUDE SAVED DESIGNS 🚨** — a customer's "My Designs"
  > entry (Day 8) points at a `design_orders` row that is *still* `status='draft'`,
  > and `saved_designs.design_order_id` is **`ON DELETE CASCADE`**. A naive
  > age-based delete would therefore **silently destroy customers' saved work**
  > (the row goes, and the library entry cascades away with it — no error, no
  > trace). Whoever builds the cron must add:
  > ```sql
  > AND NOT EXISTS (SELECT 1 FROM saved_designs sd WHERE sd.design_order_id = design_orders.id)
  > ```
  > Same applies to any future bulk cleanup/archival of `design_orders`.

### Phase 1 sign-off findings (deferred to Phase 3/4)

Surfaced during Phase 1 sign-off testing. None block Phase 1 close-out; each is
routed to a later phase. Logged here so they aren't rediscovered from scratch.

- **Product color/size doesn't pre-populate in the designer** (Phase 3 Item 1).
  Landing on the designer from a product page doesn't carry the selected color
  and size into the canvas; the customer has to re-pick them.
- **"Add Text" button UX is unclear** (new Phase 3 polish item). Customers don't
  understand how to place text on the shirt — the affordance for adding and
  positioning a text object needs to be made obvious.
- ~~**Print-charge per-side pricing miscalculates** (Phase 3 Item 5).~~ **✅ Fixed
  in Phase 2 Day 1.** The designer looked up the charge by *count* of sides
  (`printPricing[sidesCount]`) instead of summing per side, so a 2-sided design
  displayed the single Back-row price ($12) instead of $12+$12. Now sums the
  price for each side that has content, in `DesignerCanvas.tsx`. Was display-only
  (checkout already charged correctly via per-side variant line items).
- **Back button from "Next Step" loses design work** (Phase 3 Item 6). Navigating
  back out of the order/Next-Step page drops the in-progress canvas state.
- **Cart-add fails with "Cannot find variant"** (related to Phase 3 Item 1, or
  Phase 4 cart architecture). The Shopify variant resolution fails on cart-add;
  likely tied to the un-propagated color/size (Item 1) or resolved wholesale by
  the Phase 4 cart rework.
- **Browser back from Shopify login abandons the design** (Phase 3 polish).
  Hitting the browser back button from Shopify's login page loses the snapshotted
  design state. Explicitly out of scope for the Phase 1 logout fix.

### Phase 2 notes

- **Public-read consistency: colors/fonts vs. pricing.** `designer_colors` and
  `designer_fonts` use `USING true` for public read, so they return inactive
  rows too — filtering `is_active` is a **React-side responsibility**, not
  DB-enforced. `designer_pricing` uses the stricter `USING (is_active = true)`.
  Left unaligned intentionally (the designer filters client-side today). Worth
  aligning if we see any inactive-row leak bugs in the wild or during Phase 3.
  Admin write access on colors/fonts/`clipart_categories` was added 2026-07-11
  via `admin_write_policies_colors_fonts_categories` (mirrors the
  `designer_pricing`/`clipart_items` `is_admin()` pattern).
- **New print areas beyond front/back are out of scope for Phase 2.** The
  pricing admin only exposes sides 1 (Front) and 2 (Back) because that's all
  the data model, designer canvas, cart-add resolver, and Shopify variant
  registry understand. Adding areas like "shoulder print" or "sleeve" requires
  coordinated changes across the designer canvas + cart + variant model — a
  Phase 3+ scoping effort, not a pricing-table addition.
- **Font management in admin is currently READ-ONLY.** Existing fonts can be
  edited/toggled/reordered/deleted, but **adding new fonts requires a code
  change** (Google Fonts `<link>` in `app/layout.tsx`, or `@font-face` in
  `app/globals.css`). A future phase should build proper "Font Management" as a
  single project that handles both adding Google fonts and uploading custom
  fonts through admin. This requires building **dynamic font loading** (runtime
  `<link>` injection for Google, dynamic `@font-face` for uploads to Supabase
  Storage) — it's ~1–2 days of infrastructure work before the admin UI can be
  built on top of it. Doing them together as one project is cleaner than
  piecemeal.
- **Product template print areas: pixels vs. percentages (Phase 3 reconcile).**
  The current designer reads print areas in **percentages** from a Shopify
  metafield (`designer.print_area` → `xPct/yPct/widthPct/heightPct`). The new
  `product_template_print_areas` schema stores **pixels** (plus inches for
  Phase 5 print scaling). Day 7 built only the **admin capture** side — the
  `/admin/templates` print-area editor stores coordinates in the mockup's
  **natural pixel space**. The **designer read layer is deferred to Phase 3**:
  it must convert those px→% at designer load (using the same mockup natural
  dimensions), or migrate the designer to native pixel reads. Until then, print
  areas drawn in admin do **not** yet change the customer designer.
- **`product_templates.shopify_product_id` uses the GID form**
  (`gid://shopify/Product/<n>`), not the bare numeric from the `product_id` URL
  param. Rationale: `getProduct()` converts the URL's bare numeric to a GID for
  the Storefront query, and the designer persists `product.id` (GID) — so
  `design_orders.shopify_product_id` is already GID. The Day-7 template lookup
  should key off `product.id`, not the raw URL param.
- **`set_updated_at()` trigger (future cleanup).** The `create_product_templates`
  migration added a reusable `public.set_updated_at()` trigger function (wired
  to `product_templates`). `designer_pricing.updated_at` is currently never
  refreshed on update — attach the same trigger to it as a future cleanup.
- **A template with zero print areas has no printable zone.** If a
  `product_templates` row has no `product_template_print_areas`, the designer
  will render no print area on that product — customers can't place a design.
  The `/admin/templates` list flags this with a red **"⚠ 0 areas"** badge on the
  row (analogous to how pricing surfaces dormant embroidery). Every active
  template should have at least one print area before it's used in the designer.

### Phase 3 notes

- **Designer reads print areas from `product_templates` (Day 3).** The
  product-load effect queries `product_templates` by `product.id` (GID) +
  `is_active`, takes the **single** front/back area matching the print method,
  and converts the stored **natural pixels → percentages** using a loaded
  product image's natural size (derived, not stored — revisit if aspect-ratio
  drift appears). Falls back to the legacy `designer.print_area` Shopify
  metafield for products with no template row. Multi-area-per-side is a future
  project (needs a mode-picker/zone-selection UX conversation).
- **Color→image matching + GID normalization (Day 6.5, onesie fix).** The
  second template (Baby Onesie) rendered a blank designer canvas — two bugs.
  **(A)** The old filename parser assumed a rigid `{knownSize}_{Color}_{Front|Back}`
  shape and broke on the onesie's inconsistent names (`_Onesie` suffix on some
  files, `3-6mo` size tokens on others), so every color resolved to no image.
  Replaced with a shared `buildColorImageMap`/`getColorImages` in
  **`app/lib/productImages.ts`** that matches by "normalized filename **contains**
  the Shopify color name" (longest color first, so "Light Blue" beats "Blue"),
  tolerating size prefixes, garment suffixes, and UUIDs. When a color still
  matches nothing, the designer falls back to the product's **first/featured
  image** (never a blank canvas) and the `/admin/templates` Colors section shows
  a red **"⚠ no image matched"** badge on that color (same spirit as "⚠ 0
  areas" — silent blanks are how this bug hid). **(B)** The admin saved
  `shopify_product_id` verbatim, so a typo (`gid://shopify/Products/…`, plural)
  never matched the designer's GID lookup. `normalizeShopifyProductId` (also in
  `productImages.ts`) now canonicalizes GID/plural-typo/bare-numeric/product-URL
  → `gid://shopify/Product/<n>` on save; the one existing onesie row was
  data-fixed. **The onesie's inconsistent source filenames are the existing
  "Product image naming" backlog item** — the contains-matcher tolerates them,
  but tidying the names in Shopify (a consistent, product-scoped scheme) is still
  worth doing to avoid future collisions.
- **Hardcoded adult sizes — Order Options shows S–3XL for every product (onesie
  testing 2026-07-13; diagnosed, not yet fixed; slotted Day 7).** Same class as
  the Day-6.5 image parser: a Cotton-Tee size list hardcoded before templates
  existed. **Three** hardcoded adult lists: `SIZES` (`DesignerCanvas.tsx:72`),
  plus `ALL_SIZES` (`app/order/page.tsx:8`, fallback) and `SIZE_ORDER`
  (`app/order/page.tsx:47`, sort key). Chain: the designer inits `quantities`
  from `SIZES` (`:177`, re-set in `handleColorSelect` `:930`) and saves
  `available_sizes: SIZES.filter(isSizeAvailable)` (`:1581`). `isSizeAvailable`
  (`:944`) is a real **color-scoped** variant check — so for the onesie every
  adult size is unavailable → **`available_sizes` saves as `[]`**. The order page
  (`:35`) then falls back to `ALL_SIZES` whenever `available_sizes` is empty →
  **adult sizes shown for the onesie**; it also `.sort()`s by `SIZE_ORDER` index
  (`:48`) instead of preserving Shopify order. **Capture is fine** —
  `design_orders.quantities` is a generic `Record<string,number>` and admin
  (`admin/orders/page.tsx:257`) renders whatever keys exist, so **no
  schema/migration**. **Fix:** source sizes from the product's **Size option
  values** (`data.options.find(o=>o.name==='Size')?.values`, same pattern as the
  Day-6.5 color fix), preserving **Shopify variant order** (NOT alpha —
  `3-6mo,6-12mo,12-24mo` and `S,M,L` both break under sort). Make the designer's
  size state per-product (retire the module `SIZES` for quantities/
  `available_sizes`); the order page uses the saved `available_sizes` order
  directly and drops both the `.sort()` and the `ALL_SIZES` fallback.
- **Phase 3 sign-off — "test everything against the onesie" sweep.**
  Second-product testing has now caught **two** Cotton-Tee assumptions hardcoded
  before the template system existed (image-filename parser → fixed Day 6.5; size
  list → slotted Day 7). Phase 3 sign-off must include a deliberate pass running
  the **onesie** (a non-adult, inconsistently-named second product) through the
  *entire* flow — designer load, per-color images, print areas, sizes/quantities,
  cart-add, admin order view — to flush out any third hardcoded Cotton-Tee
  assumption before Phase 3 closes.
- **Draft restore lands on the Front side only.** Back-side work is preserved
  but the customer must click **Back** to see it. Threading a `restore_side`
  through save/query/designer-mount is a small-scope Phase 3 polish item — add
  it if customer feedback requests it.
- **Admin Draft Order view doesn't display ink/thread colors used in the
  design.** Print method is captured (screen_print vs embroidery) but the actual
  colors chosen for text/artwork live only in the canvas state JSON. Extract and
  surface in the admin for print-shop reference in Phase 4/5 when the order
  fulfillment view gets built out.
- **Day 5 will add a dual-side preview to the Order Options page** when both
  sides have design work. This depends on Day 4's view-aware save fix landing
  first so the back PNG populates correctly.
- **Next Step "add a design" error check is view-scoped, not cross-side**
  (Day 5 task). If a customer designs on one side, flips to the empty side, and
  hits Next Step, they'll incorrectly get the error. Should check
  `frontHasContent` OR `backHasContent`, not just the currently-visible canvas.

**Day 5 polish backlog (from Day 4 testing):**

*Order Options page:*
- **Shirt preview images are too large.** Options to explore: (a) both
  front/back shown smaller side-by-side, or (b) one main image with a thumbnail
  toggle. (Related to the dual-side preview item above.)

*Cross-page:*
- **"Edit Design" back control should be visually prominent** — button
  treatment, not a text link.
- **Browser back-button behavior needs review.** It should walk backwards
  through the natural flow (Order Options → Designer → Product Page), not land
  on stale intermediate states with URL params from earlier interactions.
  **Trace current history behavior before proposing a fix** — likely involves
  `history.pushState` management.

*Designer page:*
- **Quantity should NOT show on the first designer step** (the customer is
  still designing, not ordering). Move it to the Order Options step.
- **"Add Text" button UX** — customers don't discover how to add text today.
  Consider more discoverable placement. (This is the Phase 1 sign-off "Add Text"
  finding.)
- **Restore-lands-on-Front sub-issue** — consider auto-landing on the side that
  has content, or showing a subtle indicator that both sides have content.
- **Garment color hex comes from a hardcoded `COLOR_HEX_MAP`** in
  `DesignerCanvas.tsx` (drives the shirt swatch AND the Day-5
  `design_orders.selected_color_hex` capture — null for unmapped colors,
  deliberately, since an honest null beats a misleading `#888` for the print
  shop). **Decided direction (Denise, Phase 3):** garment hexes will be assigned
  **per product template** in the `/admin/templates` editor — *not* a global
  registry and *not* `designer_colors`. Rationale: template setup is where each
  blank-product is already configured (print areas, methods), the template knows
  exactly which Shopify colors the product has, so color assignment belongs in
  that same one-sitting workflow. Hybrid: autofill a color's hex as an
  overridable default from other templates' assignments. Scoped ~1–1.5 days (new
  `product_template_colors` table + template-editor UI + designer read +
  autofill). Retires `COLOR_HEX_MAP` for templated products and upgrades the
  Day-5 hex capture to the template source.

## Phase 3+ Backlog — Denise notes 7/12/26

Captured for later scoping; not yet slotted into a specific day.

**Admin / Database** (fits Phase 4 Admin polish or later):
- **Delete Orders** — an option to delete/archive order rows in admin.
- **Order statistics** — best-selling products/colors/sizes over any given time
  period. Requires reporting queries + an admin dashboard component. Scope for a
  dedicated "Admin Reporting" mini-phase.
- **Rename "Screen Print" → "Print"** everywhere (methods dropdown, admin,
  customer-facing labels). Fits Phase 3 polish, small change. (Note: the
  internal DB key `screen_print` stays; this is display-only — see the
  "Terminology note" under designer_pricing.)
- **Convert artwork → SVG** — requires image processing (probably server-side
  with Sharp or similar). Scope for Phase 5 print-file generation work.
- **Category reordering in admin** — drag-and-reorder Clipart categories (and
  possibly other lists). Extension of the ▲▼ reorder pattern from Phase 2
  Colors/Fonts.

**Design Tool / Customer-facing** (fits Phase 3 Day 8 polish or Phase 3+
enhancement):
- **Product image naming** — many products share filenames like "XS_Black_Front"
  across styles, causing collisions. Needs a namespace/product-scoped filename
  scheme. (The Day-6.5 contains-matcher in `productImages.ts` now tolerates
  inconsistent names like the onesie's `_Onesie`/`3-6mo` tokens — see the
  "Color→image matching" note under Phase 3 notes — but tidying the source names
  is still the clean fix.)
- **Product colors** — correctly reflect Shopify variant colors in the designer
  (this is Item 1, mostly done in the Day 3 fix; may need follow-up
  verification).
- **Switch products mid-design** — change from Cotton Tee to Ring-Spun etc.
  without starting over; preserves design elements, adapts print-area
  coordinates. Nontrivial UX + data work. **Same underlying capability as
  [Design Portability](#design-portability-post-phase-3-candidate) under "Named
  Future Features" — scope the two together, don't build either in isolation.**
- **Print-color panel should be persistent / shared across tabs.** Selecting a
  piece of clipart while you're on another tab gives you no way to recolour it
  without tab-hopping back. Text and clipart draw from the **same print palette**,
  so one always-visible colour surface could serve both instead of a per-tab
  colour control. Design-note quality; scope post-Phase-3.
- **Live text preview** — text appears on the shirt in real time as the customer
  types (line break on Enter, no "Add Text" button). Replaces the current
  "type in box, then add to shirt" flow.
- **Text alignment buttons** — left/center/right (may already exist, needs
  verification).
- **Center-on-shirt button** — one click centers the current text element.
- **Rename "Curve" → "Arc"** — and expand range to −360°…360° (currently may be
  limited).
- **Explicit Rotate control** — −360°…360° slider or input.
- **"Add Design Notes" field** on the Order Options page — a text area for
  printing details that shows up with the order in admin.
- **AI image generator** — generate images from a text prompt for use in
  designs. Needs research: provider (OpenAI/Anthropic/Stability), cost per
  generation, per-session usage limits, content moderation. A Phase 3+
  enhancement, not core (see "Larger consideration items").

**Admin polish** (fold into a future admin-view pass):
- **Admin Draft Order view could break out per-side print charges** now that
  `print_charge_front`/`print_charge_back` exist on `design_orders` (Day 4). It
  currently shows the summed "Blank + Print" format. Per-side breakout benefits
  the print shop.

**Larger consideration items** (flag for discussion, not scoped tonight):
- **Switch-products-mid-design** / **Design Portability** (one capability — see
  "Named Future Features") and the **AI image generator** are both meaningful
  net-new features that deserve dedicated discovery conversations before scoping.
  Not "small fixes" — set expectations accordingly.

## Named Future Features

Real projects, not backlog bullets. Each needs a discovery conversation and
multi-day scoping before being committed to a phase — listed here so they're
costed honestly instead of mistaken for small fixes.

### Design Portability (post-Phase-3 candidate)

> **Scope this together with the "Switch products mid-design" backlog item —
> they are the same underlying capability.** Whichever gets built first should
> build the shared foundation for both.

**The gap.** A saved design (Day 8) freezes **artwork and product together**.
Customers want the *artwork* to be portable: design a family-reunion graphic
once, then put it on a tee, a onesie, and a hoodie. Today that means rebuilding
the design from scratch on each product.

**Why it isn't a small fix.** Canvas coordinates are tied to the **source
product's print area**, so artwork isn't separable from placement as the data
stands today:

- **Separate artwork from placement.** A design must be storable independently of
  any one product's print-area geometry. Today `canvas_json_front/back` bakes in
  coordinates for the product it was made on, and `design_orders` freezes a
  print-area snapshot (`print_area_front/back`) alongside it — deliberately, for
  print fidelity. Portability needs an artwork representation that is
  print-area-relative rather than absolute.
- **Re-placement when print areas differ** in size or aspect ratio. A tee's front
  area and a onesie's are not the same box, and the per-template print areas
  (Phase 2/3) make that explicit. Needs a *decided rule*: scale-to-fit?
  re-center? let the customer adjust against a preview? (Likely "auto-place, then
  let them nudge" — but that's a product decision to make deliberately, not an
  implementation detail to stumble into.)
- **A UX surface** for "apply this design to another product": where it lives (My
  Designs drawer? the designer? the product page?), and what the customer sees
  when artwork doesn't fit the new area cleanly.

**Value.** High for the group / team / small-business buyer — reunions, teams,
staff shirts — who inherently want one graphic across several garment types, and
who buy in volume.

**Size.** Multi-day. Discovery conversation first, then scope.

### Recolorable single-color vector uploads (post-Phase-3 candidate)

A customer uploads a **one-colour vector** (SVG/AI/EPS) and can then recolour it
to any offered print colour — the same way clipart recolouring already works
(`recolorSvg` tints SVG clipart via a Fabric BlendColor filter). Natural sibling
to [Design Portability](#design-portability-post-phase-3-candidate): both are
about artwork being *adaptable* rather than frozen at upload.

Needs: detecting that an upload really is single-colour; keeping the vector as a
vector (today AI/EPS are flattened to a delivery PNG — see the uploaded-originals
note under designer_pricing); and deciding what happens to a multi-colour file
(refuse to recolour? recolour the dominant ink?). Not scoped.

### Designer on Mobile — 🚨 LAUNCH GATE (see BUILD_PLAN.md → BLOCKER-2)

**The designer is desktop-only today and this blocks the Phase 6 cutover.** Most
customers order on phones, so launching desktop-only launches closed to most of
the store's traffic. `DesignerCanvas.tsx` has **zero** responsive breakpoints and
a fixed 288px + 256px sidebar pair — 544px of chrome before the shirt, on a
390px-wide phone.

Phase-sized; gets a dedicated discovery pass **after Phase 3 closes**. Scope
headings only: responsive layout, touch-first interactions (several affordances
are hover-only today with no touch equivalent — the My Uploads "+ Add" overlay,
tile ✕ controls, the My Designs "Open" overlay), and on-screen-keyboard
management. **Full detail + the sequencing constraint live in BUILD_PLAN.md
under BLOCKER-2** — that's the canonical entry; this is the pointer.

### Add Text — ✅ v2 mostly SHIPPED (Day 9.2). Only stacked-arc curve remains.

**This entry previously said v2 = "Enter = new line, needs the Fabric `Textbox`
migration, 1.5–2.5 days". That estimate was correct for the design at the time
and was then invalidated by a design change — recorded here because the reasoning
is the reusable part.**

The v2 cost was never the newline; it was the **caret**. With the caret on the
canvas, Fabric owned the string, so re-wrapping mid-keystroke moved
`selectionStart`, and `reWrapText`'s `.replace(/\s+/g,' ').trim()` would have
eaten the space just typed (you could never type *between* words). That forced
either length-preserving wrap + index math, or Textbox.

Day 9.1's **box-first pivot removed the caret from the canvas** — the DOM
textarea owns it — and the whole cost collapsed. **Enter = new line shipped in
Day 9.2 for ~half a day, with NO Textbox migration**: `IText` renders `\n`
perfectly well, and `reWrapText` just became paragraph-aware (`split('\n')` →
wrap each paragraph → concat; both shrink loops unchanged, since the height loop
already counted total lines).

**Lesson worth keeping: when an estimate is dominated by one constraint, name the
constraint — a later design change may delete it, and the estimate with it.**

**What actually remains of v2 — stacked-arc curve.** Curve and multi-line still
don't compose: `createCurvedText`/the curve effect lay **every character along a
single arc** (`rawText.split('')`), so a `\n` measures ~0 and silently vanishes —
"Ham⏎Cheese" would render as one arc reading "HamCheese". Day 9.2 guards this
(the Curve slider is disabled for multi-line text with a note, plus a backstop in
the curve effect), so it fails loudly instead of silently. Making curve work on
stacked lines means re-architecting the arc renderer for multiple arcs — a real
project, unscoped, low priority.

**Also deliberately gone:** typing directly *on* the garment. Text is edited in
the box only (one editing surface, one source of truth). That was the trade that
made intentional breaks safe — `obj.text` mixes the customer's newlines with the
wrapper's, and they're the same character, so `_originalText` could never be
re-derived from it without flattening stacked lines.

## Deployment Notes

- Hosted on Vercel (inferred)
- Environment variables must be set in Vercel dashboard for production (see the
  Environment Variables section above — mind the "Sensitive in Vercel" column)
- Supabase Storage bucket must be configured as public
- Shopify API tokens require proper scopes for product/checkout access
