# Tee Studio Build Plan — Path to Replacing ImprintNext

Planning session completed: 2026-05-02. This document captures the full architecture decisions and phased build sequence. Update only after explicit planning conversations; don't drift from this without re-planning.

## Architecture Decisions

- **Customer journey**: Homepage → "Design Your Own" categories → product page → select color/size → "Design Now" → designer (with pre-population) → live pricing display → "Order Info" page → cart → standard Shopify checkout → standard "thanks" email + auto-generated print files in admin.
- **Login model**: Optional throughout. Anonymous customers can design and order. Login required only when customer wants to save a design or access "My Designs." Login button available anywhere in designer; current design state preserved across login.
- **Cart architecture**: Dynamic product creation per design via Shopify Admin API. Each customer cart-add creates a new hidden Shopify product (tagged `_design_product`, no collection, Online Store enabled so cart-add works). Variants per size, prices calculated from `designer_pricing` table, design preview as product image. Auto-cleanup job removes old design products.
- **Pricing architecture**: Source of truth = `designer_pricing` database table (admin-editable). Designer reads it for live display. Order Options page reads it for totals. When creating dynamic Shopify product, calculated total is set as variant price. Shopify charges what's on the variant — no cart-time price overrides needed.
- **Per-side pricing model**: $12 per printed side, no bundle. Front and back are independent surcharges. Hats and front-only products naturally get only the front surcharge.
- **Embroidery**: Currently baked into base product price. Future activation possible via `designer_pricing` (already has dormant rows + dormant Shopify variant `53029191123260`).
- **Volume discounts**: Removed from codebase. Reintroduce later via Shopify automatic discounts triggered by cart quantity.
- **Cart line item display**: One line per size variant. Front + back design thumbnails (rendered on product color), size, quantity, total only (no breakdown), Remove button. No product name, no color text, no edit link.
- **Checkout**: Standard Shopify; design preview shows naturally because it's the product image.
- **Order email**: Existing setup; verify during testing rather than rebuild.
- **Admin scope**: Tee Studio admin is a design-specific overlay additive to Shopify admin, not a replacement. 5 CRUD areas (pricing, fonts, color palettes, product templates, order management overlay). Customer management lives in Shopify.
- **Shopify Plus**: Not pursued. Cost ($30k+/year) not justified by features needed for this build. Revisit if business outgrows standard plan.
- **Print-ready files**: Format ports from ImprintNext's existing structure (sides/layers/original_image/preview folders, with element-level metadata for fonts/colors/thread). Generated automatically post-payment.

## 🚨 Blockers — must close before customer traffic

### BLOCKER-1: `design_orders` blanket anon read/update → server-mediated access

> **BLOCKER — the `design_orders` blanket anon read/update must be replaced with
> server-mediated access before any customer traffic. Currently all non-completed
> designs are enumerable and writable via the anon key.**

**Must close before the Phase 6 theme cutover.** Lands in **Phase 4**, whose cart
rework already touches every call site involved.

Verified against the live database (2026-07-15), `design_orders` grants `anon` +
`authenticated`:

| cmd | `USING` |
|---|---|
| SELECT | `status IS NULL OR status <> 'completed'` |
| UPDATE | `status IN ('draft','ordering','cart_created')` |

Neither is owner-scoped and **neither requires knowing the row id**. The anon key
ships in the client bundle, so a caller can run `select * from design_orders` with
no filter and read **every** draft and in-flight order, or `update` any of them.
This is **not** the "URL-as-key, UUIDs are unguessable" posture described in
CLAUDE.md — no UUID is needed to enumerate the table.

**Fix:** move the remaining call sites onto service-role routes that derive the
owner/id server-side, then drop the blanket public policies — the same shape as
`customer_uploads` / `saved_designs` (RLS on, **no** policies). Known call sites:

- `app/api/designs/draft/route.ts` — already server-side; swap the anon client for service-role.
- `app/components/DesignerCanvas.tsx` — the "Next Step" insert.
- `app/order/page.tsx` — the design read + quantities/notes/status updates.

**Why it can't ride along quietly:** Day 8 deliberately put My Designs ownership in
a locked `saved_designs` side table *because* of this — stamping
`shopify_customer_id` onto `design_orders` would have made "which customer owns
which design" world-readable and enumerable. The design *content* remains exposed
until this blocker closes.

## Phase Sequence

### Phase 1: Foundation — Auth & Customer Identity (~1 week) — ✅ Complete (2026-07-11)

