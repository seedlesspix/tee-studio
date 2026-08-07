// @ts-nocheck
// ────────────────────────────────────────────────────────────────────────────────────────────────
// Volume Tier Discount — Shopify product-discount Function (target: purchase.product-discount.run)
//
// THIS FILE IS NOT PART OF THE NEXT.JS APP. It is the source for a Shopify Function extension that
// Denise deploys with the Shopify CLI (see DEPLOY.md in this folder). The app already does its half:
// at add-to-cart it stamps each design product with a `volume.tiers` metafield (JSON) copied from that
// garment's product_templates.volume_tiers. This function reads that metafield AT CHECKOUT and takes the
// % off — so the discount is real and re-tiers correctly when the customer edits quantities in the cart
// (the whole reason we use a Function instead of folding the price at add-time).
//
// The math is identical to app/lib/volumeTiers.ts `currentTier`: sum the design product's quantity
// across its size variants, then apply the highest tier whose minQty is met. Per-product: each design
// product carries its own ladder, so a tee and a onesie in the same cart tier independently.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {import("../generated/api").RunInput} RunInput
 * @typedef {import("../generated/api").FunctionRunResult} FunctionRunResult
 */

const NO_DISCOUNT = /** @type {FunctionRunResult} */ ({
  discountApplicationStrategy: "FIRST",
  discounts: [],
});

/**
 * @param {RunInput} input
 * @returns {FunctionRunResult}
 */
export function run(input) {
  const lines = (input.cart && input.cart.lines) || [];

  // Group cart lines by the owning PRODUCT (a design product has one line per size). Per product we
  // accumulate: its tier ladder, the total quantity across sizes, and the variant ids to target.
  /** @type {Map<string, { tiers: Array<{minQty:number,pct:number}>, qty: number, variantIds: Set<string> }>} */
  const byProduct = new Map();

  for (const line of lines) {
    const m = line.merchandise;
    if (!m || m.__typename !== "ProductVariant" || !m.product) continue;

    const raw = m.product.volumeTiers && m.product.volumeTiers.value;
    if (!raw) continue; // no ladder on this product → not a volume-discounted item

    let tiers;
    try {
      tiers = JSON.parse(raw);
    } catch (_e) {
      continue;
    }
    if (!Array.isArray(tiers) || tiers.length === 0) continue;

    let entry = byProduct.get(m.product.id);
    if (!entry) {
      entry = { tiers, qty: 0, variantIds: new Set() };
      byProduct.set(m.product.id, entry);
    }
    entry.qty += line.quantity;
    entry.variantIds.add(m.id);
  }

  const discounts = [];
  for (const { tiers, qty, variantIds } of byProduct.values()) {
    // Highest tier whose minQty is met (same rule as the designer's currentTier).
    let pct = 0;
    for (const t of tiers) {
      const minQty = Number(t.minQty);
      const p = Number(t.pct);
      if (Number.isFinite(minQty) && Number.isFinite(p) && qty >= minQty && p > pct) pct = p;
    }
    if (pct <= 0) continue;

    discounts.push({
      message: `Volume discount: ${pct}% off (${qty}+)`,
      targets: [...variantIds].map((id) => ({ productVariant: { id } })),
      value: { percentage: { value: pct.toFixed(1) } },
    });
  }

  if (discounts.length === 0) return NO_DISCOUNT;

  // FIRST: each design product is discounted once by its own best tier. There is no overlap between
  // products (targets are that product's variants), so FIRST vs MAXIMUM is moot here — FIRST is the
  // safe default that won't stack with itself.
  return /** @type {FunctionRunResult} */ ({
    discountApplicationStrategy: "FIRST",
    discounts,
  });
}
