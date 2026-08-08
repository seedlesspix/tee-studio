# Volume Tier Discount — deploy guide

This turns on the **real** per-product volume discount at checkout. The website already does its half
(it stamps each design with its garment's tier ladder); this guide deploys the small Shopify "Function"
that reads those tiers and takes the % off in the cart/checkout.

> **Heads-up (be honest with yourself about this part):** unlike everything else in the app, this step
> uses the **Shopify command line (CLI)** and a **Shopify app** — it's genuinely developer territory. It's
> a one-time setup (~30–45 min for someone comfortable with a terminal). If that's not you, this is the
> right moment to hand these files to a developer, or do it together on a screen-share. Nothing here
> touches the live store until the very last steps, and the website keeps working with the discount simply
> **off** until then.

---

## What already exists (no action needed)

- The app writes a `volume.tiers` metafield (JSON like `[{"minQty":6,"pct":10},…]`) onto each design
  product when it's added to cart, copied from that garment's tiers in **Admin → Product Templates**.
  On a **dual-method** product (e.g. Dad Hats) the app resolves Print vs. Embroidery tiers *before*
  stamping, so the metafield always holds the final ladder — **the Function stays method-agnostic and
  this guide's steps are unchanged either way.**
- The Order Page shows the ladder + "add N more to save" nudge — but it stays **hidden** until you flip
  one switch (last step), so customers never see a discount before checkout actually applies it.
- Set each garment's tiers now in **Admin → Product Templates → Edit → Volume discount tiers** (e.g.
  `6 → 10%`, `12 → 15%`, `24 → 20%`). Leave empty for garments with no volume discount.

## What this deploys

- `run.graphql` — the data the function reads (each cart line's quantity + its product's `volume.tiers`).
- `run.js` — the logic (sum a design's quantity across sizes, apply the highest tier met). This is the
  file you paste into the generated extension.

---

## Prerequisites

1. **Node.js 18+** installed.
2. **Shopify CLI**: `npm install -g @shopify/cli @shopify/theme`
3. Access to the Shopify store as **staff with app-development permission** (or a Shopify **Partner**
   account with the store connected). You'll log in when the CLI prompts.

---

## Step 1 — Create a Shopify app (once)

In a terminal, in a folder OUTSIDE this website's code (the app is its own project):

```bash
shopify app init
# • Choose "Build a Shopify app" → template: "none"/"minimal" is fine
# • Name it e.g. "tshirtdeli-discounts"
cd tshirtdeli-discounts
```

## Step 2 — Generate the discount function extension

```bash
shopify app generate extension
# • Type: "Discount"
# • Which function: "Product discount"
# • Language: "JavaScript"
# • Name it: "volume-tier-discount"
```

This creates a folder like `extensions/volume-tier-discount/` with a `src/run.js`, a `src/run.graphql`
(may be named `run.graphql`), a `shopify.extension.toml`, and a `package.json`.

## Step 3 — Drop in the logic

Replace the generated files with the two in this folder:

- Copy **`run.graphql`** (this folder) over the extension's generated input-query file.
- Copy **`run.js`** (this folder) over the extension's generated `src/run.js`.

> If the CLI generated a slightly different **return shape** in its example (e.g. `cartLine` targets
> instead of `productVariant`), match ours to theirs — keep our *logic* (grouping + tier selection), just
> use whatever `targets`/`value` shape the generated example and the generated types use. This is the one
> place versions differ; the generated example is the source of truth for the exact field names.

## Step 4 — Make the metafield readable by the function ⚠️ (the easy-to-miss step)

The function can only read `volume.tiers` if a **metafield definition** exists that grants Functions
access. In **Shopify Admin**:

1. **Settings → Custom data → Products → Add definition**
2. Name: `Volume tiers` · Namespace and key: **`volume.tiers`** · Type: **JSON**
3. Under **Access**, enable access for **Storefronts / Functions** (the option that exposes it to apps &
   functions — wording varies by Shopify version; pick the one that includes **Functions**).
4. Save.

> If a test order shows **no discount** even at a qualifying quantity, 95% of the time it's this step —
> the function read `null` tiers because the definition/access wasn't set. (You don't need to hand-enter
> any value; the app writes the value automatically. The definition just unlocks read access.)

## Step 5 — Deploy

```bash
shopify app deploy
```

Follow the prompts to push the function to the store's app.

## Step 6 — Turn the discount on in Admin

A deployed function does nothing until an **automatic discount** runs it:

1. **Shopify Admin → Discounts → Create discount → Automatic discount**
2. Choose the **"volume-tier-discount"** function (it appears once deployed).
3. Give it a title (customers may see it, e.g. "Volume discount"), set it **Active**, no end date.
4. Save.

## Step 7 — Test the full path (before flipping the display)

1. In the designer, design a garment that has tiers set (e.g. the Cotton Tee).
2. Add **enough** to hit a tier (e.g. 6+), go to checkout.
3. Confirm the **discount line appears** and the total drops by the right %.
4. Edit the quantity **down** below the tier in the cart → discount should **disappear**; back up → it
   returns. (This re-tiering is exactly why we used a function.)
5. Try a **second garment** with different tiers in the same cart → each should discount on its **own**
   quantity, independently.

## Step 8 — Show the Order-Page ladder

Once checkout is confirmed correct, flip the display switch so customers see the incentive:

- In the website code, open **`app/lib/volumeTiers.ts`** and set `enabled: false` → **`true`**.
- Commit/deploy (the usual `git push origin phase5-cut-file:main`).

The Order-Page ladder + "add N more to save" nudge now show for garments that have tiers — matching the
discount that actually applies at checkout.

---

## Rollback / off switch

- **Hide the display:** set `enabled` back to `false` in `volumeTiers.ts` and deploy.
- **Stop discounting:** set the Automatic discount to **inactive** in Admin → Discounts (instant, no code).
- The two are independent — you can hide the ladder while keeping the discount, or vice-versa.
