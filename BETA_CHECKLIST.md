# Beta Checklist — must be done before beta testing

Denise's running list of pre-beta requirements. Started 2026-08-06; add items as
they come up, check them off as they ship. CC: treat every unchecked item here
as launch-scope unless Denise says otherwise — several already exist in the
CLAUDE.md backlog; this file is the "these are NOT optional" promotion of them.

## Designer (customer-facing)

- [ ] **1. Align icons match Illustrator's.** Replace the current align icons on
  the design canvas with the standard Illustrator-style glyphs (align left /
  center / right / justify-distribute). Denise has a clipart reference uploaded
  and can provide more detail. *(Already logged as the "universal icon set"
  backlog item — this promotes it to pre-beta.)*
- [ ] **2. Text line spacing + character spacing controls.** Add line-spacing
  and character-spacing (letter-spacing) adjustments for text, including
  character spacing on curved text. *(New item — not previously logged.)*
- [ ] **3. Curve goes to 360°.** Expand the curve/arc range to a full
  −360°…360°. *(Already logged in backlog — promoted to pre-beta.)*
- [ ] **4. Upload panel rearrange.** Move the edit-image tools ABOVE the
  uploaded-image area, and put the uploaded images themselves in a scrolling
  strip/list. *(Rides with the previously mentioned Upload-panel rebuild.)*

- [ ] **10. Embroidery-look preview.** In embroidery mode, added text (and
  ideally embroidery clipart) should render with a thread/stitch look so the
  customer sees "this will be stitched," not a flat print preview. *(Named in
  the long-term embroidery notes as the PREVIEW half; deliberately excluded
  from the current embroidery designer-mode build — needs its own scoping.
  Denise wants it for beta.)*
- [ ] **11. Product picker: ordering + product photos.** The garment picker
  (Products rail / "Use on another product") should list products in an order
  Denise controls, and show each product's photo — the current text-only list
  is sterile. *(New item. Likely shape: a sort_order on product templates set
  in admin, and each product's featured image from Shopify shown in the
  picker. CC to confirm approach.)*

- [ ] **12. Text panel cleanup.** The Text "sheet" is clunky — icons, buttons,
  and their order need a tidy-up pass. *(New item; overlaps item 1's
  Illustrator-style icon work — do them together.)*
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
- [ ] **14. Volume pricing discount on the Order Page.** A quantity-based
  discount (e.g. lower per-item price at higher counts). *(New item, Denise
  2026-08-06. 🚨 CC NOTE: the OLD volume discount was REMOVED because it was
  UI-only math Shopify never honored at checkout — do NOT rebuild it that way.
  Use Shopify AUTOMATIC discounts, admin → Discounts → Automatic, keyed off cart
  quantity — see the "Volume discount removed" note in CLAUDE.md. Exact tiers/
  percentages are Denise's to set.)*

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
- [ ] **8. Font management in admin.** Add fonts AND font categories through
  the admin — the full "admin owns all fonts" setup that still needs to be
  built. *(Already scoped as the Font Management sub-project, ~4–7 dev-days —
  promoted to pre-beta.)*
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
