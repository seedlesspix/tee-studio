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
- **Designer red-vocabulary rule (LOCKED for the desktop redesign, 2026-07-28):**
  red means **one** thing — **primary ACTION** (Add text, Next Step, primary
  CTAs). It is NOT used for selected/active/current state: those get a **quiet
  non-red** treatment (surface fill + neutral marker) — active rail item, current
  step dot, etc. The **selected color swatch** uses a neutral/white ring, never a
  red outline (so selection reads the same on any color, and red-the-swatch ≠
  red-the-state). Brand wordmark red is read-once identity; the customer's print
  palette (which includes red) is artwork, a separate domain. Apply this to all
  new designer UI.

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

## Full-replace APIs reset unspecified fields — always re-assert the full intended state

This project has now hit the same bug shape three times; treat it as a
standing rule, not a one-off:

1. **Fabric `canvas.toJSON(props)`** silently ignores its argument — custom
   props vanished from saves until the writer switched to `toObject(props)`.
2. **Shopify `productSet`** is a full-replace operation. Creating is safe, but
   **any future call that UPDATES an existing product by id must re-assert the
   complete intended state** — `productType: 'Custom Design'`, the
   `seo.hidden=1` metafield, both tags, status — or the omitted fields reset
   and the product silently reappears in search / `/collections/all`. This
   matters for reorder-recreates and any Day-7+ product mutation.
3. **Blind API surfaces are the read-side twin**: `resourcePublicationsV2`
   through our app never shows channels the app can't see (Microsoft Copilot,
   Markets catalogs), and an app's `webhookSubscriptions` query never shows
   admin-created webhooks. "Verified absent" on a filtered surface is not
   verified absent.

