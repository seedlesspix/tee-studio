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

### BLOCKER-2: Designer on Mobile — DISCOVERY COMPLETE (2026-07-16), scoped

> **LAUNCH GATE — the designer is desktop-only today and must work on phones
> before the Phase 6 cutover. The majority of customers order via mobile;
> launching desktop-only means launching closed to most of the store's traffic.**

**Status: discovery done (58 findings, file:line-evidenced, 7-agent audit +
independent verification). Shape approved by Denise 2026-07-16. Estimate ~2–2.5
weeks. Build slot: AFTER Phase 4 (see "Sequencing after Phase 3").**

**What breaks today (the blockers, precisely):**

- **The shirt renders in a 0px-wide box.** 288px + 256px of `shrink-0` sidebars
  vs a 390px viewport; the `flex-1` canvas section has min-width 0 and collapses
  to exactly zero (`DesignerCanvas.tsx:2210/:2213/:2529/:2699`). A phone customer
  sees the tool panel and a clipped sliver of the price column — never the garment.
- **"Next Step" is the first thing clipped.** Six header occupants in one nowrap
  row (intrinsic min ~500px), overflow hidden — the rightmost casualty is the only
  path to checkout (`:2151-2206`).
- **Nothing scrolls.** `overflow-hidden` at three nesting levels; clipped content
  is unreachable except by undiscoverable pinch-zoom panning.
- **The 680×850 stage is hardcoded in three coupled places** (wrapper style
  `:2572`, Fabric init `:802-807`, px→% constant `:675`).

**What already works (verified — this halves the project):** the 680×850
coordinate space is device-independent and saved designs are display-independent;
the bounds math and Fabric's pointer math are both CSS-scale-invariant (the
property that makes scale-the-display viable); Day 9's box-first typing is
mobile-correct at its core (DOM textarea, no canvas caret); constrain handlers are
input-agnostic; zero keyboard shortcuts exist to lose; iOS tap-to-upload verified
working; MyDesigns drawer + panel internals already fluid; admin cleanly scopes out.

**Majors beyond the layout:** hover-only ✕ deletes on upload/design tiles (hidden
but tappable, no confirm); 24px selection handles vs ~44px touch targets;
double-click-only text re-edit; the 320px saved-link popover unclamped; order page
fixed two-column (`order/page.tsx:196/:234`); zero keyboard-awareness
(no visualViewport anywhere); PLUS a perf batch the audit surfaced: 2.5MB
unsubsetted fonts + 21 Google families with no font-display and measurement that
doesn't await font load; Curve slider does a full raster rebuild per input event;
phone photos ingested at full resolution; zero page-lifecycle persistence (a
backgrounded Safari tab silently loses the design).

**The approved shape (Denise, 2026-07-16):** shirt-first — the garment owns the
viewport; the existing four tool tabs (Text/Upload/Art/Style) become a **bottom
sheet** (peek/half/full); **price + Next Step become a fixed bottom bar** so the
checkout path can never be clipped again; when the text box focuses, the sheet
collapses to the docked textarea and the shirt scales into the strip above the
keyboard (possible only because Day 9 moved the caret into a DOM textarea). One
breakpoint; desktop untouched.

**Reference baseline — the live ImprintNext mobile designer** (screenshots on
file, 2026-07-16). Customers are already trained on: shirt dominant with dashed
print area; bottom tool tab bar (Product/Text/Design/Image/Idea); tap-selection
showing **finger-sized corner controls** (move / rotate / scale / trash as large
tap squares); a **contextual editing strip** replacing the tab bar when an object
is selected (Back/Type/Size/Font/Shape/Color with font-category chips); front/back
thumbnails + color dropdown above the tools; price + Next pinned **top**.
Record two uses: **(a) familiarity baseline** — the approved shape speaks the same
grammar, so customers transfer; the one deliberate deviation is the checkout bar
at the **bottom** (thumb reach) instead of IN's top. **(b) capability checklist**
— IN's selected-object handles and contextual text strip are finger-sized and
functional; Tee Studio mobile must meet that bar, not just render.

