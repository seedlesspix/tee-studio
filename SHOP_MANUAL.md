# PrepStation Shop Manual

How to use the design tool admin — the operational rules, specs, and habits.
For Denise and employees. Living document: add to it whenever a question gets
answered that someone will ask again. (This is the INTERNAL manual; the
customer-facing "/how-it-works" page is a separate, still-parked feature.)

Last updated: 2026-10-17

---

## Art Library (designs & clipart)

**File formats & sizes:**
- **SVG preferred wherever possible** — crisp at any size, tiny file,
  recolorable by customers.
- **PNG/JPG (can't-change-color art): ~1024px on the longest side.** That's
  screen-crisp at full print-area size; bigger buys nothing, smaller risks
  blur. (The old 250×250 rule was ImprintNext's — retired.)
- Library files are for SCREENS ONLY. Production prints from the ORIGINAL in
  the decal folder, found by Decal/Design # — never from the library upload.

**SVG file prep — do it right ONCE (cut files today, per-color recoloring later):**
Both the cut-file engine and the planned "recolor each color separately" feature
read the SVG's own shapes and their fill colors, so the file has to say exactly
what it means. Prepare every SVG like this before uploading:

1. **Flat, solid fills only.** No gradients, patterns, transparency/opacity,
   blend modes, drop shadows, glows or other effects. Illustrator: Object →
   Expand Appearance, then Object → Flatten Transparency.
2. **Every shape carries its OWN fill color.** Put the fill on the shapes
   themselves, never only on a group or layer, and never through CSS classes.
   The cut engine reads the fill on the shape only — a fill set on the group,
   or in a `<style>` block, makes the shape cut as BLACK.
3. **One exact color value per logical color group, nothing in between.** All
   shapes that should recolor together must share the identical hex (#ED1F24
   everywhere, not #ED1F24 on some and #EC2025 on others). Each distinct value
   becomes one color slot = one picker for the customer and one cut layer for
   the bench; near-duplicate shades become phantom slots. Pick ONE black for the
   whole library (use #000000; Illustrator's "rich black" #231F20 counts as a
   different color). Check: Select → Same → Fill Color should grab exactly the
   group you expect, and nothing else.
4. **Keep the color count small.** One to three colors is typical. Every extra
   color is another decision for the customer and another layer to weed.
5. **No strokes — outline them.** The cut engine cuts fills only; a stroke is
   invisible to it, and lines/polylines don't cut at all. Object → Path →
   Outline Stroke, then set stroke to none.
6. **Text converted to outlines.** Type → Create Outlines. Live text isn't cut
   and shows in whatever font the customer's browser happens to have.
7. **Holes must be real holes.** Object → Compound Path → Make (or Pathfinder
   Minus Front). A white shape laid on top of a dark one is NOT a hole — it
   prints as white ink and cuts as a white vinyl layer. Use white only when
   white is genuinely a print color.
8. **Leave the fill rule on Nonzero (Illustrator's default).** Don't switch a
   path to Even-Odd to make holes; the cut engine unites each color with
   nonzero winding and an even-odd hole can fill in solid.
9. **No clipping masks, no embedded or linked images, no symbols, no filters.**
   Release masks (Object → Clipping Mask → Release) and DELETE the parts that
   were hidden — the engine cuts everything inside a mask, hidden or not. An
   embedded image isn't vector and can't recolor or cut.
10. **Artboard tight to the art, nothing invisible left behind.** Object →
    Artboards → Fit to Artwork Bounds. Delete hidden or empty objects, stray
    points and invisible background rectangles — they skew where the design
    centers and how big it lands on the shirt.
11. **Overlaps within one color are fine** (the engine unites them). Shapes of
    DIFFERENT colors that overlap print and cut as stacked layers — do that only
    on purpose.
12. **Nice to have, for later labels:** put each color group on its own layer
    named for what it is ("Text", "Stars", "Outline") and export with Object
    IDs = Layer Names. The future picker can then label each color slot with
    that name instead of "Color 1 / Color 2".
13. **Export settings (Illustrator, File → Export → Export As → SVG):**
    Styling = Presentation Attributes · Font = Convert to Outlines · Images =
    don't embed (there shouldn't be any) · Object IDs = Layer Names · Decimal =
    2 · Minify off · Responsive either way (the viewBox is what matters). If you
    use Save As → SVG instead: CSS Properties = Presentation Attributes, and
    leave "Preserve Illustrator Editing Capabilities" UNTICKED (it bloats the
    file with non-SVG data).
14. **Ten-second self-check before upload:** open the .svg in a text editor.
    You want `fill="#......"` on the shapes, and NO `<style>`, `class=`,
    `<text>`, `<image>`, `<linearGradient>`, `<mask>`, `<clipPath>`, and no
    `stroke=` other than `none`.

Where the library stood on 2026-10-17 (scan of all 390 SVGs): 357 one-color,
32 with no fill written (reads as black — fine, but write it from now on),
1 two-color (T4025, red + rich black), 1 with live text (Sledding), 1 with a
stroke, 0 gradients / images / CSS classes. In good shape; the rules above keep
it that way.

**Finding art in the admin:** each category has a search box (name, tag, or
Design #, the same matching customers get) and a Sort menu: Newest first (the
default — a fresh upload batch lands at the top), Oldest first, Name A–Z, or
Design #. Your sort choice sticks on that computer.

**Categories (the left-hand list in the Art Library):**
- **Rename** with the ✎ pencil. It is live for customers the moment you press
  Enter — no publish step. Design numbers, links and orders are untouched.
- **Add** with "+ New"; it goes to the bottom of the order.
- **Order** with ⤒ ▲ ▼ ⤓. Customers see categories in this order.
- **Turn off** with ●. Off means GONE for customers: the category disappears,
  and any art that lives ONLY in that category disappears from browsing and
  search too. Nothing is deleted — the admin still shows it all (dimmed, marked
  "off") so you can move it or turn it back on. The confirm tells you how many
  pieces have no other home before you do it.
- **Delete** (🗑) only works on an empty category. If it still has art, turn it
  off instead, or move the art first.

**Design numbers (T-numbers):**
- Only SHOP-MADE designs get numbers. Generic clipart stays unnumbered.
- The number is the identity everywhere: sell-through tracking on orders,
  deep links from the website (T2491 = design 2491), the bench's decal folder.
- Numbers must be unique — the admin refuses duplicates.
- A design needs its number BEFORE its "Put it on something" button goes live
  on the website.

**"Light artwork — show on a dark garment" checkbox:**
- Tick it on white/light designs. Deep links then land them on the garment's
  darkest color (usually Black) so the design is visible; the future catalog
  renderer uses the same flag. Judgment call — your eye beats any threshold.

**Methods & categories per art item:** Print/Embroidery toggles (new art
defaults to Print-only; embroidery is a deliberate opt-in — it must be
stitch-appropriate). One art can live in multiple categories (checklist).

## Mockups & product images

**Filename convention (the batch uploader's language):**
`STYLENUMBER_Color_Position.png` — e.g. `3001_Columbia_Blue_LeftSleeve.png`
- Positions: Front · Back · LeftSleeve · RightSleeve · HatBack
- ⚠️ A cap's back is **HatBack**, never "Back" (Back = a shirt's back).
- Multi-word colors: either spelling works (Columbia_Blue / ColumbiaBlue);
  capitalization doesn't matter. Color must match the Shopify color name.
- Overlays (e.g. hoodie drawstrings rendered OVER the art): same name +
  `_Overlay` — must be the SAME FRAME as the base mockup (export from the
  same working file, layers toggled). Base must exist before its overlay.

**Rules the system enforces:**
- Mockups under 500px are rejected (that's a swatch, not a mockup).
- A ⚠ frame badge means the print box was drawn on a differently-shaped
  image — re-draw the box on the current mockup.
- "Import Front/Back from Shopify" fills EMPTY cells only; "Re-import
  (overwrite)" refreshes Shopify-sourced cells and warns before touching
  hand-uploads. Sleeve/hat mockups are never touched by either.

**The architecture to remember:** the template admin owns ALL designer
mockups. Shopify product pages only need marketing photos (fronts).

## Product Templates

**The template is the control panel for everything designable.** Shopify owns:
products, photos, variants, money. Templates own: print areas, methods,
mockups, colors/hexes, tiers, style numbers.

**Style numbers:** every active template needs one, unique (EmergenTees use
-ET suffixes). They're the mockup filename token AND the deep-link garment
vocabulary (`&garment=3001`).

**Picker order (▲▼ on the Templates list) is load-bearing twice:** it's the
product picker's display order AND position #1 is the DEFAULT GARMENT for
every deep link that doesn't specify one.

**Color order per template is load-bearing too:** the FIRST color is what a
deep-linked garment lands on. (Never Shopify's variant order — that was an
accident we retired.) Every color needs its hex filled in — hexes drive the
swatches, the print-shop capture, and the "darkest color" pick for light
artwork.

**Colors sync LIVE with Shopify, both directions:** add a color in Shopify →
it appears; remove it → it leaves. To RETIRE a color: delete the color/variants
from the product in Shopify (zero inventory does NOT hide it — we never show
out-of-stock; we carry it or we don't). Then clear the ⚠ badged leftovers in
the template at leisure.

**Retiring a product:** unpublish/delete in Shopify → the template list shows
"⚠ unavailable in Shopify" and the designer/picker stop offering it. Turn the
template off too for tidiness.

**Print areas:** drawn per zone per method on the mockup; inches come from a
TAPE MEASURE on the real garment — they drive pricing display, low-res
warnings, and cut files. Embroidery-only-on-chest garments: give the template
an embroidery Front area (chest-size) and NO embroidery back area — the Back
zone disappears in embroidery mode automatically.

**Hat backs:** draw the text arc on the mockup (endpoints + bulge). Text
auto-curves along it, fixed letter height, text-only zone.

## Pricing & discounts

- Print charges are flat per side/zone regardless of garment (deliberate).
- Embroidery is a per-method charge (e.g. +$22); dual-method products can have
  separate embroidery volume tiers.
- Volume tiers are set per template; they show on the Order page and are
  ENFORCED by the Shopify Function at checkout — same math, can't drift.
- 🚨 If you ever turn the Shopify automatic discount OFF, the order-page
  ladder display must be turned off too (one flag — ask CC), or the page
  promises a discount checkout won't give.

## Orders admin

**Housekeeping that runs by itself (every morning):** abandoned Drafts older
than 7 days are cleared; abandoned In Cart / Ordering rows are cleared only
once they're over 15 days old AND their checkout product is gone from Shopify,
so a customer who checks out late is never stranded. Anything backing a saved
design ("My Designs") is never touched by either job. Paid orders are never
deleted by anything.

**Cancelled orders:** when an order is cancelled in Shopify, it shows as
**Cancelled** here (red pill, its own filter tab) with the date and reason.
Nothing is removed — the customer details, the design and the artwork stay,
because refunds and reprints may still need them. Nothing to set up: the app
registered the "order cancelled" notification with Shopify itself on
2026-10-20, next to the "order paid" one. (Shopify's Settings → Notifications
→ Webhooks page will always look EMPTY — it only lists hand-made webhooks,
not the app's. That's normal.)

- **The 🚨 red warning on delete means STOP:** that draft backs a customer's
  SAVED design — deleting destroys their saved work, silently, forever.
  Plain confirm = safe to delete.
- Production Bundle is the one download — the complete layered package
  (Print + Contour + Vinyl layers where applicable, OrderInfo.txt with
  roster/decals/DPI flags/schedule).
- "Desired by" dates sort the queue; "✓ Design acknowledged" + timestamp is
  the customer's proof-of-review receipt.
- Reprints are promised indefinitely → order artwork is NEVER deleted from
  storage.

## Language editor

Every customer-visible string (~315) is editable in Admin → Language, grouped
by area, with per-string reset-to-default. Error messages use {placeholders}
that fill in automatically. If a tester finds wording confusing, the fix is an
admin edit, not a code request. The app's name itself (PREPSTATION) is a
language string.

## Admins

Admin → Admins: add/remove by email (they log in with an emailed code).
Only the OWNER (Denise) sees this screen. Everyone added has full access to
everything else — invite at trust-them-with-the-shop level.

## Deep links (website → designer)

`create.tshirtdeli.com/designer?design=T2491` — opens the designer with that
design placed, garment picker open. `&garment=3001` preselects (and skips the
picker); `&color=Black` overrides landing color. Unknown design = designer
opens normally, no error. The design must have its T-number assigned or the
link can't resolve it.

## Standing habits

- Hard-refresh (Cmd+Shift+R) before reporting a bug — stale browsers have
  cried wolf many times.
- When something breaks: exact error text, which product/color, what you were
  doing. Screenshots are gold.
- Database changes are always shown in plain language for approval first —
  no exceptions, no matter how small.
- If a fix doesn't land after two tries: revert first, demand the real
  production log, verify what's actually deployed.
