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
├── middleware.ts                     # Root middleware — refreshes Supabase session per request
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
│   │   │   └── middleware.ts         # updateSession helper for root middleware
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
    ├── bulk-clipart.mjs              # Bulk upload clipart to Supabase
    ├── fix_text.py                   # (Deprecated?) Component modification script
    └── update_designer.py            # (Deprecated?) Component modification script
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
- **Partial migration history**: Supabase migrations exist for the 2026-04-30 RLS lockdown (applied via Supabase MCP), but earlier schema is not in git. New schema changes should go through `apply_migration` so they're tracked.

### Code Quality
- **Inconsistent naming**: Snake_case in database, camelCase in components
- **Hardcoded values**: Color maps, sizes (`SIZES = ['S', 'M', 'L', ...]`), pricing scattered throughout
- **Magic numbers**: Font sizes, canvas constraints, percentage calculations
- **Python automation scripts**: `fix_text.py` and `update_designer.py` modify TSX files directly — fragile and hard to maintain

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