**Estimate: ~2–2.5 weeks** (≈1.5–2 without the perf batch). Core relayout 3–4d ·
touch affordances 1.5–2d · keyboard mode 1d · order page 0.5–1d · real-device QA
2d · perf batch (fonts/curve/photo-downscale/persistence — benefits desktop too,
can land separately) 1.5–2d.

**Named constraints — if one falls, the number moves:**
1. **680×850 coordinate space kept; display CSS-scaled.** Fallback if device
   testing falsifies: zoom recipe + bounds-helper rework, +1–2d. (Open item for
   first device test: whether `canvasEl.width` includes devicePixelRatio under
   Fabric 7 retina scaling — one audit claims yes, empirical desktop behavior says
   no; either way the nine duplicated conversion sites consolidate into one helper.)
2. **Box-first typing stays** — keyboard work is viewport management, not editing
   rework.
3. **The four tabs are relocated, not redesigned** — a mobile-native tool rethink
   is a different project.
4. **Admin stays desktop** (verified: no customer flow touches /admin).
5. **One breakpoint; desktop untouched above it.**
6. **Desktop STRUCTURE is settled before the mobile build starts.** Denise has a
   desktop layout/options shaping conversation coming — **slot it in the Phase 4
   window, explicitly.** Panel CONTENTS may keep evolving (the sheet inherits
   them); desktop STRUCTURAL/layout changes after the mobile build would reopen
   priced questions.

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

### Phase 3: Designer Polish & Customer Flow (~1.5 weeks) — ✅ Complete (2026-07-15)

All five planned items shipped, plus the work the build surfaced. Signed off
against a full checklist run end-to-end on **BOTH products** (Unisex Cotton Tee
and 100% Cotton Onesie).

- Item 1: color/size pre-population from product page ✅
- Item 3: My Designs tab ✅
- Item 4: My Uploads session library ✅
- Item 5: Live pricing display per-side breakdown ✅
- Item 6: Order Options page polish ✅

**Days 1–9 inventory:**

| Day | Shipped |
|---|---|
| 1 | Color/size + variant pre-population (exact GID match; all state driven from the resolved variant) |
| 2 | Shopify theme migration — ImprintNext glue removed, "Design Now" gated by the `blank-product` tag. **Draft theme still unpublished** |
| 3 | Designer reads print areas from `product_templates` (containment-aware px→%); template + frozen geometry captured on save |
| 4 | Per-side pricing split; **view-aware save fix** (back designs were saving into the front slot); back-side restore on Edit Design |
| 5 | Order Options polish — dual-side preview, view-aware PNG capture, Design Notes, cross-side Next-Step check, garment-hex capture, browser-Back fix |
| 6 | Per-template garment colors (`product_template_colors` + `garment-swatches` bucket + admin editor + designer read) |
| 6.5 | **Onesie blank-canvas fix** — contains-based color→image matching, featured-image fallback, "⚠ no image matched" badge, GID normalization |
| 7 | My Uploads library (`customer_uploads`, `/api/uploads`, adopt-on-login, `tee_session`) + **onesie size fix** (sizes from the Shopify Size option, in variant order) |
| 8 | My Designs (`saved_designs` locked side table, `/api/designs`, Save + drawer, restore-by-link, adoption generalized) |
| 9 | Add Text — box-first typing, silent-revert fix, `fitAndConstrain`, **Enter = real line break**, one editing surface, curve guard |
| Sign-off | Print Charge publication fix, cart-reachability badge, uploaded originals retained, used-files filter, dead download links revived |

**Second-product testing earned its keep.** Running the onesie through the whole
flow caught **two** assumptions hardcoded for the Cotton Tee before templates
existed (the image-filename parser → Day 6.5; the size list → Day 7) plus a third
cosmetic one (size labels sized for single-character adult sizes). **Keep doing
this on every new product type.**

### Deferred from Phase 3

Each lives somewhere canonical; this is the index, not the detail.

