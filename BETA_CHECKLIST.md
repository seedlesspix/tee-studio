# Beta Checklist — must be done before beta testing

Denise's running list of pre-beta requirements. Started 2026-08-06; add items as
they come up, check them off as they ship. CC: treat every unchecked item here
as launch-scope unless Denise says otherwise — several already exist in the
CLAUDE.md backlog; this file is the "these are NOT optional" promotion of them.

## Designer (customer-facing)

- [ ] **1. Align icons match Illustrator's.** 🟡 FIRST PASS shipped 2026-08-08.
  Swapped the hand-rolled align SVGs for the shared **Lucide AlignLeft/Center/Right**
  glyphs (the standard Illustrator paragraph-align vocabulary), desktop + mobile.
  **Awaiting Denise:** share the clipart reference to fine-tune the exact glyph look
  if Lucide's aren't the intended set, and confirm whether to ADD a **justify**
  option (the app currently offers left/center/right only). *(Universal-icon-set
  backlog item, promoted to pre-beta.)*
- [x] **2. Text line spacing + character spacing controls.** ✅ Shipped
  2026-08-07. Added a **Line Spacing** slider (multi-line text; hidden on curved),
  and **Letter Spacing now works on curved text** too (it was disabled before).
  reWrapText now honors the chosen line height so tall line spacing can't push
  text out of the print box. *(Desktop panel; mobile letter/line-spacing sliders
  are a small parity follow-up — mobile never had letter spacing.)*
- [x] **3. Curve goes to 360°.** ✅ Shipped 2026-08-07. The curve is now
  **degree-based** — the slider value IS the arc angle, −360°…360° (±360 = a full
  circle). Rewrote the arc renderer to frame any angle (shallow cap → full ring)
  and kept the D2 re-fit / resize-rebake in sync (angle is scale-invariant).
  ⚠ Semantics change: a curved design saved under the OLD model reopens with its
  number now read as degrees, so its curl may look gentler — flag if any real
  saved curved designs exist (likely only test ones pre-beta).
- [ ] **4. Upload panel rearrange.** Move the edit-image tools ABOVE the
  uploaded-image area, and put the uploaded images themselves in a scrolling
  strip/list. *(Rides with the previously mentioned Upload-panel rebuild.)*

- [ ] **10. Embroidery-look preview.** In embroidery mode, added text (and
  ideally embroidery clipart) should render with a thread/stitch look so the
  customer sees "this will be stitched," not a flat print preview. *(Named in
  the long-term embroidery notes as the PREVIEW half; deliberately excluded
  from the current embroidery designer-mode build — needs its own scoping.
  Denise wants it for beta.)*
- [x] **11. Product picker: ordering + product photos.** ✅ Shipped 2026-08-07
  (photo source corrected same day). The picker shows each product's real garment
  **mockup** — the Shopify featured image, fetched in ONE batched Storefront call
  (`getFeaturedImages`), object-contain on a white tile so the whole garment
  shows; hex-square fallback while it loads. (First cut used the color swatches,
  which looked like little chips — fixed.) Order is admin-controlled via ▲▼
  reorder in /admin/templates (writes product_templates.sort_order, which the
  picker sorts by).

- [ ] **12. Text panel cleanup.** 🟡 FIRST PASS shipped 2026-08-08. Merged the
  separate "Text Align" + "Effects" blocks into one consistent **Format** toolbar
  (Bold / Italic / UPPERCASE + align, one button treatment, titled), and cleaned
  the ad-hoc glyphs (Direction —/↕ → icons; upload ⬆ → Upload icon). Kept the
  overall control order. **Awaiting Denise:** what specifically feels clunky about
  the ORDER (so the deeper reorder matches her intent, not a guess). *(Overlaps
  item 1's icon work — shipped together.)*
- [x] **13. Designs vs. Clipart split + decal numbers on orders.** ✅ Done
  2026-08-10 as the unified Art Library (per-art method toggles, Decal # on
  every art, multi-category labels, search by Decal #, automatic capture in
  "Decals Used" on orders). Verified by Denise. Part 3 (units-per-decal report)
  still joins Admin Reporting later. The designer
  needs a separate "Designs" section (pre-made decal artwork) distinct from
  generic clipart. Each Design carries a decal number, and the decal numbers
  used must show up on the order. *(Already scoped as the "Decal Designs"
  project, Parts 1–2. 🚨 Project notes flag the capture piece as
  must-land-BEFORE-launch-volume: every order placed without decal capture is
  sell-through data lost forever. Promoted to pre-beta.)*

## Cart / storefront

- [ ] **5. Product images slow to appear in cart.** After adding to cart, the
  product image usually needs a page refresh to show up. Should appear
  immediately. *(New item — needs diagnosis: likely image generation/upload
  timing vs. cart page caching.)*
- [x] **14. Volume pricing discount on the Order Page.** ✅ Shipped 2026-08-08,
  full path confirmed at checkout (applies + re-tiers on quantity edits), enabled ON.
  Landed as **PER-PRODUCT, per-METHOD** tiers (not a flat cart-wide ladder): each
  garment carries its own ladder in `product_templates.volume_tiers` (+ an optional
  `volume_tiers_embroidery` override for dual-method products, since embroidery
  amortizes differently), set in Admin → Product Templates. Enforced at checkout by
  a Shopify **discount Function** (`shopify/volume-discount-function/`, unified
  2026-07 API) reading a `volume.tiers` metafield the app stamps per design at
  add-to-cart — resolved by method so what the Order-Page ladder shows equals what
  checkout charges. Off switches stay independent: `VOLUME_DISCOUNT.enabled` hides
  the ladder; Admin → Discounts deactivates the charge.

## Admin

- [x] **6. Delete order files/rows in admin.** ✅ Shipped 2026-08-07. A red
  **🗑 Delete** button on the order detail header removes the whole order group
  (all its designs); a confirm spells out that it's permanent AND that any
  customer "My Designs" saved entry is removed too (the saved_designs ON DELETE
  CASCADE). Drafts especially can be cleared. Admin-authorized via the
  design_orders_admin_all RLS policy.
- [x] **7. Order files named with order number + customer name.** ✅ Shipped
  2026-08-07. Cut files, the production-bundle zip/folder, and the admin
  PNG/SVG downloads are now named `<orderNumber>-<LastName>` (e.g. "1042-Smith")
  via a shared, tested `app/lib/orderFiles.ts` helper. Falls back to the order
  number alone (no name), or a short id for drafts with no order number yet.
- [x] **8. Font management in admin.** ✅ Shipped 2026-08-07 (Phase A+B),
  verified by Denise (upload → designer → cut file all working). `designer_fonts`
  is the single source of truth: admin **uploads** font files (→ fonts bucket +
  DB), assigns a **category**, and the designer serves them at runtime; the 58
  bundled fonts were migrated name-byte-stable and the hardcoded declarations
  retired. The customer **font picker** is now grouped-by-category + searchable +
  current-font-obvious (2026-08-08). *(Was scoped ~4–7 dev-days.)*
- [ ] **9. Language editor in admin.** A "Language" section in admin so
  customer-facing wording in the design tool can be re-worded without code
  changes (folds in the "Screen Print" → "Print" rename so it can't regress).
  *(Already logged — promoted to pre-beta.)*

## How to use this file

- Denise adds items here (or tells Claude/CC to add them) as she notices them.
- Check off with an x — `[x]` — when shipped AND verified by Denise on
  create.tshirtdeli.com, not merely when committed.
- If an item grows into a real project, link its scope but keep the line here
  until it ships.