- Item 2: Customer Account API integration + login-anywhere UI
- Verify modern customer accounts setup at `account.tshirtdeli.com`
- Session management, token refresh, login state across designer

Signed off end-to-end on production; all 9 checklist items pass. Six testing
findings deferred to Phase 3/4 (logged in CLAUDE.md under "Phase 1 sign-off
findings").

### Phase 2: Database & Admin Foundations (~1.5 weeks) — ✅ Complete (2026-07-11)

- Item 16: Print pricing CRUD ✅ (+ per-side print-charge display bug fixed)
- Item 18: Color palettes CRUD ✅ (+ reorder)
- Item 17: Fonts CRUD ✅ (edit/toggle/reorder/delete; no custom upload — see deferred)
- Item 19: Product templates CRUD ✅ (list + print-area editor: draggable/resizable
  rectangles over the Shopify mockup, px + inch coordinates)

Signed off on production. Build order was 16→18→17→19 (colors before fonts so
fonts reused the pattern). Admin-write RLS added for colors/fonts/clipart_categories
(migration `admin_write_policies_colors_fonts_categories`); product template schema
added (migration `create_product_templates`). Day-8 sign-off: full production build
green, all admin routes compile, RLS read+write verified across all Phase 2 tables,
no regressions from later days.

**Deferred out of Phase 2 (tracked in CLAUDE.md):**
- **Custom font upload** → future "Font Management" project (needs dynamic font
  loading infra — runtime Google `<link>` injection + `@font-face` for uploads;
  ~1–2 days infra before UI). Admin font management is currently READ-ONLY.
- **Print-area px→% designer read layer** → Phase 3. The admin captures print-area
  coordinates in the mockup's natural pixels; the designer still reads print areas
  as percentages from a Shopify metafield. Phase 3 must reconcile at the read layer.
- **`set_updated_at()` trigger for `designer_pricing`** → deferred cleanup (its
  `updated_at` is never refreshed on edit; the reusable trigger fn now exists).
- **Print-area reorder (▲▼)** → deferred; revisit if templates exceed ~6–8 areas.
- **New print areas beyond front/back** (shoulder/sleeve) → Phase 3+ (needs
  coordinated designer canvas + cart + variant changes).
- **Colors/fonts public-read `USING true`** returns inactive rows (React filters
  client-side); align to the stricter pricing pattern if inactive-leak bugs appear.

### Phase 3: Designer Polish & Customer Flow (~1.5 weeks)

- Item 1: color/size pre-population from product page
- Item 3: My Designs tab
- Item 4: My Uploads session library
- Item 5: Live pricing display per-side breakdown
- Item 6: Order Options page polish

### Phase 4: Cart Architecture Replacement (~2 weeks, heaviest)

- **BLOCKER-1: `design_orders` server-mediated access** (see Blockers above) — must
  close here; gates the Phase 6 cutover.
- Item 11: Dynamic product creation via Shopify Admin API
- Item 10: Cart-add proxy modification
- Item 12: Cleanup job — **must exclude designs with a `saved_designs` row**
  (`ON DELETE CASCADE` would silently destroy customers' saved work; see CLAUDE.md)
- Item 7: Cart Liquid customization
- Item 8: Checkout (verify defaults; no work)

### Phase 5: Fulfillment Backend (~2-3 weeks)

- Item 13: Print-ready file generation (port from ImprintNext)
- Item 15: Color metadata capture
- Item 20: Order management overlay in admin

### Phase 6: Verification & Launch Prep (~1 week)

- **Gate: BLOCKER-1 must be closed** (see Blockers above) — do not cut over while
  all non-completed designs are enumerable/writable via the anon key.
- Item 9: Order email verification
- End-to-end testing across products, sizes, devices
- Side-by-side comparison with ImprintNext
- Soft launch (single product/collection)
- Monitoring setup
- Cut over from ImprintNext

## Total Estimate

8-10 weeks of focused build work, calendar.

## Deferred (V1.1)

- Item 22: Cart-add idempotency for retry safety
- Item 23: Customer name email-fallback handling
- Item 24: Volume discount reintroduction (Shopify automatic discounts)

## Notes on Today's Work

Today's commit (Print Charge as separate line items + volume discount removal) represented an architectural direction we walked back from. The dynamic product approach is the architectural successor. That commit's code may need to be partially rolled back or evolved during Phase 4 — leaving in place for now since it doesn't actively break anything (and ImprintNext is still our live system).