| Item | Status | Canonical entry |
|---|---|---|
| `design_orders` blanket anon read/update | 🚨 **Blocker** — before customer traffic | BLOCKER-1 above (lands in Phase 4) |
| Designer on Mobile | 🚨 **Launch gate** — phase-sized, unscoped | BLOCKER-2 above (discovery next) |
| Cart sends ONE variant for EVERY size | 🚨 **Blocker** — silent, wrong fulfilment | BLOCKER-3 above (lands in Phase 4) |
| Add Text v2 — stacked-arc curve remnant | Deferred, low priority | CLAUDE.md → Named Future Features → "Add Text" |
| Design Portability | Post-Phase-3 candidate, multi-day | CLAUDE.md → Named Future Features |
| Recolorable single-color vector uploads | Post-Phase-3 candidate | CLAUDE.md → Named Future Features |
| Persistent / shared print-color panel | Design-note quality | CLAUDE.md → Phase 3+ Backlog |
| Print pricing flat per side | ✅ **Decided 2026-07-15, not open** — a onesie print costs the same as a tee print | CLAUDE.md → designer_pricing ("don't fix this") |

### Phase 4: Cart Architecture Replacement (~2 weeks, heaviest) — PLAN APPROVED 2026-07-17, awaiting day-0 credentials

**Business context, worth naming:** today with ImprintNext every customer design
becomes a product **live in all channels** — visible on the all-products page
until Denise manually excludes them in batches. Phase 4's channel-invisible
creation **deletes that chore entirely** and closes a live storefront-quality
gap. Launch benefit, not implementation detail.

**Architecture (approved):**

- **Ephemeral-product philosophy: our DB is the source of truth; Shopify
  products are disposable renderings of it.** Nothing may ever depend on a
  design-product surviving — a reorder RECREATES the product from the stored
  design (the "reorder-recreates" model, which dissolved the 90-day-archive
  question). Cleanup can therefore be aggressive.
- **Mechanism A — headless-channel-only publication + Storefront API cart.**
  Dynamic products publish ONLY to the Storefront token's channel (never
  browsable); purchase via `cartCreate`/`cartLinesAdd` → `checkoutUrl` → standard
  Shopify checkout. `cart/add.js` and the Print Charge product leave the design
  purchase path. Channel independence is proven in this store (Phase 3).
- **The Order Options page becomes the cart** — one line per size, one price,
  design imagery as the product (Denise's recorded expectation, delivered by us
  rather than fought through Liquid). Item 7 (Cart Liquid) dissolves into
  order-page polish. Accepted trade: custom + regular purchases are two checkouts.
- **Price display: a single variant price** (all size variants carry the same
  price — garment + print baked in, uniform across sizes).
- **Per-size variants on the dynamic product close BLOCKER-3.**
- Rate limits: no engineering needed — Grow shares the Standard 100 pts/s
  GraphQL tier (verified against live docs 2026-07-17; the tier premise was
  wrong, the conclusion holds on arithmetic: a cart-add costs ~40–60 pts).
- Admin app scopes (final, granted exactly): **write_products,
  write_publications, read_orders.** Fallbacks if day-1 probes demand
  (write_inventory, write_files) are a config edit on the same app.
- **Credential model (corrected 2026-07-17 against live docs — legacy custom
  apps CANNOT be created after 2026-01-01; new apps come from the Dev
  Dashboard):** the app is "Tee Studio Server" (already created in the Dev
  Dashboard). There is NO static shpat_ token. The server holds **client
  credentials** and mints short-lived Admin tokens itself:
  `POST https://{shop}.myshopify.com/admin/oauth/access_token` with
  `grant_type=client_credentials&client_id&client_secret` → `{access_token,
  scope, expires_in: 86399}` (24h). Doc-verified: grant is for org-owned apps on
  org-owned stores; the app must be **installed on the store first**. Install
  path as actually clicked 2026-07-16 (there is NO "Distribution" menu in the
  current Dev Dashboard): app **Overview page → Installs card → "Install app"
  button → store approval screen** — scopes appear there as consumer-grouped
  categories; ours verified matching the three via the expansion chevrons.
  Scopes come from the app's Dashboard/TOML config, and the token response's
  `scope` field is the day-1 proof all three landed (confirmed on day 1:
  `read_orders,write_products,write_publications`, exact match).
  Env: **SHOPIFY_ADMIN_CLIENT_ID** (not secret), **SHOPIFY_ADMIN_CLIENT_SECRET**
  (Sensitive; rotatable in the Dashboard — an upgrade over the one-time reveal),
  **SHOPIFY_ADMIN_DOMAIN**. The Day-1 admin client adds a mint-and-cache token
  helper (~23h TTL). The **"app automation token (CI/CD workflows only)" is NOT
  the server credential** — it deploys app config, it cannot make Admin data
  calls; never wire it into the app.