Rule of thumb: before trusting a write, ask "is this a full replace?"; before
trusting a read, ask "what does this surface refuse to show me?"

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
- **`npm run lint` is RED project-wide — logged 2026-10-06 (Denise: "so it doesn't become
  furniture").** 356 errors, 0 warnings. By rule: 272 `@typescript-eslint/no-explicit-any`, 40
  `react-hooks/immutability`, 21 `react-hooks/refs`, 17 `react-hooks/set-state-in-effect`, 4
  `react-hooks/globals`, 1 `react-hooks/purity`, 1 `@typescript-eslint/ban-ts-comment`
  (`shopify/volume-discount-function/run.js`). 325 of the 356 are in `DesignerCanvas.tsx`. The
  `react-hooks/*` ones are the React Compiler rule set (eslint-plugin-react-hooks 6+), newer than most
  of this code. **The real cost:** with the whole run red, a NEW lint error in a changed file is
  invisible. The build is unaffected (Next 16 doesn't lint on build), which is how it got this way.
  Specific instance found 2026-10-06 while fixing the templates editor: `app/admin/templates/
  PrintAreaEditor.tsx` — the Shopify-aspect effect calls `setShopifyAspect(0)` synchronously in the
  effect body (`set-state-in-effect`); pre-existing, not from that fix, harmless at runtime. **DECIDED
  2026-10-06 (Denise): demoted to `warn`.** In `eslint.config.mjs`, every React Compiler rule the Next
  preset had at error (12: config, error-boundaries, gating, globals, immutability,
  preserve-manual-memoization, purity, refs, set-state-in-effect, set-state-in-render,
  static-components, use-memo) plus `@typescript-eslint/no-explicit-any` and `ban-ts-comment` — the
  two non-compiler rules that were also red; without them the run could not go green.
  `rules-of-hooks` stays an error. `npm run lint` now exits 0 with the 356 listed as warnings, so a
  NEW error is visible again. **The cleanup is PARKED — fold it into the `DesignerCanvas.tsx` split
  (325 of the 356 live there), not its own session.**

### Performance & Optimization
- **Large bundle size**: All fonts loaded upfront (Google Fonts + local fonts)
- **No image optimization**: Product images fetched directly from Shopify without resizing
- **Unoptimized Fabric.js**: Canvas operations could batch updates or use Web Workers
- **No caching**: No Redis or HTTP cache layer for expensive queries
- **Download all clipart**: `ClipartPanel` loads all items for search (no pagination)
- **Desktop render scale (SHIPPED 2026-10-23) — "soft SVG" was the DISPLAY, not the file.** Denise's
  "SVG art goes soft when enlarged" (T1801, Art panel, print mode) traced through the real path in Chromium
  + WebKit: the file was clean, every library SVG passes the hi-res pre-render, and the art is drawn from
  its 1500-px raster at ≤530 device px. Her screenshot's print box measured 265 px with 1-px lines = a 1×
  capture → her non-retina ultrawide (Acer 3440×1440): Fabric sizes its backing store by
  `devicePixelRatio`, so on a 1× monitor the whole shirt renders one pixel per CSS pixel and edges go jagged.
  Two more bitmap-magnifiers in the same family: the stage magnifier (`view.zoom`) was a pure CSS scale of
  the rendered bitmap (200% = 2× blur), and Fabric reads DPR once at load (window dragged between a retina
  and a 1× display = stale). **Now (desktop only, `DesignerCanvas` "Render scale" effect):** backing store =
  max(DPR, 2) × zoom, capped at 4× (2720×3400), via a `canvas.getRetinaScaling` override +
  `setDimensions` re-allocation, re-applied on a `(resolution: Ndppx)` media-query change; and
  `before:render` sets `imageSmoothingQuality='high'` so downsampled rasters (hi-res clipart, recolored
  copies, PNG art, curved bakes) are box-filtered, not point-sampled. Object coordinates untouched (Fabric
  divides the factor out of pointer math); every export passes `enableRetinaScaling=false`, so previews,
  staff downloads and the parity harness are unchanged. Mobile keeps the device ratio (memory; pinch stays
  a bitmap magnify). **Triage rule for any "blurry/soft on desktop" report: ask which display, or measure
  the screenshot (print box 265 px = 1×, 530 = retina) before touching the art pipeline.**

### Features & Missing Pieces
- **Incomplete print methods**: Code references `printMethod` but configuration unclear
- **Back image support**: Logic for front/back shirt designs exists but incomplete
- **No canvas-wide undo/redo** (grounded 2026-10-17): the Undo/Redo arrows in the stage toolbar are the
  Phase-5 **image-edit** history only (crop / background removal; `_editHist` on the image object), so
  they are disabled unless the selected image has edit history — which reads as "they do nothing".
  No history engine exists for add/move/delete/text/style/recolor. **Scoped, not built (~3–4 dev-days):**
  snapshot history on top of the existing, battle-tested `snapshotDesignState()` / `applyDesignState()`
  pair (undo = apply the previous whole-design snapshot, all zones, roster included — curved-text bakes
  and locked N&N stacks already round-trip through them); the cost is (a) capturing every mutation path
  as a debounced step (object:added/removed/modified, text + style changes, recolor, curve, zone switch,
  N&N, image edits — fold the per-image stack into the one history), (b) re-syncing React state and the
  selection after each apply, (c) memory on phones: snapshots carry the hi-res clipart data URLs today,
  (d) Cmd/Ctrl+Z shortcuts next to the existing Cmd+D.
  **DECIDED (Denise, 2026-10-17): canvas-wide undo/redo is APPROVED in principle and SEQUENCED AFTER the
  true-vector clipart refactor** (see "Multi-color recolorable SVGs"), because that refactor removes the
  hi-res clipart data URLs from every snapshot — history gets light first, then gets built. Don't
  re-debate the order. **Quick win SHIPPED 2026-10-17:** the desktop arrows are hidden (not just
  disabled) when no image with edit history is selected, matching mobile.
- **Remove Background provider = Leonardo.Ai (cut over 2026-10-30; remove.bg's API dies 1 Dec 2026; the
  remove.bg code path and `REMOVE_BG_API_KEY` are GONE — no silent fallback to a dead vendor).**
  `/api/remove-bg` keeps the URL-in/URL-out shape (client sends the Cloudinary URL, the provider fetches
  it, we download the cutout and re-host it on Cloudinary — mandatory, order artwork is kept forever and
  Leonardo's result links expire in ~30 min). Provider glue is pure + tested in
  `app/lib/backgroundRemoval.ts`. **The live API differs from Leonardo's migration guide in BOTH
  directions — both found from the real production log, each after a failed live test:** (1) `public` is
  documented optional but the validator REJECTS its absence (HTTP 200 + `[{"message":"public must be
  boolean"}]`), so the request always sends `public:false`; (2) the success body is WRAPPED under a
  top-level `generateSync` key (`{"generateSync":{"id","blockedCount","cost":{"amount":"0.1047","unit":
  "DOLLARS"},"results":[{"contentType":"image/png","url":"https://…s3…?X-Amz-Expires=1800"}]}}`), which
  the guide shows unwrapped; the parser accepts both. Request: `POST …/api/rest/v2/generationssync`
  `{ model:'remove-bg', ephemeral:true, public:false, parameters:{ size:'full', format:'png',
  guidances:{ image_reference:[{ image:{ type:'URL', url } }] } } }` → USD $0.1047/image, logged per call
  (`[remove-bg] leonardo ok cost=$… WxH`). A 200 carrying an error list is reported as "Leonardo.Ai
  rejected the request — <message>". Rate limits, origin gate and the designer's edit pipeline are
  untouched. Alternatives weighed: Photoroom ($0.02/img but prepaid 1,000-image packs that don't roll over
  → pricier below ~200/month), Cloudinary's `e_background_removal` (billing only described as "a special
  transformation count"; the legacy add-on is closed to accounts created after Feb 2026), in-browser
  @imgly (40 MB+ download, slow on phones). Cutover confirmed by Denise's live test 2026-10-30 (cutout on
  the shirt, $0.1047 charged). Unused remove.bg credits expire 1 Dec 2026 (non-refundable).
- **No save drafts**: Designs only saved at checkout
- **No design sharing**: No public gallery or social sharing
- **Webhook**: `shopify-webhook/route.ts` handles two Shopify topics at one URL. **Both are APP
  subscriptions created through the Admin API by the custom app** (`ORDERS_PAID` 2026-07-16,
  `ORDERS_CANCELLED` 2026-10-20, api 2026-07, callback `https://create.tshirtdeli.com/api/shopify-webhook`)
  — so Shopify admin → Settings → Notifications → Webhooks shows NOTHING (that page lists only hand-made
  webhooks; the blind-surfaces rule in the other direction). List/create them with
  `node scripts/shopify-webhooks.cjs list|create` (same client-credentials auth as `shopify-admin.ts`).
  **App subscriptions are signed with the app's client secret** (`SHOPIFY_ADMIN_CLIENT_SECRET`), the
  route's first HMAC candidate; `SHOPIFY_WEBHOOK_SECRET` is the second candidate for any hand-made one.
  Verified 2026-10-20 by a signed synthetic `orders/cancelled` delivery to production (200, row
  stamped; bad signature → 401). Orders themselves stay invisible to the app's API, so a real
  end-to-end check means cancelling a test order in Shopify admin by hand. `orders/paid` sets `status='completed'`, customer info,
  shipping, charged total. **`orders/cancelled` (2026-10-20) STAMPS `cancelled_at` + `cancel_reason` on
  the paid row(s) and changes nothing else** — status stays `completed` so every rule keyed on it
  (admin-only access, no cart link, not re-orderable) keeps applying; customer/shipping details and
  artwork are kept (refunds, records, indefinite reprints); the checkout product ages out via retention.
  The admin derives the "Cancelled" label (`app/lib/orderStatus.ts`). Refunds / `orders/updated` are
  deliberately NOT handled (a partial refund is not a cancellation); Shopify can't un-cancel.
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
| `BACKUP_MANIFEST_SECRET` | Optional³ | Server | **Yes** | Bearer secret for `/api/backup/manifest`, the path-to-design list the nightly storage backup writes to B2 (see `BACKUP.md`). Unset → 401. Same value lives in GitHub's secret store. |
| `LEONARDO_API_KEY` | Required⁴ | Server | **Yes** | Leonardo.Ai key for the designer's **Remove Background** button (`/api/remove-bg`). Successor to remove.bg (self-serve API ends 1 Dec 2026); cutover confirmed in production 2026-10-30, the old key retired. |

¹ Required only once the Shopify `order/paid` webhook is registered (see the
webhook note in Known Issues). ² Required for the Phase 1 customer-login flow.
³ Required once the nightly storage backup is configured (`BACKUP.md`).
⁴ Required for Remove Background to work at all; without it the button answers "isn't set up yet" (503).

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
- **Draft rows accumulate → handled by the cleanup-cron family (Vercel Cron, `vercel.json`).**
  `/api/cron/drafts` (09:15 daily) deletes `status='draft'` rows older than 7 days.
  **`/api/cron/stale-carts` (09:30 daily, added 2026-10-20)** deletes abandoned `cart_created` ("In
  Cart") and `ordering` rows — but **NOT on a 7-day window**: an In Cart row can still complete while
  its ephemeral product sits in a live Shopify cart (guest carts live ~10 days), and the paid webhook
  looks the row up by id — delete it early and a paid order lands with no design data. So a row is
  deleted only when it is older than `STALE_CART_MIN_AGE_DAYS` (15 = product retention 14 + 1) AND its
  product is confirmed gone from the store (live tagged listing; fails closed) AND it backs no saved
  design (fails closed). Constants in `app/lib/retention.ts`; decision logic pure in
  `app/lib/staleOrders.ts` (tested). All three jobs: Bearer `CRON_SECRET`, `?dry_run=1`, per-run cap,
  status re-asserted at delete time.
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
- **Font Management — NAMED FEATURE, admin fully OWNS all fonts (scoped 2026-07-30,
  Denise; folds with Font Categories; DON'T build yet).** Today fonts are
  **read-only** in admin (edit/toggle/reorder/delete only); adding one needs a
  code change (Google `<link>` in `app/layout.tsx` or `@font-face` in
  `app/globals.css`) — which is *why* the current 58 are baked-in (the files had
  to be hand-loaded). **Denise's target is bigger than an "add" button:** ALL
  fonts should live in the admin as uploaded, managed entries (add / remove /
  replace / categorize), a **single source of truth** — not a hardcoded list with
  uploads bolted alongside (two classes behaving differently = bug-prone). Scope:
  1. **Upload-and-serve mechanism** — font files uploaded to Supabase Storage,
     stored, and served to the designer via runtime dynamic `@font-face` injection
     (+ runtime `<link>` for any Google fonts). ~1–2 d infra.
  2. **🚨 Migrate the 58 hardcoded fonts INTO the managed system WITHOUT breaking
     saved designs — THE REAL RISK.** Saved designs (`canvas_json`, `saved_designs`)
     reference fonts **by NAME** (`fontFamily`); if a migrated font's family name
     changes or its `@font-face` fails to load, **old designs silently fall back to
     a default font** — no error, customer's saved work looks wrong. Names must stay
     byte-stable through the migration; verify each of the 58 actually loads
     post-migration (add a fallback-detection check). ~1–2 d + careful verification.
  3. **One-source refactor** — designer reads the whole font list from the managed
     system; retire the hardcoded `layout.tsx`/`globals.css` font declarations. ~1 d.
  4. Categorize during the same admin pass (Font Categories); **fix/remove broken
     files** like the malformed **`Univers-Condensed-Sans alot.ttf`** (the
     console-error font, `globals.css:266`) — a proper admin handles add + repair.
  **Rough sizing: a real SUB-PROJECT, ~4–7 dev-days** (infra + upload/serve +
  name-stable migration + one-source refactor + per-font verification) — NOT a
  trivial addition; the migration-without-breaking-saved-designs is what makes it
  more than an upload button. The small **"add a category field"** slice can ship
  with Font Categories in the desktop restructure; the full ownership migration is
  its own scoped project.
  - **FONT-PICKER UX (Denise 2026-08-04, N&N pass — fold into Font Categories):** the
    currently-chosen font must be **clearly indicated**, and **scrolling the full flat
    list is rough** — Categories is the fix (grouped, searchable, current-selection
    obvious). Applies everywhere fonts are picked (the Text panel AND the new Names &
    Numbers styling section). Strengthens the case for Categories; don't build a
    one-off picker.
    - **PER-FONT PREVIEW IN THE PICKER LIST (Denise 2026-08-05):** each font in the
      scrolling list must render **its own name in that font** — preview *before*
      choosing, like every real font menu. The desktop **Text** panel already does
      this ("Preview Text" per font); the **N&N styling font control is a plain
      native `<select>`** (per-`<option>` `font-family` is unreliable across
      browsers/OS), so it does NOT preview. Fix = the N&N control adopts the same
      custom per-font-preview list the Text panel uses (build it once, share it) —
      this is the pick-a-font experience, distinct from the selected-font swatch
      already shipped in the N&N styling section (that shows the *chosen* font+color;
      keep it). Home = Font Categories/picker work.
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
  dedicated "Admin Reporting" mini-phase. **Scope this together with
  [Decal Designs](#decal-designs--catalog-split--sell-through-tracking-post-phase-4-candidate)
  Part 3 (units-sold-per-decal) — they are one reporting surface, not two.**
- **Rename "Screen Print" → "Print" everywhere in the UI (Denise 2026-07-30: the
  website only does DTG/digital "print"; bulk screen-print is handled separately
  off-site, so "Screen Print" is inaccurate labeling).** Investigation (2026-07-30):
  it's the `completed`→`Paid` shape — **the stored `screen_print` key is
  load-bearing** (`print_method`/`print_method_key`, ~40 call sites: queries,
  designer default `|| 'screen_print'`, inserts, config lookups) and **must NOT
  change**; only DISPLAY changes. There is **no hardcoded `"Screen Print"` string
  in code** — the customer sees it *derived* via `print_method.replace('_',' ')`.
  - ✅ **DONE (customer-facing):** `order/page.tsx` order summary now shows
    **"Method: Print"** (was "Print: screen print"; relabeled "Print:"→"Method:" to
    avoid a redundant "Print: Print" — adjustable wording).
  - **Remaining (logged):** `admin/orders/page.tsx:450` shows "screen print" (admin,
    same `.replace` derivation) — low priority; and the capitalized **"Screen Print"**
    in the admin method dropdowns is the **`designer_print_methods.label` DB value**
    (data, not code — edit via admin or a show-and-approve migration).
  - **Make "Print" the DEFAULT when labels-as-data / the language editor is built**
    (desktop restructure) so it can't regress — this is a textbook case of the
    wording the language system exists to own.
- **Convert artwork → SVG** — requires image processing (probably server-side
  with Sharp or similar). Scope for Phase 5 print-file generation work.
- **Drag-and-drop reordering, everywhere the ▲▼ arrows live** (Denise's vote 2026-10-20: "moving an
  item far takes a lot of clicks; build drag once, replace the arrows everywhere"). **Grounded
  2026-10-20, PARKED (not cheap enough to bundle with the Art Library search/sort):** three lists have
  ▲▼ today — `admin/colors`, `admin/fonts`, `admin/templates` (picker order); clipart categories have
  no reorder at all yet (ordered by name). The **persistence half already exists**: each `move*`
  handler resequences the whole list's `sort_order` and writes only the changed rows (optimistic +
  refetch on error) — a drop handler plugs into exactly that. The missing half is the interaction: a
  shared sortable-list component (dnd-kit — pointer, touch and keyboard, no library installed today),
  rewiring the three lists, adding categories (switch their ordering from name to `sort_order` in
  admin + designer), and touch testing. **~1.5–2 dev-days.** Cheap interim if the click-count is the
  real pain: "⤒ to top / ⤓ to bottom" buttons beside ▲▼ in all three lists (~1 h).

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
- **Universal / Illustrator-like icon set (Denise 2026-08-05).** Icons should be
  consistent app-wide and match the standard glyph vocabulary designers already
  know — specifically the **align-left / center / right / justify-distribute**
  set as drawn in Illustrator. Today icons are ad-hoc Lucide picks; this is the
  umbrella "universal-icons" pass (audit every tool/panel icon for a consistent,
  familiar set, align controls first). Cosmetic-polish scope; fold into a
  launch-polish or desktop-restructure pass.
- **Names & Numbers — admin stack-preview overlay (Denise 2026-08-05, real item not a maybe).** Now
  that the N&N jersey stack is LOCKED (canonical position + size, no user drag/resize), the print box
  is the single source of truth for where the stack lands. Draw a faint NAME/TITLE/NUMBER preview in
  the `/admin/templates` print-area editor so the shape/position of the locked stack is visible
  per-product at box-setup time — prevention-at-source, same spirit as the template anisotropy badge
  and the "⚠ 0 areas" badge. Fast-follow to the lock (shipped as movable→locked in the N&N work).
- **Names & Numbers — front chest-number layout (named follow-up).** The locked stack applies the
  same big-centered jersey layout on whichever side it's placed (front or back). A real FRONT jersey
  number is a *different* convention — small, upper-left chest — so it needs its own front-specific
  locked layout. Deferred deliberately; front placement still works today (just gets the big centered
  stack). Scope a front-number layout mode when front personalization demand appears.
- **Center-on-shirt button** — one click centers the current text element.
- **Rename "Curve" → "Arc"** — and expand range to −360°…360° (currently may be
  limited).
- **Explicit Rotate control** — −360°…360° slider or input.
- **"Add Design Notes" field** on the Order Options page — a text area for
  printing details that shows up with the order in admin.
- **Low-resolution warning (WARN, don't block)** — two-tier quality check on
  uploads (Denise 2026-08-04). (1) At upload: longest side < ~300px → immediate
  warning. (2) The real one: **effective DPI at placed size** = source px ÷
  placed inches (inches from the cut-file canvas→inch math /
  `product_template_print_areas.width_in/height_in`), refreshing live as the
  customer scales up; under ~150 effective DPI → "⚠ Low resolution — may print
  blurry at this size. 300 DPI or higher looks best, or email us your original."
  Bonus: flag effective DPI in `OrderInfo.txt` so the bench sees at-risk art
  before printing. Wording = labels-as-data. Unlike `MAX_UPLOAD_MB` (a technical
  cap), low-res is a quality judgment — never block. **DATA GAP:** designer
  reads print areas as % today; Tier 2 needs the physical inches loaded
  client-side. ~2–2.5 dev-days; rides with the Upload-panel rebuild /
  launch-polish. Full scope in the `project_lowres_warning` memory.
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

## Grab 'n Go deep links (cross-site, 2026-10-16)

Grab 'n Go designs are **designs, not products** on the Shopify side: one mockup on the
product page and a **"Put it on something"** button that opens the designer with the
design already placed. The theme stores the design id in a `custom.design_id` product
metafield (`"T2491"`) and builds the link from it. **The URL contract the theme hardcodes:**

```
https://create.tshirtdeli.com/designer?design=T2491
https://create.tshirtdeli.com/designer?design=T2491&garment=3001&color=Black
https://create.tshirtdeli.com/?design=T2491            (root alias — forwards to /designer)
```

| Param | Example | Meaning | Rules |
|---|---|---|---|
| `design` | `T2491` | Art library **design number** (`clipart_items.decal_number`) | **The T is display-only; the number is the identity** (Denise, 2026-10-16). Parser accepts `T2491` / `t2491` / `2491` / `T-2491` / leading zeros. Unknown or inactive → designer opens normally (silently) on the default garment with the picker open. |
| `garment` | `3001` | Product template **style number** (`product_templates.style_number`) | Optional. Same token the mockup-filename convention uses. Also accepts a template uuid or a Shopify product id. Unknown or incompatible → default garment + picker. A resolved `garment` **skips the picker** (the choice was made store-side). |
| `color` | `Black` | Garment color, exact Shopify name | Optional; pre-existing designer param. |

**How it works** (`app/lib/deepLink.ts` pure helpers + `GET /api/deep-link` resolver +
`app/designer/page.tsx` + `DesignerCanvas` `placeDecal` / `openPickerOnLoad` props):
the designer page resolves the link BEFORE the canvas mounts, so `DesignerCanvas` keeps its
product-first lifecycle untouched. Once the garment + print box are on screen, the art is
placed through **`handleClipartSelect` — the exact path as tapping it in the Art panel**
(centered in the box, ≤ half the box width, `_decalNumber` stamped → `decals_used`
sell-through capture for free). The `design`/`garment` params are then **stripped from the
address** (same trick as `?restore=`) so a refresh never places a second copy; placement also
never happens over restored content, and is skipped alongside `design_id` / `restore`.

**Default garment = first active template in the admin's picker order** (`sort_order`, ties →
oldest; decision 4). **Compatibility (decision 6):** the resolver and the picker's `choose`
mode only offer garments whose `supported_print_methods` intersect the art's
`supported_methods`, AND whose Shopify product is live (same `getFeaturedImages` availability
check as the switch picker) — no dead ends. Picking a garment in the on-load picker
navigates to `/designer?product_id=…&design=N` and places the art **fresh** there (not the
re-fit path — nothing has been edited yet, and no draft row is written). Editing first and
then switching uses the Products rail = the normal snapshot + re-fit path.

**Browser Back through the flow (grounded 2026-10-16, Denise's ask from the Shopify side):** every
entry shape leaves the Grab 'n Go page as the immediately previous history entry. Direct link = one
entry (the designer). Root alias = a **server 307**, which adds no entry. Picking a garment in the
on-load picker uses **`location.replace`**, not a push — the default-garment-plus-picker screen is an
intermediate step, so Back from the chosen garment goes to the Grab 'n Go page, not back to that
screen. The param strip is a `replaceState` (no entry) and **re-asserts `product_id` + `title`** when
the link carried none, so a reload / Back onto the stripped entry never opens a product-less designer.
After Next Step the pre-existing order-page rewrite applies (Back → designer with `design_id`, Back
again → Grab 'n Go page). An explicit `&back=` "← Back to designs" link was judged **not needed** for
correctness; if ever added it must accept ONLY store-origin URLs (`NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` /
`*.tshirtdeli.com`) or a store-relative path, rendered as a plain link — never an open redirect.

**Landing color (Denise, 2026-10-17 — three rules, all decided):** (1) a deep-linked garment opens in
the **admin's first template color** (Templates → Colors order), never Shopify's first option value
(which landed the Cotton T on Columbia Blue by accident and would land a white design on White for
3501 / the tote / every EmergenTee). (2) An art item flagged **"Light artwork — show on a dark
garment"** (`clipart_items.is_light`, Art Library checkbox, human-set on purpose: a full server-side
luminance scan of 398 items found 1 clearly light + 3 borderline half-white flags) opens on the
garment's **darkest color by hex luminance** (`pickLandingColor` in `deepLink.ts`; bad hex = mid-grey,
can never win). Build 2 renders flagged art on a black tee from the SAME flag, so the two can't drift;
auto-detection is deferred to Build 2 where the image engine lives. (3) A theme `?color=` overrides
both. The resolver returns `garment.color`; the designer page carries it through the existing
`initialColor` prop (not URL-gated, same reason as `placeDecal`), and resolves the garment that is
actually ON SCREEN (`?garment=`, else the URL's `product_id` after a pick) so the color is computed for
the right template. Templates with no admin colors (e.g. 3901) keep the Shopify fallback.

**Preview-test findings (Denise, Safari, 2026-10-16) and what they taught:**
- **The picked garment opened BLANK** (the design did not carry). Root cause: **Next.js wires
  `useSearchParams` to the native History API**, so the designer's own `history.replaceState` strip of
  `?design=` re-rendered the designer page with the param gone, and a `placeDecal` prop derived from
  the live URL was dropped BEFORE the customer picked a garment — `chooseProduct` then navigated
  without `?design=`. Fix: the designer page derives `placeDecal` from the resolved result, not the
  live URL (the result is only ever set by a deep link). **Rule: anything that strips its own URL
  params must not also derive state from those params.** Found by reproducing in headless Chromium
  against the dev server (Playwright in the session scratchpad), not by reading.
- **Picker unusable on desktop** (31 garments overflowed the viewport-locked designer: no scroll,
  header + ✕ pushed off-screen, design hidden behind it). The dialog is now bounded
  (`max-h-[min(85vh,760px)]`) with only the LIST scrolling; choose mode docks to the right on `lg:`
  and dims the backdrop less so the placed design stays visible.
- **"Default garment ≠ predicted"** was data, not code: between the morning data check and the
  test, the EmergenTee templates got `-ET` style numbers and explicit picker positions 0–6, so
  "first in picker order" correctly resolved to Baby Onesie EmergenTee. The Templates admin's
  Order column tooltip now says the first garment is also the deep-link default.
- Art-load failures in `handleClipartSelect` were a silent no-op (no `.catch`); they now log.

**Data rules this depends on:** design numbers must be **unique** (decision 2 — unique
partial index; the admin surfaces "Design #N is already used" on a 23505) and every active
template needs a **style number** (the templates list flags "⚠ no style number" and
"⚠ duplicate style number"). Both were data-checked 2026-10-16: 1 of 398 art items had a
number (0 duplicates); all 33 templates had style numbers but **6 EmergenTee templates
duplicate their base garment's style number** (3001/3010/3480/3501/4400/6400) and 8
templates share `sort_order` 0 — Denise owns both cleanups.

**Build 2 (later): `/mockup/T2491.png`** — a ~1200px catalog PNG of the design composited
on a default garment (decided: **3001 Unisex Cotton T-shirt in Natural**; white/light art
needs a darker color rule), mockup's own background, **placeholder image never 404**, 24h
edge cache (no purge-on-edit for v1). Needs `outputFileTracingIncludes` SHARP_NATIVE for the
route + live-Vercel verification (the known sharp trap).

**Desired-by + design notes on the Shopify order (2026-10-20):** `add-to-cart` stamps two VISIBLE line
item properties on every line of a design — `Desired by` (formatted, e.g. "Sun, Nov 1, 2026") and
`Design notes` (whitespace-collapsed, ≤500 chars; full text stays on `design_orders.notes`) — next to
the hidden `_design_order_id` and the N&N Name/Number/Title. Helpers in `app/lib/cartLineProps.ts`
(tested). Per line, so multi-design carts show each design's own date; cart attributes / order note were
rejected (single value per cart, "earliest" math, stale on line removal). **Gotcha fixed at the same
time:** the already-in-cart idempotency early-return used to drop a changed date/notes entirely; it now
persists them on the row and returns `cartLineStale` when the cart line's properties differ, and the
order page tells the customer to remove + re-add (line properties are fixed at add time).

**Collision guard:** the theme's pet-photo-upload edge function (`pet-photos` bucket,
`pet_photo_uploads` table) lives in the same Supabase project and is **not referenced
anywhere in this repo** — leave it untouched.

## Named Future Features

Real projects, not backlog bullets. Each needs a discovery conversation and
multi-day scoping before being committed to a phase — listed here so they're
costed honestly instead of mistaken for small fixes.

### Design Portability — ⭐ PROMOTED IN-SCOPE FOR LAUNCH (Denise, 2026-07-28)

> **PROMOTED from deferred candidate to launch-scope during the desktop-shaping
> pass.** The desktop redesign's **"Products" rail is the auto-re-fit version,
> not switch-and-warn** — Denise's deliberate call, spending available runway on
> customer experience (online is a large share of the business; a design left
> hanging off the edge after a garment switch is exactly the friction to
> eliminate). This IS the "Switch products mid-design" capability, now committed.
> **Grounded 2026-07-28** (see the coordinate-model findings below); re-fit
> behavior options presented to Denise as a visual decision aid before build.

> **Scope this together with the "Switch products mid-design" backlog item —
> they are the same underlying capability.** Whichever gets built first should
> build the shared foundation for both.

**Coordinate-model ground truth (2026-07-28, verified against the code).**
Object `left/top/scaleX/scaleY` in `canvas_json_front/back` are **100% absolute
to the fixed 680×850 canvas, with zero link to the print area** — no
print-area-relative field, no object→area pointer, and the constraint logic
(`constrainObject`/`fitAndConstrain`) only *clamps* absolute coords, never
computes a box-relative fraction. BUT the print area itself **is** already in a
portable per-product system: `product_template_print_areas` stores natural px +
inches, and `design_orders.print_area_front/back` freezes that snapshot — so the
source box is reconstructable. **Net: the data foundation is ~half-there; the
artwork↔box relationship is the net-new part.** A port must reconstruct the
source box, compute each object's `(center − origin)/size` fraction, and
re-project onto the target box under a **decided re-fit rule**. Per-type
behavior: **plain text re-fits cleanly** (`reWrapText` already re-derives size by
measuring the target overlay — but that couples re-fit to the target product's
print-area overlay being mounted first, no headless path); **images/clipart**
scale by the fit rule; **stroke width** needs explicit handling; **curved text is
the hard case** — it's rasterized to a baked PNG at fixed radius/font-size, so it
must be *re-rendered* (re-invoke the curve renderer with new params via the
preserved `_originalText`/`_isCurvedText`), not transformed, and still can't do
multiline. Blast radius: every constrain/spawn/align/text-reflow/export/restore
path assumes absolute 680×850 (anchors in the 2026-07-28 grounding).

**Re-fit rule — DECIDED (Denise, 2026-07-28; visual aid published).**
- **A Proportional** (scale-to-fit + re-center) is the auto rule. **No
  stretch-to-fill option** — customers never get a control that distorts their
  design; they hand-resize instead.
- **Curved text: re-curve automatically**, shift-if-it-shifts accepted. Denise
  accepts a **v1 caveat on curved text** (esp. multiline-curved) — flag the
  limitation honestly in the UI if one exists, don't block on perfecting it.
- **Front and back each re-fit to their own box.**
- **BOTH paths are launch-scope** (scope change 2026-07-28): (i)
  switch-garment-mid-design AND (ii) **re-open a saved design onto any product**
  — the latter was previously the "deferrable bigger engine" but is
  launch-ESSENTIAL because it's literally how families/teams order (one reunion
  graphic onto unisex + women's + youth). The two share one re-fit engine; (ii)
  hooks it into the restore/open path (source box = the saved row's frozen
  `print_area` snapshot + `template_id`; reconstructable, so no dependence on the
  original product still existing).
- **Saved-design-to-multiple-styles UX = option (a)** (Denise chose A): open a
  saved design onto ONE chosen target product → re-fit → order → repeat per
  style. NOT the multi-product batch flow (option b: select design + N products,
  re-fit + add all at once) — (b) is a costed fast-follow, not launch. (a) reuses
  the single-design order flow entirely; entry lives in the My Designs drawer as
  "use on another product" → product picker → designer opens re-fit.

**D2-scoping fact (Denise, 2026-07-28): print-area RATIO is fixed within a
garment category.** The print box adjusts position/size per mockup, but its
aspect ratio stays constant across garments in the same category. **So Design
Portability re-fitting WITHIN a category is nearly a no-op** (same ratio →
proportional scale only, no reshaping); the **real transform happens ACROSS
categories** (tee-ratio → onesie-ratio). This simplifies D2: the hard
different-aspect-ratio re-projection is only needed on cross-category switches;
intra-category is a trivial uniform scale. Ground it when D2 is scoped. (Also
why print-area PRESETS weren't worth building — few garments per style, so
individual template setup is fine.)

**Implementation note — cheaper path for launch.** A **switch-time transform**
(compute relative on the fly, re-project, write absolute coords back onto the
live objects before the PNG/SVG re-render) avoids a storage-model migration and
is the launch scope — **and it covers BOTH (i) and (ii-a)**: (ii) re-projects at
open-time from the saved row's frozen `print_area` snapshot onto the chosen
target box, one product at a time, so no native-relative storage is needed.
Making `canvas_json` *natively* relative is only required by option (b)'s
batch-onto-N-products at scale, and even that can loop the switch-time transform
— so the natively-relative model stays deferrable. **Depends on the desktop
restructure landing component-first** (needs the multi-product designer + a
mountable target print-area overlay).

**Launch cost (re-estimated 2026-07-28 after the scope change):**
- **Re-fit engine** (shared foundation — coordinate transform, per-type
  handling, curve re-render, both-sides): **~7–10 dev-days**. Curved text is the
  risk item.
- **(i) switch-garment-mid-design** entry (Products rail picker in-session):
  included in the engine estimate.
- **(ii-a) saved-design → one chosen product** (LAUNCH, Denise's choice):
  **+2–3 d** on top of the engine — hook re-fit into the restore/open path + a
  "use on another product" picker in My Designs. Reuses the single-design order
  flow (order one, repeat per style). **→ launch total ~9–13 dev-days.**
- **(ii-b) "multi-product batch apply"** (select design + N target products →
  re-fit all → add all to cart together): **NAMED POST-LAUNCH enhancement,
  data-earned** — build later only if usage shows repeat-per-style annoys
  customers enough to justify it. Cost if/when: **+4–6 d** over the engine
  (multi-select UI, batch re-fit + N-preview, batch cart-add looping the Phase-4
  add-to-cart route with per-item atomicity/idempotency); delta over (a) ≈ +2–3 d.
  Rationale for deferring: (a) already delivers the delight; (b) only adds
  throughput, and building (a) first proves the re-fit core in isolation before
  any batch wrapper.

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

**Size.** Grounded 2026-07-28 as a real multi-day feature (~7–10 dev-days for the
switch-time re-fit; curved text is the risk item). Depends on the desktop
restructure being done component-first. Scoped INTO the desktop-redesign build
sequence (see BUILD_PLAN → "Desktop redesign — grounded build sequence"). Awaiting
Denise's re-fit-rule decision (visual aid published) before build.

### Multi-color recolorable SVGs — true-vector clipart (scoped 2026-10-17, NOT built)

**The ask (Denise):** a two-color design (text + stars) where the customer recolors each color
group independently — "change the text color, the stars stay put." **Grounded:** today
`loadSvgHiRes` rasterizes SVG clipart to a hi-res PNG data URL ("interim fix" so it stays crisp when
enlarged) and `recolorSvg` tints that raster one color with a BlendColor filter (`_currentColor`);
the cut engine (`clipartCutEngine.ts`) re-parses the SOURCE SVG via `_svgOrigSrc` and applies
`currentColor` as a whole-shape tint, else the SVG's own per-path fills, then `cutFileEngine.ts`
emits **one layer per fill color** — so multi-color is already a concept server-side. **Per-slot
recolor cannot be done on the raster path** (a pixel color-key hack fringes on anti-aliased edges
and only works on flat art), so this IS the reason to do the parked true-vector load — which also
retires the crisp-when-enlarged hack and the clipart-heavy 413 risk (no more hi-res data URL in
`canvas_json`; see the `project_clipart_heavy_413` memory).

**Library reality (scan of all 390 SVGs, 2026-10-17):** 357 single-fill, 32 with no fill written
(reads as black), **1 two-color (T4025)**, 1 live `<text>` (Sledding), 1 stroke, 0 gradients / images
/ CSS classes / `<use>` / filters. Median 1 shape (max 109), median 3 KB (max 69 KB) → vector groups
are cheap to render, serialize and restore. The **file-prep rules that make slot detection reliable
are in SHOP_MANUAL.md → Art Library → "SVG file prep"** (explicit fill on every shape, one exact hex
per group, no strokes/text/gradients/masks/images, nonzero holes, tight artboard, Presentation
Attributes export). Denise is rebuilding the library to those rules now, so detection can assume them.

**Build shape (two phases + a sibling):**
- **A. True-vector load (foundation, ~2–3 d):** `loadSVGFromURL` → Fabric Group of paths instead of
  the raster; keep `_isSvg` + `_svgOrigSrc`; groups serialize/restore natively (`enlivenObjects`),
  ride `scaleX/scaleY` like today (the D2 re-fit engine already treats `_isSvg` as the `image` kind
  → unchanged), constrain/align/handles are generic, `exportCanvasPNG` draws the canvas unchanged.
  The embroidery look wraps `_render` (not an image filter) so it works on a group; its
  `preserveColor` mode gives per-slot thread colors for free. Mobile: Fabric object caching keeps
  drag cheap; cap path count at upload (rule 10/13). **Regression sweep is the cost:** spawn, restore,
  autodraft, re-fit, export PNG/SVG, embroidery, Names & Numbers untouched.
- **B. Color slots + per-slot recolor (~2–3 d):** slot = all paths sharing an effective fill
  (resolve inheritance anyway; optional near-shade merge); persist `_svgColorMap` {originalHex →
  chosenHex} in `CANVAS_CUSTOM_PROPS` (single-color art = one slot; migrate `_currentColor` →
  {all → color}); UI = one swatch chip per slot in `SelectionPanel` + `MobileArtBand`, each opening the
  print palette, labelled from the source layer `id` when present (rule 12), else "Color 1/2"; cut
  engine applies the map per path fill (replacing the whole-tint) → layers per CHOSEN color.
- **C. Recolorable vector UPLOADS (sibling, +2–3 d, supersedes the single-color note below):**
  same engine on customer SVGs — keep the vector (bypass the Cloudinary flatten for SVG; AI/EPS→SVG is
  an open question), plus **SVG sanitization** (strip scripts/external refs/`foreignObject`, size and
  path-count caps) because uploads are untrusted; the "what if it's multi-color" question answers
  itself (N slots).

**Size:** A + B ≈ **4–6 dev-days** for library art; C ≈ **+2–3 d**. Needs a discovery pass on the
slot UI (chips vs. a list) before build; not a tweak. Related: [[project_clipart_heavy_413]].
**Sequencing (Denise, 2026-10-17):** this refactor comes BEFORE canvas-wide undo/redo — the true-vector
load is what makes design snapshots light enough for a history stack (see Known Issues → undo/redo).

### Recolorable single-color vector uploads (post-Phase-3 candidate)

A customer uploads a **one-colour vector** (SVG/AI/EPS) and can then recolour it
to any offered print colour — the same way clipart recolouring already works
(`recolorSvg` tints SVG clipart via a Fabric BlendColor filter). Natural sibling
to [Design Portability](#design-portability-post-phase-3-candidate): both are
about artwork being *adaptable* rather than frozen at upload.

Needs: detecting that an upload really is single-colour; keeping the vector as a
vector (today AI/EPS are flattened to a delivery PNG — see the uploaded-originals
note under designer_pricing); and deciding what happens to a multi-colour file
(refuse to recolour? recolour the dominant ink?). **Scoped 2026-10-17 as phase C of "Multi-color recolorable SVGs" above** — the same slot engine answers the multi-colour question (N slots).

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

**Curved text bake DENSITY (2026-10-23).** Shipped while chasing Denise's "SVG art goes soft when
enlarged" report — which turned out to be SVG clipart (T1801) on her non-retina monitor, NOT curved text
(see Known Issues → "Desktop render scale"); the density fix is kept because it was a real, separate
defect: the arc was baked to a bitmap at 1× (one bitmap px per canvas unit), so on a 2× screen every
baked edge was upsampled. `renderCurvedArc` now takes a `density` (default 1; `bakeCurvedArc` passes
`CURVE_BAKE_DENSITY` = 2, fixed, not DPR-dependent, so saved designs are deterministic) and the Fabric
image is shown at `scaleX = scaleY = 1/density` with `_curveDensity` stamped (in `CANVAS_CUSTOM_PROPS`).
**A baked curved image's scale is therefore NOT its size: `effectiveCurvedScale(scale, density)` is.**
The two readers of that scale were normalized: `rebakeCurvedOnResize` (resize → new font size) and
`generateCutFile.ts` (curved placement into `curvedTextToCutPath`; the cut file is proven identical for a
2× bake at scale 0.5 vs a 1× bake at scale 1 — `tests/curve-density.test.ts`). The D2 re-fit callers
use the re-fit factor, not the object's scale, so they were already fine; old bakes carry no density →
1 → unchanged. Production was never soft (cut files are vector from the `_curve*` params); the preview
PNG now gets real detail too. The embroidery look's soft halo (shadow + satin) is by design.

**Placement guides hide by default (2026-10-23).** Reference boxes (e.g. the Cotton T "Chest" 3.5")
were always-on dashed outlines with a label that sat on the artwork. They now render at opacity 0 and
fade in (220 ms) only while the customer drags / resizes / rotates (`object:moving|scaling|rotating` →
`beginInteract`, `mouse:up`/`object:modified` → `endInteract`), or always when the stage-toolbar
**Guides** toggle is on (per-browser `designer.showGuides`; shown only on products that have guides;
quiet non-red selected state). Same spirit as the hat-back arc guide auto-hide. Mobile: show-on-drag
only (no toggle).

**Named future feature — in-place re-wording of CURVED text (logged 2026-07-30,
Denise).** A curved text is a **baked raster image** (`_isCurvedText`; the arc
renderer flattens characters to PNG — see `createCurvedText`/the curve effect),
so its words can't be retyped like a live `IText`. The Phase-2 Issue-1 fix
(commit `3f023b3`) made a curved text stay selectable as "text" — the curve
slider, font/size/color reflect and re-bake from stored bake params
(`_curveFontFamily/_curveFontSize/_curveFill/_curveBold/_curveItalic/_curveAmount`),
and **Straight** (`curve=0`) returns it to an editable `IText`. What's NOT there:
typing new words while the curved text is selected (the box spawns a *new* text
instead). **Interim workaround: Straight → edit the words → re-curve.** Real fix
= re-render the arc from an updated `_originalText` (make the curve renderer a
callable that `handleTextInputChange` invokes for a selected curved image) — same
family as the deferred **stacked-arc** multi-line-curve work above; scope them
together. Not a tweak; a real feature.

### Decal Designs — catalog split + sell-through tracking (post-Phase-4 candidate)

**Real project, three parts scoped TOGETHER — not Phase 4.** Sequencing: candidate
for the desktop-shaping block or a small dedicated pass before the Phase 6
cutover. **Part 2's capture is the one time-sensitive piece — it must precede
launch volume** (see the flag under Part 2). Reporting half joins the
[Order statistics / "Admin Reporting"](#phase-3-backlog--denise-notes-71226)
backlog item — build them as one reporting effort.

**Context.** "Decals" are pre-made **design** artwork the customer places on a
garment (distinct from generic clipart, and distinct from Shopify pre-made
*products*). Today decal designs live in the `clipart_items` pool
undifferentiated, so the designer can't present them separately and orders don't
record which decals were used.

**Part 1 — Clipart/Designs split in the designer** (designer polish scope). Add a
type distinction to `clipart_items` (clipart vs. design) so the designer presents
**"Designs"** as its own browsable section separate from generic clipart. Decals
live **entirely in the Design Tool admin as tagged items — NO reference back to
Shopify pre-made products.** (Denise runs pre-made *product* sell-through via
Shopify product-type reports separately; that is a different surface and stays
separate.)

**Part 2 — Capture decal numbers on orders** (backend completeness).
> **🚨 FLAG — capture must land BEFORE launch volume.** Every order placed without
> decal-number capture is a sell-through data point **lost forever** — it can't
> be backfilled from canvas state after the fact reliably, and never for orders
> already completed. Prioritize Part 2 ahead of the rest if launch is near.

Mechanics — reuse Phase 3's proven machinery wholesale:
- Add a **decal-number field** to design-type `clipart_items`.
- Stamp each placed canvas object with its decal number using the **same
  `_uploadSrc` stamp technique** the Phase 3 used-files filter uses (see
  `CANVAS_CUSTOM_PROPS` in `DesignerCanvas.tsx` and the "used-files filter" note
  under Phase 3 — a new custom prop, e.g. `_decalNumber`, added to the persisted
  props list).
- At cart-add, collect the **LIST of decals used** (multiple allowed — front +
  back, and multiple per side) onto the order row — the **same list-capture
  machinery as used-uploads** (`uploaded_files` shape → a parallel
  `decals_used` list). List, not scalar: one design routinely uses several.

**Part 3 — Reporting.**
- **Primary: units sold per decal over a date range.** Straightforward once Part
  2 captures the list — sum order quantities grouped by decal number.
- **Bonus, ZERO extra capture: adult-vs-kids popularity per decal.**
  Cross-reference the decal list against the **`template_id` already on each
  order** (Phase 2 — templates carry the product identity, so adult tee vs. baby
  onesie is already known per order). Join decals × template → per-decal
  age-segment popularity, for free.
- **Joins the "Admin Reporting" backlog** (order statistics / best-selling
  products/colors/sizes) — one reporting effort, one dashboard, not two.

### Cloudinary backup — Part 2 of the storage backup (DECIDED 2026-10-29, must exist BEFORE real orders)

Part 1 (above, Deployment Notes) backs up Supabase Storage only. **Customer upload originals live on
Cloudinary** (`customer_uploads.cloudinary_url` / `original_url`, the `_uploadSrc` copies inside saved
designs, `design_orders.uploaded_files`), and the "reprints are indefinite" rule makes that the most
important half once orders flow. Today it holds only test data (0 paid orders on 2026-10-29), so the
timing is comfortable, but **it is a launch prerequisite, not a nice-to-have** (Denise: "it must be in place
before we take real orders"). rclone has no Cloudinary backend and no Cloudinary Admin API key is
configured. Two routes to scope when picked up: (a) Cloudinary's own Backup add-on (zero code, if the plan
includes it); (b) our job: list assets through the Admin API (new secret) and copy them into the same B2
bucket under `cloudinary/<public_id>`, with the manifest extended to Cloudinary refs (the backup log already
prints `cloudinary_refs_not_in_this_backup=N` every night so the gap stays visible). ~1 day for (b).

### Embroidery — post-launch feature thread (Denise, 2026-08-04)

**Untouched territory — the THIRD production mode** (vinyl-cut / print-then-cut /
**embroidery**), fundamentally different from the Phase-5 cut/print pipeline:
embroidery machines need **stitch files (DST/PES), NOT SVGs**, and **digitizing
(art → stitch paths) is its own craft**. The SVG cut-file engine does not serve it.

**Business reality (Denise, load-bearing for scoping):** embroidery is done
**in-house**; **currently just hats**, plan to expand (sweatshirts, etc.); pricing =
a **flat price to add embroidery to an item** (flat add-on surcharge — this IS the
"surcharge model" the `designer_pricing` note describes: lower base + set `price_add`;
embroidery is currently dormant with cost baked into the product price).

**Two separable pieces:** (1) **PREVIEW** — an embroidery-look filter on applied
art/text in the designer (thread/stitch texture) so customers see "this will be
stitched", plus an embroidery **option + pricing** on eligible products. (2) **FILES**
— realistically the bundle delivers the **clean vectors (digitizer input)** + maybe
**thread-color mapping**, NOT machine stitch files, **unless auto-digitizing tools
prove viable (research question)**. (The 20 `embroidery` fonts already in
`designer_fonts` — incl Arial/Calistoga, which the cut-outliner can't handle — are
fine here: preview/digitizer, never the cut engine.) Open discovery Qs when picked
up: exact machine/format (DST vs PES), who digitizes + turnaround, thread palette,
which products get the option, flat-price amounts. Multi-day project; needs a
discovery conversation. Full context in the `project_embroidery` memory.

## Deployment Notes

- **Storage backup (2026-10-29): every Supabase Storage bucket → Backblaze B2, nightly, from GitHub
  Actions.** `.github/workflows/storage-backup.yml` (03:30 Chicago + Run workflow) → `scripts/storage-backup.sh`
  (pinned rclone; the bucket list comes from Supabase's S3 root, so new buckets are covered automatically and an
  empty list FAILS; compare = size + server modtime, NOT size-only, because this app overwrites files in place
  via `upsert: true`; deletions → `deleted/<date>/` kept 90 days; per-bucket count check; healthchecks.io
  pings) → `POST /api/backup/manifest` (Bearer `BACKUP_MANIFEST_SECRET`, service role, pure helpers in
  `app/lib/backupManifest.ts`, tested) reconciles the public tables' storage URLs against rclone's listing
  → `manifest/manifest.csv` in B2 with each file `ok` / `orphan` / `missing`. Modelled on quote-builder's
  backup (`~/Desktop/quote-builder/BACKUP.md`); ours differs in those three places. **Covers** all 7 buckets
  incl. `pet-photos` (the Shopify project's, read only — the collision guard is honored). **Does NOT cover
  Cloudinary** (customer upload originals; see Named Future Features → "Cloudinary backup — Part 2") or the
  database (Supabase Pro keeps daily DB backups). Operator doc, setup steps, restores, monitoring: **`BACKUP.md`**.
  Known data fact (2026-10-29): 776 of 778 per-order files in `design-exports` and 27 clipart files are
  orphans — the cleanup crons delete rows, never files; the manifest flags them, cleanup is a separate decision.
- Hosted on Vercel (inferred)
- Environment variables must be set in Vercel dashboard for production (see the
  Environment Variables section above — mind the "Sensitive in Vercel" column)
- Supabase Storage bucket must be configured as public
- Shopify API tokens require proper scopes for product/checkout access
