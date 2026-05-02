# Tee Studio — Development Guide

## Project Overview

**Tee Studio** is a custom t-shirt design tool that integrates with Shopify for product management and checkout. Users can design t-shirts using a canvas-based interface with text, clipart, and image uploads, then add personalized designs to their cart.

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

## Deployment Notes

- Hosted on Vercel (inferred)
- Environment variables must be set in Vercel dashboard for production
- Supabase Storage bucket must be configured as public
- Shopify API tokens require proper scopes for product/checkout access
