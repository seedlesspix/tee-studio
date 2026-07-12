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

> **When adding a new row to `designer_pricing`, both `price_add` AND `shopify_variant_id` must be set, or cart-add will fail with a clear error message for that print method × sides combination.**

The `shopify_variant_id` column points at a Shopify Print Charge product variant. When a customer adds a screen-print design to their cart, the cart-add flow looks up this variant per side that has rendered content (`canvas_png_front` → `(screen_print, sides=1)`; `canvas_png_back` → `(screen_print, sides=2)`) and adds a separate Print Charge line item with quantity equal to the total shirt count. A NULL `shopify_variant_id` is treated as a configuration error — the resolver in `app/lib/shopify.ts` aborts the entire cart-add (no partial cart state) and surfaces a "missing Shopify variant ID" message to the customer.

**Embroidery is intentionally dormant.** The Shopify Print Charge product has a third variant for embroidery (variant ID `53029191123260`), but the embroidery rows in `designer_pricing` are left with `shopify_variant_id = NULL` on purpose. Embroidery products currently bake the embroidery cost into the base product price (a $32 polo includes embroidery, not $22 + $10 surcharge). Wiring up the embroidery variant would double-charge customers. The cart-add code path in `handleAddToCart` checks `print_method === 'screen_print'` and skips the Print Charge step entirely for any other method.

**To switch embroidery to a surcharge model in the future:**
1. Lower base product prices in Shopify by the embroidery cost (e.g., $32 polo → $22).
2. Populate `shopify_variant_id` on the embroidery row(s) in `designer_pricing` (use `53029191123260` for the existing 1-side row, create a 2-side variant in Shopify if needed).
3. Remove the `print_method === 'screen_print'` guard in `handleAddToCart` (in `app/order/page.tsx`).

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

## Deployment Notes

- Hosted on Vercel (inferred)
- Environment variables must be set in Vercel dashboard for production (see the
  Environment Variables section above — mind the "Sensitive in Vercel" column)
- Supabase Storage bucket must be configured as public
- Shopify API tokens require proper scopes for product/checkout access
