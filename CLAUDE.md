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
│   │   ├── supabase.ts               # Supabase client
│   │   └── shopify.ts                # Shopify Storefront API client
│   │
│   ├── api/
│   │   ├── product/route.ts          # GET product data from Shopify
│   │   ├── preview/route.ts          # CORS proxy for shirt images
│   │   ├── admin-upload/route.ts     # POST clipart to Supabase
│   │   ├── admin-auth/route.ts       # Admin password authentication
│   │   └── shopify-webhook/route.ts  # (Webhook endpoint - TBD)
│   │
│   ├── admin/
│   │   ├── layout.tsx                # Auth guard for admin routes
│   │   ├── clipart/page.tsx          # Clipart management
│   │   ├── orders/page.tsx           # Design orders history
│   │   └── pricing/page.tsx          # Pricing configuration
│   │
│   ├── admin-login/
│   │   └── page.tsx                  # Admin password entry
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

Inferred from code usage:

- **clipart_categories** - Category groupings for clipart (with `is_active`, `sort_order`, `print_method_key`)
- **clipart_items** - Individual clipart files (with `file_url`, `file_type`, `tags`, `is_active`, `sort_order`)
- **designer_fonts** - Font library per print method (label, value, `is_active`, `print_method_key`)
- **designer_colors** - Color palette per print method (hex, `is_active`, `print_method_key`)
- **design_orders** - User designs (product/variant IDs, canvas PNGs, quantities, totals, status tracking)
- **clipart_storage** - Supabase Storage bucket for file uploads

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
- **Tailwind classes** with dark mode support (`dark:bg-black`)
- Custom color palette: `#0d0d0d`, `#1e1e1e`, `#2a2a2a` (dark UI)
- Accent colors: `#e8ff47` (yellow), `#dd3333` (red)
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

### Authentication & Security
- **Basic password auth**: Admin login uses simple environment variable comparison; not suitable for production
- **No CSRF protection**: Admin upload endpoint lacks CSRF tokens
- **Credentials in cookies**: `admin_auth` cookie stores password directly (should use secure tokens/sessions)

### Missing Infrastructure
- **Empty types directory**: No shared types or interfaces
- **Boilerplate landing page**: `app/page.tsx` still shows default Next.js template
- **No environment validation**: Missing `.env.local` documentation or runtime validation
- **No testing setup**: No Jest, Vitest, or testing libraries configured
- **No migration files**: Supabase schema not version-controlled

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
- **Webhook incomplete**: `shopify-webhook/route.ts` exists but empty

### Documentation
- **No API docs**: Endpoint parameters and responses undocumented
- **No database schema documentation**: Supabase tables not formally documented
- **No environment guide**: Missing `.env.local.example` or setup instructions
- **No deployment guide**: Vercel setup not documented

### Dependencies
- **Next.js 16.2.4** is very recent; may have stability or compatibility issues
- **React 19.2.4** (RC/beta at training cutoff) — consider pinning if issues arise
- **Supabase auth-helpers**: Version 0.15.0 is older; may be outdated

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
