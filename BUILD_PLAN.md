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

### BLOCKER-2: Designer on Mobile — phase-sized, needs its own discovery pass

> **LAUNCH GATE — the designer is desktop-only today and must work on phones
> before the Phase 6 cutover. The majority of customers order via mobile;
> launching desktop-only means launching closed to most of the store's traffic.**

**Must complete before the Phase 6 cutover.** This is **phase-sized** — a project,
not a polish item — and it gets a **dedicated discovery pass after Phase 3
closes**. Deliberately NOT scoped in detail here; the gate is what's being
recorded today.

Verified against the code 2026-07-15: `DesignerCanvas.tsx` has **zero** responsive
breakpoints (`grep -c 'sm:|md:|lg:'` → 0), and the layout is `h-screen` with a
fixed **288px** left tool sidebar + **256px** right sidebar — **544px of chrome
before the shirt**. On a 390px-wide phone the designer is unusable as built.

Scope headings only (to be filled in at discovery):

- **Responsive layout** — the two fixed sidebars must become something else on
  small screens (drawers? bottom sheet? tabs?), and the canvas needs to own the
  viewport.
- **Touch-first interactions** — drag / resize / select assume a mouse. Several
  affordances are hover-only today and have **no touch equivalent**: the My
  Uploads "+ Add" overlay, the tile ✕ controls, the My Designs "Open" overlay.
- **On-screen keyboard management** — the keyboard covers roughly half the
  viewport, so text editing needs `visualViewport` handling to keep the print
  area visible while typing.

**Sequencing note (updated Day 9.2 — the overlap shrank).** This gate previously
had to precede "Add Text v2", because live-preview typing put a caret on the
canvas and shared the on-screen-keyboard problem. Day 9.1/9.2 moved text editing
into a **DOM textarea** in the panel instead, so typing is now a normal form
control the OS keyboard already handles well — which is *easier* on mobile than a
caret on a canvas, not harder. **No sequencing constraint remains**; the keyboard
work here is now about keeping the print area visible while a normal input has
focus.

### BLOCKER-3: the cart sends ONE variant for EVERY size

> **BLOCKER — the cart currently adds the wrong variant for every size except the
> one the design was created in. Wrong price, wrong inventory, wrong fulfilment.
> It does NOT error, so testing passes.**

Found while diagnosing the Phase 3 sign-off cart failure (2026-07-15).
`app/order/page.tsx` resolves a single `variantId` from the design's saved
`shopify_variant_id` and reuses it for **every** line item, carrying the size only
as a `_size` **text property**:

```js
const variantId = design.shopify_variant_id?.split('/').pop() || ''
...map(([size, qty]) => ({ variantId, quantity: qty, properties: { _size: size } }))
```

Compounding it, `selectedVariant` in the designer is matched by **Colour only** at
all three call sites, so the one variant used is arbitrary with respect to size.

Design in White/3-6MO, order 2×6-12MO → both lines are the **White/3-6MO**
variant. Shopify prices, reserves and fulfils that variant.

**Fix belongs in Phase 4** (cart architecture), which replaces this wholesale with
dynamic per-design products. Do not patch it ad hoc — but it MUST be closed before
customer traffic.

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
  - **Recorded cart UX expectation (Denise, Phase 3 sign-off):** the current cart
    shows **two lines** (garment + print charge) which reads as awkward — the
    wanted outcome is **one line, one price, with the design imagery as the
    product**. She arrived at this independently while testing; it is Phase 4's
    dynamic-product architecture described in customer terms, so it belongs here
    rather than as a cosmetic cart-styling ticket.
- Item 8: Checkout (verify defaults; no work)

### Phase 5: Fulfillment Backend (~2-3 weeks)

- Item 13: Print-ready file generation (port from ImprintNext)
- Item 15: Color metadata capture
- Item 20: Order management overlay in admin

### Phase 6: Verification & Launch Prep (~1 week)

- **Gate: BLOCKER-1 must be closed** (see Blockers above) — do not cut over while
  all non-completed designs are enumerable/writable via the anon key.
- **Gate: BLOCKER-2 (Designer on Mobile) must be complete** — do not cut over
  with a desktop-only designer; most customers order on phones.
- End-to-end testing must cover **phones**, not just desktop browsers.
- Item 9: Order email verification
- End-to-end testing across products, sizes, devices
- Side-by-side comparison with ImprintNext
- Soft launch (single product/collection)
- Monitoring setup
- Cut over from ImprintNext

## Total Estimate

8-10 weeks of focused build work, calendar.

> **This estimate does NOT yet include BLOCKER-2 (Designer on Mobile)**, which is
> phase-sized and unscoped pending its discovery pass after Phase 3 closes. It is
> a launch gate, so the calendar to cutover will grow once it's scoped — treat
> 8-10 weeks as the pre-mobile figure, not the number to launch.

## Deferred (V1.1)

- Item 22: Cart-add idempotency for retry safety
- Item 23: Customer name email-fallback handling
- Item 24: Volume discount reintroduction (Shopify automatic discounts)

## Notes on Today's Work

Today's commit (Print Charge as separate line items + volume discount removal) represented an architectural direction we walked back from. The dynamic product approach is the architectural successor. That commit's code may need to be partially rolled back or evolved during Phase 4 — leaving in place for now since it doesn't actively break anything (and ImprintNext is still our live system).