- Webhook ORDERS_PAID still registers via `webhookSubscriptionCreate`
  (doc-verified: TOML or GraphQL both supported). HMAC secret for Dashboard apps
  is expected to be the **client secret** — empirically verified day 1 (the
  route logs HMAC failures loudly); the separate SHOPIFY_WEBHOOK_SECRET var
  retires in favor of the client secret once confirmed.

**Day 1 probe results (2026-07-16, all against the LIVE store; throwaway
product created and deleted):**

- **Token mint works**: client-credentials grant → `expires_in 86399`, scope
  `read_orders,write_products,write_publications` — exact match, proof of
  install + grant. (Day-0 landing hiccup: the secret arrived **double-pasted**
  — `read -rs` echoes nothing, so a second paste lands silently; the stored
  value was the same 38-char secret twice. Detected by length/shape, repaired
  locally without display. **Add a length self-check to any future secret
  drill**, and Denise must re-enter the Vercel copy fresh.)
- **Channel map**: Online Store `Publication/2110128158`, ImprintNext
  `…/270630945084`, **Headless `…/291451601212` = the Storefront token's
  channel** (proven empirically: publish to Headless only → `getProduct`
  visible).
- **`productSet` creates channel-invisible by default**: 0 publications on
  creation; storefront URL 404, absent from `/products.json`, Storefront API
  null. The hard requirement costs nothing — no "hide it" step exists or is
  needed. Per-size variants + single price + **Supabase-hosted image accepted
  as product media with NO `write_files` scope**. Cost: **23 pts actual**
  (bucket 2000, restore 100/s → ~86 products/second sustained; a whole cart of
  designs is trivial).
- **Headless-only publish keeps Online Store blind**: after
  `publishablePublish` (10 pts), Storefront API serves the product while the
  storefront URL still 404s and `/products.json` still omits it.
- **`cartCreate` works with the existing public Storefront token** (it already
  has cart write scopes — the day-0 "check cart boxes" item is moot). Line
  attributes carry; `checkoutUrl` lands on the primary domain and the checkout
  page loads (200 terminal at `/checkouts/cn/…`) **for a product published to
  zero visible channels** — checkout is channel-agnostic.
- **Inventory defaults are sellable**: `tracked: false`, policy DENY,
  qty 0 — purchasable with no stock management and no `write_inventory` scope.
- **🚨 RETENTION-JOB CONSTRAINT (probe 7b): deleting a product SILENTLY
  EMPTIES any live cart holding it** — `totalQuantity` drops to 0, no error,
  the checkout URL still loads but hollow. Same silent-destruction class as
  the draft-cron/saved_designs cascade. The Day-7 `_design_product` retention
  job must therefore NEVER age-delete a product that could still be in an open
  cart: delete only after the order is paid (webhook-confirmed) or after the
  cart's maximum lifetime (~10 days) has safely elapsed since last cart
  activity referencing it. "Aggressive" retention means aggressive *after
  those gates*, not before.
- `productDelete` cost: 10 pts.

**⚡ Day-6 REQUIREMENT CORRECTION (2026-07-16, Denise): designs go to the CART,
not straight to checkout.** This is a cart store — customers combine several
designs and off-the-shelf products into ONE order. The Mechanism-A pieces that
assumed a standalone server-side Storefront cart were revised after a live
grounding pass:

