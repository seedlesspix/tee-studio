# Beta Checklist — must be done before beta testing

Denise's running list of pre-beta requirements. Started 2026-08-06; add items as
they come up, check them off as they ship. CC: treat every unchecked item here
as launch-scope unless Denise says otherwise — several already exist in the
CLAUDE.md backlog; this file is the "these are NOT optional" promotion of them.

## Designer (customer-facing)

- [ ] **1. Align icons match Illustrator's.** 🟡 2nd pass shipped 2026-08-08 (per
  Denise's reference). TWO distinct sets now: the **object-align cluster** (toolbar +
  mobile) uses the Illustrator **Align-panel glyphs** (boxes-vs-guide:
  AlignStart/Center/EndVertical + …Horizontal), and the **Text sheet's paragraph
  align** keeps line-glyphs and **gained justify** (left/center/right/justify,
  desktop + mobile). **Awaiting Denise:** verify the object-align glyphs match the
  reference closely enough (else swap to pixel-exact custom SVGs). *(Universal-icon-set
  backlog item.)*
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

- [ ] **12. Text panel cleanup.** 🟡 2nd pass shipped 2026-08-08. Merged Align +
  Effects into one **Format** toolbar; cleaned ad-hoc glyphs; **Text Color moved to
  the BOTTOM** so all text options sit above it (per Denise); and the **font picker
  gained a category DROPDOWN** ("All" default) that filters the list. **Awaiting
  Denise:** verify the new order + picker feel right. *(Overlaps item 1.)*
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

- [x] **5. Product images slow to appear in cart.** ✅ Fixed 2026-08-08 — the
  app now waits for Shopify to finish processing the design preview before
  handing off to the cart (capped poll, proceeds anyway if slow). Verified by
  Denise during the decal-capture cart testing. Original text follows.
  After adding to cart, the
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

## Round 2 (Denise, 2026-08-08)

- [ ] **15. "Silk screen" → "print" in admin.** Remove the words "silk screen"
  anywhere they appear in the admin; replace with "print." *(Same family as the
  screen_print rename — display only, the stored key must not change. Language
  editor should own this wording once built.)*
- [ ] **16. "Blank shirt" → "blank product" on the order page.** Sometimes it's
  a hat. *(Wording — language editor material.)*
- [ ] **17. Onesie quantity boxes misaligned on the order page.** The size
  boxes don't line up when a onesie is selected — probably the longer size
  labels (3-6mo etc.). Layout fix.
- [ ] **18. Reorder admin tabs.** Order: Orders / Pricing / Templates /
  Clipart / Fonts / Colors.
- [ ] **19. Customizable error/notification text + look.** E.g. the "Clear all
  design elements" notification — Denise wants control over the wording and
  appearance. *(Wording half = language editor; the "look" half is a small
  design pass on the notification component.)*
- [ ] **20. Selection-box handles: fewer, clearer.** The handles on the canvas
  select box need to be fewer and clearer — better icons, placed differently.
  *(Designer UX pass; relates to the universal-icons work.)*
- [ ] **21. Mobile layout clarity.** Options on mobile need to be clearer —
  possibly a different color scheme. *(Needs a look-and-feel pass with Denise's
  eyes on specifics.)*
- [ ] **22. "Decal #" → "Design #".** Rename the label in the clipart/Art
  admin (and anywhere customer- or admin-facing). *(Label only — the stored
  decal_number key and capture stay as-is.)*
- [ ] **23. Admin users & permissions.** How do we add users to the admin,
  ideally with permission levels? *(Real feature — today access = ADMIN_EMAILS
  env var + a per-user database flag, no UI and no roles. Needs scoping: add
  UI for inviting/removing admins, and decide whether one admin level is
  enough for beta or roles are needed.)*
- [ ] **24. Template/product categories (Unisex / Women's / Kid's / Baby's /
  Accessories).** Categorize product templates so the product picker can
  advise better — e.g. currently on a Unisex tee → Unisex options listed
  first. *(Also useful ground-truth for Design Portability's within-category
  re-fit logic. Needs a small data model + admin field + picker ordering.)*

- [ ] **25. Top bar: button order + save-vs-login clarity.** (a) Rearrange the
  top-bar buttons to: Log in / Save Design / My Designs. (b) In the first CTA
  box customers see, add a note to the effect of "want to save your design for
  another time? Be sure to log in to your account" — differentiating saving in
  this session vs. having it later. Exact wording via the language editor
  (default + editable). *(Denise 2026-08-09.)*

- [ ] **26. "Copy to back" / "Copy to front" appear as soon as there's content
  to copy.** "Copy to back" shows the moment something is placed on the front;
  "Copy to front" shows the moment something is placed on the back. (Not
  gated on anything later than that.) *(Denise 2026-08-09.)*

- [ ] **25. Top-bar order + guest save/login note.** ✅ Shipped 2026-08-09
  (awaiting Denise verify). (a) Top-bar buttons reordered to **Log in / Save Design
  / My Designs** (desktop + mobile menu). (b) The blank-shirt CTA box shows a
  **guest tip** distinguishing this-session work from a design saved to your
  account ("Designing as a guest… Log in to save it…"), hidden once logged in;
  wording editable in Admin → Language (`designer.empty.login_tip`).
- [ ] **26. Copy to Back / Front on any content.** ✅ Shipped 2026-08-09 (awaiting
  Denise verify). "Copy to Back" now appears the moment the FRONT has content, and
  "Copy to Front" the moment the BACK does — both driven by LIVE content (was
  reading a per-side ref that only refreshed on a side-switch, so the button
  lagged). The copy action also freshens from the live canvas first, so it always
  includes content just placed.

## How to use this file

- Denise adds items here (or tells Claude/CC to add them) as she notices them.
- Check off with an x — `[x]` — when shipped AND verified by Denise on
  create.tshirtdeli.com, not merely when committed.
- If an item grows into a real project, link its scope but keep the line here
  until it ships.