- **Carts have an owning channel (new probe finding, sibling to "name the
  surface").** The Online Store session cart and Storefront-API carts are the
  SAME object (the `cart` cookie token IS a Storefront cart id, and each
  surface filters the lines to its own channel's publications) — but line
  ELIGIBILITY follows the cart's owning channel, not the API caller's:
  `/cart/add.js` AND Storefront `cartLinesAdd` both reject headless-only
  variants for a session cart. **Mixed carts therefore force Online Store
  publication of design products. No API path routes around it.**
- **Visibility requirement REVISED (approved by Denise):** from
  "channel-invisible" to **minimized + time-bound** — `seo.hidden=1` at
  creation (no store search / sitemap), no collections (ops check: no
  catch-all automated collections), no Headless publication at all, and the
  Day-7 retention job ends the exposure. Residual: `/products.json` + direct
  URL during the customer's shopping window only. Still strictly better than
  ImprintNext (visible in all channels indefinitely until manual exclusion).
- **`seo.hidden` live-verified with a control pair (2026-07-16): it is NOT
  zero-channel invisibility.** Search: conclusively hidden (control indexed
  within 20s and visible in predictive + full-page search; hidden probe
  absent from both). **But BOTH probes appeared in `/collections/all`** — the
  auto-generated all-products browse page at a guessable URL. Fix shipped +
  pending: design products now carry **`productType: 'Custom Design'`**, and
  **Denise creates an automated collection with handle `all`** (rule:
  *Product type is not equal to `Custom Design`*) — a merchant collection
  handled `all` REPLACES the auto one, so /collections/all stops listing
  design products. **Walkthrough must re-verify /collections/all after that
  collection exists.** Sitemap check was lag-inconclusive (doc-based
  confidence; low stakes given retention deletes products in days).
- **Direct-URL purchasability window: ACCEPTED — Denise's explicit call,
  2026-07-16 (post-walkthrough).** A design product's `/products/custom-…`
  URL stays live and purchasable from creation until the Day-7 retention job
  deletes it (paid-or-cart-expired gates). Chosen residual of the cart
  revision, now decided rather than inherited: browse/search/collections are
  closed; the raw URL (and `/products.json`) remain reachable during the
  shopping window. Do not "fix" this without a new decision.
- **Walkthrough #7 post-mortem (events-log-proven):** purchase flips NOTHING
  product-side. The confusion had two real sources: **(a)** Shopify
  AUTO-published each new product to the **United States market catalog**
  (benign, required by Markets) and **"Microsoft Copilot"**; **(b)** Denise
  manually excluded walkthrough products from the Online Store (the
  ImprintNext-era reflex) — that reflex must retire for `Custom Design`
  products: excluding a product still in a live cart silently empties those
  cart lines (probe-7b class). Note: our `resourcePublicationsV2` reads CANNOT
  see Copilot/Markets publications — blind surface (see CLAUDE.md
  full-replace/blind-surface rule).
- **"Microsoft Copilot" RESOLVED (2026-07-16, doc-verified): no action
  needed.** It is not an installed app/sales channel — it's **Shopify-managed
  agentic syndication ("Shopify Catalog")**, admin location **Sales channels →
  Agentic → Microsoft Copilot** (which is why it isn't in the channel list).
  The publish event carries no channel id and no api_client_id (Shopify-
  authored catalog membership). Per Shopify's docs, **`seo.hidden = 1` hides a
  product from ALL agentic storefronts including Copilot/Shopify Catalog** —
  and every design product already ships with `seo.hidden=1` (39cca76). The
  "included on Microsoft Copilot" event is catalog membership; the Catalog's
  discovery layer filters seo.hidden products from what AI surfaces see.
  **Leave the Agentic channel ON** (a store-wide opt-out would also pull the
  real off-the-shelf products out of Copilot discovery). Definitive
  per-product publication check ran via `publishedOnPublication` against
  every enumerable publication (6 app channels + MarketCatalog `United
  States`/Publication 112239083836): the tested design product is live ONLY
  on the US market catalog — benign Markets membership. Copilot has no
  API-enumerable publication; the admin product page's Publishing card is the
  only per-product surface that names it. Residual (same accepted class as
  the direct-URL window): docs note AI channels may still reference pages via
  ordinary web crawling.
- **The cart handoff is the customer's own `/cart/add.js`** — the prod app
  lives at **create.tshirtdeli.com**, same site as the store, so Shopify's
  `.tshirtdeli.com` cart cookie reaches our routes and
  `/api/design-orders/[id]/add-to-cart` forwards it (cookie plumbing
  resurrected from the retired proxy, incl. the Set-Cookie Domain rewrite).
  One `items[]` POST, all sizes, `_design_order_id` property per line; the
  route is idempotent (reads the cart first; a design already in the cart →
  `alreadyInCart`, quantities are then edited natively on /cart).
- **Blank-vs-designed: Option A (Denise).** Blank products are designer-only —
  never sold standalone. The double-charge shape is structurally impossible:
  the blank line never exists; only the design product (folded price) does.
  Theme walkthrough must confirm blank-product pages suppress the native
  add-to-cart (the `blank-product`-tag gating in buy-buttons.liquid).
- **Webhook now processes EVERY `_design_order_id` in an order** (multi-design
  + mixed orders are first-class; taking only the first would strand later
  designs in `cart_created`). Verified with a synthetic signed order: 2
  designs across 3 lines + 1 off-the-shelf line → both rows completed, dedupe
  held, off-the-shelf ignored.

**Day-by-day (security sequencing approved: lock first, build on locked ground):**

| Day | Work |
|---|---|
| 0 | ✅ **DONE 2026-07-16.** Credentials landed (after the double-paste incident — see Day-1 probe results above); Vercel copy re-entered and **functionally verified** (HMAC-signed synthetic POST to the prod webhook route → 200). The day-0 "check Storefront token cart scopes" item proved moot — day-1 cartCreate worked with the existing token |
| 1 | ✅ **DONE 2026-07-16** (9e1a270, 95bc9bd). All probes green — see "Day 1 probe results" above. **ORDERS_PAID registered**: subscription gid …1985565327676 → tee-studio.vercel.app/api/shopify-webhook, created 16:56Z, query-back verified. Residual: first REAL order delivery is the empirical proof Shopify signs with the client secret — watch prod logs for "HMAC verified via SHOPIFY_ADMIN_CLIENT_SECRET"; ImprintNext orders 200-skip harmlessly (no _design_order_id) |
| 2–3 | ✅ **DONE 2026-07-16** (587ed99 + 2fe1c46, migration 20260716164236). **BLOCKER-1 CLOSED** — all anon design_orders access behind /api/design-orders + /api/designs/draft (service role); three public policies dropped; post-checks green (anon list [], insert 401, blanket update 0 rows, draft-by-UUID restore 200 on prod, admin_all sole survivor). Third table on the locked pattern |
| 4–5 | ✅ Service + route **DONE 2026-07-16, e2e-verified vs the live store** (throwaway design → `POST /api/design-orders/[id]/checkout` → ephemeral product w/ per-size variants @ folded price → headless-only publish → Storefront cart → checkoutUrl loads; Online Store 404 + absent from /products.json; failure path deletes the product — atomic toward Shopify). `app/lib/design-products.ts` + checkout route. **Tag-search gotcha for cleanup jobs: colon-valued tags must be QUOTED** — `tag:'design_order:<uuid>'` finds it, unquoted silently returns nothing |
| 6 | ✅ **BUILT + smoke-verified 2026-07-16 (revised shape) — awaiting Denise's walkthrough before push.** Order page's one button → `/api/design-orders/[id]/add-to-cart` → design joins the customer's REAL session cart mixed with off-the-shelf ($126 = tee + 3× design, per-size lines, properties threaded); idempotent second click; unknown-size 400; notes persisted; atomic product-delete on cart-add failure. Print-Charge machinery deleted (routes, resolvers, admin badge, `getStoreOrigin` restored for the new handoff). Webhook multi-design fix verified. Straight-to-checkout `/checkout` route deleted |
| 7 | Cleanup jobs: `_design_product` retention (aggressive **after the paid-or-cart-expired gates — see Day-1 probe 7b: deletion silently empties live carts**) + the draft cron **with the `saved_designs` NOT-EXISTS exclusion** |

**🚨 ORDER VISIBILITY — GATES PHASE 5 GROUNDING (found Day 7, 2026-07-16).**
Orders containing Tee Studio design products (#16986/87/88) are **whole-object
INVISIBLE to the app** on every Admin API surface — `order(id:){id}` returns
null, they're absent from `orders` lists/searches (by window, by email), REST
404s — while every other order, including a NEWER off-the-shelf one (#16989),
is visible. Ruled out: test orders (`test:true` search empty; visible orders
`test:false`), field-level PCD redaction (minimal `{id}` query still null),
recency. Correlation is exact: contains-design-products (all three are also
Denise-as-buyer — inseparable until a real customer buys). Leading suspect:
**Protected Customer Data approval** for new Dev Dashboard apps (request it in
the app's API-access settings, then re-probe). **Phase 5 fulfillment reads
orders — this must be resolved before Phase 5 is grounded.** Consequence
already absorbed: the Day-7 retention job dropped its per-order paid gate
(can't gate deletions on a surface that lies) in favor of a uniform 14-day
expiry gate. Denise 30-sec check for the record: open #16987 in admin —
gateway used, any banner (Test/Review) on the order page.
| 8 | Webhook e2e on a real test order; attribution; admin order view against dynamic products |
| 9–10 | Full e2e on **both products** (onesie sweep discipline); buffer; phase checklist |

**Parallel track (BLOCKER-2 constraint #6): desktop shaping** — Denise + strategy
partner, runs alongside days 1–10, zero file collision with server work. Output
deadline: before the mobile build starts. Denise's wishlist is accumulating there.
### Phase 5: Fulfillment Backend (~2-3 weeks)

> **DEFINITION OF DONE (Denise, 2026-07-15): the final deliverable is ONE USABLE
> PRINTABLE SVG PER DESIGNED SIDE.**
>
> That is the acceptance criterion for this phase — not "print files exist", not
> "the folder structure matches ImprintNext". One SVG per designed side, and the
> print shop can actually print from it. Everything below serves that outcome; if
> a task doesn't move toward it, it isn't Phase 5 work.

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

## Sequencing after Phase 3 (decided 2026-07-15)

**1. Mobile DISCOVERY (~1-2 days, scoping only — not the build).**
**2. Phase 4 execution** (cart architecture; owns BLOCKER-1 and BLOCKER-3).
**3. Then decide mobile-BUILD vs Phase 5 order with real numbers.**

Reasoning, recorded so it isn't re-litigated:

- Mobile is the **calendar's biggest unknown** (BLOCKER-2 is phase-sized and
  unscoped). Discovery converts it into a number **cheaply** — before the number
  is needed for planning, not after.
- **Phase 4's plumbing is desktop-agnostic** — dynamic per-design products,
  cart-add, server-mediated `design_orders` access. Mobile findings don't change
  it, so it can proceed either way.
- **Phase 5 should NOT build against designer surfaces that mobile findings might
  move.** Print-file generation and the admin fulfilment view depend on designer
  output; sequencing mobile discovery ahead of them keeps Phase 5 from being built
  twice.

## Total Estimate

8-10 weeks of focused build work, calendar.

> **BLOCKER-2 (Designer on Mobile) is now scoped at ~2–2.5 weeks** (discovery
> completed 2026-07-16; see the blocker entry for the inventory, approved shape,
> and named constraints). Add it to the 8–10 week figure — it slots AFTER Phase 4
> per "Sequencing after Phase 3".

## Deferred (V1.1)

- Item 22: Cart-add idempotency for retry safety
- Item 23: Customer name email-fallback handling
- Item 24: Volume discount reintroduction (Shopify automatic discounts)

## Notes on Today's Work

Today's commit (Print Charge as separate line items + volume discount removal) represented an architectural direction we walked back from. The dynamic product approach is the architectural successor. That commit's code may need to be partially rolled back or evolved during Phase 4 — leaving in place for now since it doesn't actively break anything (and ImprintNext is still our live system).
