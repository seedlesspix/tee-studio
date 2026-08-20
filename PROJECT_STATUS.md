# Project Status Snapshot — 2026-08-15

Denise's regroup checkpoint. One page: what's in flight, what awaits her eyes,
what's queued, what's parked. CC: reconcile this against your tracker and
correct anything stale, then keep it updated at major checkpoints.

## 🔴 INCIDENT RESOLVED 2026-08-19 — production bundle 500 on ALL orders

**Real cause: sharp couldn't load on Vercel** (native libvips `.so` not bundled into the lambda —
`ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.3`). It was NEVER the trace logic. Fixed by force-including
sharp's native binary in `next.config.ts` (`outputFileTracingIncludes`, same as the fonts). Bundle
confirmed working, libvips error gone.

**Course-correction on the way there:** the silhouette cut MODEL (multicolor-by-contour) was reverted off
production per Denise (bench first; model gets rebuilt on a branch). Three trace "OOM fixes" before the
revert were chasing a symptom local repros invented — sharp loads fine on macOS, so the prod-only failure
was invisible until Denise supplied the actual Vercel log. **Lesson logged:** get the real prod exception +
verify the live deploy BEFORE shipping a prod fix.

**Live now:** Lens 1 (print-size preview) + Lens 2 preview at the pre-silhouette GARMENT-SPLIT model
(one-color art traces; multicolor → "too many colors"). The silhouette model + its OOM hardening (perimeter
guard + 2400px mask clamp — both real, keep them) are parked for a branch rebuild.

## Follow-ups — Denise 2026-08-20 (verification round)

- ✅ **AA on curved text — the button was DISABLED for curved text** (`disabled={selectedIsCurved}`), so it
  worked once (during create) then greyed on reselect. Now enabled (my bake fix makes caps apply + persist);
  reselect reflects `_curveUppercase` correctly.
- ✅ **Embroidery convert now re-bakes CURVED text too.** The forward (print→embroidery) reconcile only
  restyled plain text (i-text/textbox) — a hat's arc text kept its print font. Extracted the E2 reverse
  re-bake into a shared `recurveCurvedToValidFont(valid, fallback)` and wired it into the forward, so curved
  text whose font isn't an embroidery font is re-baked to the embroidery default (both directions now covered;
  re-locks a hat-back re-bake). Covers the current-view canvas + front/back refs (same as E2). The
  off-canvas EXTRA-zone gap is now a real tracked item ↓, not a footnote.
- ✅ **Hat-back dashed rectangle border dropped** (kept the invisible measured `[data-print-area]` box).
  `CanvasStage` gains `hidePrintAreaBorder`, passed true on the hat_back zone.
- ✅ **Vertical text now SHRINKS instead of shattering into columns.** `reWrapText` vertical mode no longer
  auto-wraps — each paragraph is one column down the box and the font shrinks to fit (intentional Enter still
  makes columns). Same "shrink cleanly" philosophy as horizontal.

## New items — Denise 2026-08-20 (two hat-back items + vertical sleeve text)

- ✅ **DONE — AA (all-caps) now works on curved hat-back text.** Uppercase was deliberately never wired for
  curved text ("case doesn't apply to a single arc"). Now `bakeCurvedArc` takes an `uppercase` param (bakes
  upper-cased glyphs, keeps `_originalText` RAW, stamps `_curveUppercase`); reflected on select, in the curve
  effect's deps, threaded through every re-bake (refit/resize/re-curve/spawn), and persisted via
  CANVAS_CUSTOM_PROPS. Straighten→IText also applies it.
- ✅ **DONE — hat-back is enforced TEXT-ONLY** (v1 decision). `HIDDEN_FOR_HAT_BACK = [upload, clipart, names]`
  hidden from the rail on the hat_back zone (mirrors embroidery hiding); a guard drops to the Text tab if the
  view switches while a hidden tab is active; the blank-zone CTAs show only Add Text (onAddArt now optional in
  CanvasStage). No uploads / Art / N&N can be placed on the back of a hat.
- ✅ **DONE — vertical sleeve text bug** (item 1 below). Root cause: `reWrapText` wrapped to the box WIDTH and
  fit the stack to the box HEIGHT, but a vertical text is the same layout rotated 90° — so a line runs along
  the box HEIGHT and the lines stack across its WIDTH. In a tall-narrow sleeve it wrapped to the NARROW width
  → shattered into many lines → overflowed when rotated. Fix: `reWrapText` gains a `vertical` flag that SWAPS
  the width/height limits; wired into every wrap site (live edit, typing, fitAndConstrain, both refit paths),
  keyed off `textDirection`/`angle===90`. `constrainObject` already clamped the rotated footprint (aCoords).

## New items — Denise 2026-08-19

1. ✅ **DONE — vertical text in sleeve zones** (see the 2026-08-20 note above). `reWrapText` now swaps its
   width/height limits for vertical (90°-rotated) text, so it wraps along the box height and stacks across
   the width instead of shattering in the narrow sleeve box.
2. ✅ **DONE — admin lands on ORDERS after login, not Clip Art.** Changed the two login-redirect defaults
   (`auth/callback` `next`, `admin-login` `from`) `/admin/clipart` → `/admin/orders`.
3. ✅ **DONE — hat-back arc guide auto-hides once text is placed.** `arcGuide` gated on
   `!zoneHasContent('hat_back')` — shows on the empty zone to guide placement, vanishes from the final look.
   No admin toggle (Denise: add one only when a real hat needs it). OPEN Q from Denise: should the rectangle
   print-area box also hide on hat-back? — answered (can auto-hide it the same way; kept for now since it's
   the measured `[data-print-area]` element, would hide the visual only). Do on request.
4. **SCOPE — "PrepStation Manual"** (content feature). A simple, good-looking one-page "how it works" guide
   (add text, uploads, sleeves, saving…). Proposed: a dedicated `/how-it-works` page (shareable/bookmarkable,
   linkable from emails/support) + a "How it works" link in the designer top bar. Content written later
   (Denise + Claude). Scope = the page container + entry link + language-editable copy; not started.
5. **Clipart quality (two related):**
   - (a) ✅ **CLOSED (2026-08-20) — was the STALE deploy.** Re-tested on the fresh deploy: no false warning
     on either PNG or SVG clipart. The `_uploadSrc` guard was correct all along.
   - (b) ✅ **DONE (interim) — enlarged clipart no longer blurry.** SVG clipart now loads via `loadSvgHiRes`
     (fetch → preserve viewBox → set root width/height to ~1500px → data-URL raster), so it stays crisp when
     enlarged. The recolor BlendColor filter is unchanged. **Cut/layout parity preserved:** the object keeps
     the ORIGINAL svg url in `_svgOrigSrc` (in CANVAS_CUSTOM_PROPS), and `generateCutFile`/`generateLayout`
     read it — the engine keys off viewBox and scales by width/viewBox, so the bigger display width is
     invariant (`sImgX = width/vbW`). PROVEN by test: hi-res (w1500) cut == natural (w250) cut, byte-identical.
     **Proper true-vector refactor stays PARKED.** **UPLOAD SPEC shipped into the Art admin's upload hint:**
     SVG preferred + tiny (crisp at any size); PNG/JPG ~1024px longest side (screen crispness only — bench
     prints the decal-folder original; no print res needed). 250×250 rule retired.

## In flight (CC — the agreed work order, nothing else starts)

✅ CLOSED 2026-08-15: the managed-mockup switch is FINAL. The adversarial
review (13 agents / 5 lenses) confirmed 1 latent defect (legacy null-framed
print-area rows escaping the aspect badge — fixed in b520020, preventive, zero
actual drift in the live catalog; a focused re-verification came back sound);
other findings were refuted as pre-existing. The My Designs thumbnail now uses
the managed image too.

⚠️ CORRECTION (CC, 2026-08-15): an earlier edit of this file claimed N1 was
"fixed via User-Agent, imported 6/6." That is NOT accurate — see N1 below. The
server-side fetch is not the problem (verified 200 with and without a
User-Agent); the real cause is a storage-bucket MIME restriction, and the actual
fix is still PENDING Denise's approval. Nothing has imported 6/6 yet.

Current order: finish N1 (approve the bucket change) → N2 static check → rename
(N3+N4, PrepStation everywhere via language editor) → small-UX batch (N5–N8) →
reassess → then Z-hp-2 fresh.

## Awaiting Denise's verification (the accumulated test passes)

1. Managed-mockup switch: flip front/back on 2–3 auto-imported products —
   expect zero visible change (the "boring check").
2. Aspect-mismatch badge drill (optional): upload a differently-shaped Front
   mockup in the admin Mockups grid → red re-draw banner → re-draw → clears →
   restore proper mockup.
3. Stale-color badges: a removed color's swatch shows "⚠ not in Shopify" +
   Remove (used to hide silently).
4. Picker fix: a deleted/unpublished product no longer appears in Change
   Product / "Use on another product."
5. NEW ISSUES from Denise's testing — captured 2026-08-15, triage below.

## New-issue triage (2026-08-15) — work these after the review lands

**Bugs:**
- N1. 🔶 ROOT CAUSE FOUND, real fix PENDING APPROVAL. NOT a User-Agent/CDN
  issue — the server-side fetch works (verified 200 with and without a UA, both
  locally and through production /api/preview). The real cause: the
  `garment-swatches` storage bucket has `allowed_mime_types = ["image/png"]`,
  and Youth Tri-blend's Shopify photos are JPEG, so all 6 uploads were rejected
  → "Imported 0 of 6." Earlier products imported because their photos are PNG.
  ✅ CLOSED (Denise verified 6/6, 2026-08-15). Fix = bucket widened to
  PNG/JPEG/WebP + 5 MB limit (approved + applied) + honest per-file error
  reporting (2f900ec). NOT a User-Agent/CDN issue.
- N2. ✅ FIXED (commit c7e2565). Not a ghost — a real guard hole. The low-res
  warning used exclusion-only logic (skip SVG/vector/curved/N&N) and never
  required the object to be an UPLOAD, so a RASTER clipart/decal (type:image,
  _isSvg:false, no _uploadSrc) slipped through. Added an inclusion guard
  requiring _uploadSrc → uploads only, and selecting a clipart now clears any
  prior warning. Denise: pick a raster clipart, resize small, confirm no warning.
- N3 + N4. ✅ DONE (commit e14a0f9) + FIX (commit c6f2c37). Shared <BrandMark>
  replaced the hardcoded TEE/STUDIO marks on designer (ActionBar), order page
  (was single-tone → now two-tone), admin, and login. FIX: the first version read
  invented app.name.part1/part2 keys that Denise never edited (so it showed code
  defaults); it now reads the SINGLE `app.name` Language field and splits on the
  first space — first word in the text color, the rest in brand red. Denise's
  existing override `app.name = "PREP STATION"` now drives every surface, no
  re-edit needed. Denise: hard-refresh and confirm the wordmark reads "PREP
  STATION" (STATION red) everywhere.

**Small UX — ✅ ALL DONE (commit b0ea33e):**
- N5. ✅ customerZoneLabel() shows a hat's back zone as "Back" to shoppers
  (designer bar + order page); admin keeps "Hat Back"; key unchanged.
- N6. ✅ Small-print "We cannot do PMS color matching." (language-editable,
  designer.color.pms_note) under BOTH the Text Color and Clipart Color headings.
- N7. ✅ Clear All now wipes sleeve/hat zones too (extraZoneObjectsRef), not just
  front/back; confirm names the full scope (every side + print zone).
- N8. ✅ Add to Cart stays clickable when not ready (disabled only while
  submitting) and says exactly what's missing on click — size/quantity, roster
  sizes, or the acknowledgment — instead of a silent gray button.

## Re-import (overwrite) from Shopify — ✅ DONE (commit 5fc0305)

- Migration 20260815172255 applied (approved): `product_template_mockups.source`
  ('shopify'|'manual', default 'manual'). Backfill verified — Front(27)/Back(37)
  → 'shopify'; hat_back(10)/sleeves(29+29) → 'manual'.
- New **"Re-import (overwrite)"** button in the Mockups grid, beside "Import
  Front/Back". Refreshes Front/Back from Shopify; front/back ONLY so sleeve/hat
  are never touched; silently refreshes Shopify-sourced/missing cells and asks a
  second confirm before replacing any HAND-uploaded Front/Back cell. Both manual
  upload paths now stamp 'manual' (protected even when replacing a shopify cell).
- Denise: change a product's photos in Shopify → open its Mockups grid →
  Re-import (overwrite) → confirm the Front/Back tiles update; sleeve/hat
  untouched.

## Queued (agreed, not started)

- 🔶 **Method-switch must reconcile ALL zones' text, not just the visible one (fulfillment-correctness;
  fix before launch volume).** Print↔embroidery font reconcile (`restyle` for plain text +
  `recurveCurvedToValidFont` for curved) covers the CURRENT-view canvas + the front/back refs only.
  **Off-canvas EXTRA zones (sleeves, hat_back) are not reconciled** — e.g. design a hat-back arc text, flip
  to the hat FRONT, switch to embroidery: the hat-back keeps its print font, and it's SILENT — no error, it
  just reaches the bench in the wrong font at order time (wrong cut/digitize). Plain text in extra zones is
  half-covered (`restyle` iterates `allZoneObjs()`), but **curved text in an off-canvas extra zone is the
  real hole**, and the plain-text extra-zone path isn't re-fit against that zone's box either. **Fix shape:**
  generalize the reconcile to walk EVERY zone (canvas + front/back refs + `extraZoneObjectsRef` per zone),
  each with its own box — the hard part is an off-canvas extra zone's LTRB in canvas-px (needs the zone's
  mockup natural dims, same px→% math as the designer read). Cheaper interim: stamp a "needs-refont" flag on
  off-canvas curved text at switch time and re-bake it when its zone is next shown (lazy, uses that view's
  live `getPrintAreaBounds`). Same class as the [[project_print_zones]] "every zone must be handled" theme.
- ✅ **DONE — Type-on-path hat-back curve (Z-hp-2 … Z-hp-6).** Admin draws the arc
  per hat template (endpoints + bulge on the mockup); customer hat-back text lays
  along it at a fixed height, centered; the cut file follows the same path. Shipped
  across ace9b7d…c01e9b7 (engine + plumbing + curve_path migration + draw-arc UI +
  designer read + fixed-height + dotted arc guide + minimized selection box). Three
  adversarial reviews clean; Denise verified size, the visual arc, and the CUT FILE
  ("File works"). Optional follow-ups: per-zone height override; "size set by arc"
  cue for the locked slider.
- Backs-off-Shopify sweep (Denise, manual, no rush): once the mockup switch is
  verified, remove back photos from Shopify product pages — one test product
  first, confirm designer Back view still renders, then sweep.

## Parked (named, deliberate, not lost)

- ✅ DONE — Chest reference guide (CustomInk-style dashed outline), commit cc89dda.
- ✅ DONE — Hat-back one-text guard + "size set by arc" cue, commit fb0d3dc.
- ✅ DONE — Sleeve/color dup-mockup cleanup (8 no-space legacy rows deleted,
  approved 2026-08-15; canonical spellings kept).
- #3 cold-load freeze — watch only; if it recurs on a settled deploy, grab
  F12 console reds.
- Android device check for on-shirt pinch (needs a physical phone).
- Post-beta well: Decal Part 3 reporting + Admin Reporting dashboard,
  Cloudinary orphan purge, roles/permissions (Option B), seamless multi-batch
  design apply, embroidery stitch files (digitizing thread), micro-discount
  slider idea (competitive notes).

## Awaiting Denise's verification — new

- **Lens 1 "Preview at print size"** (built 2026-08-18). Select an uploaded image → in the Edit Image tools,
  **"Preview at print size"** opens a modal showing the art at true print scale (Actual size = life-size
  ~96ppi approximation) with a Fit / Actual / 2× / 4× zoom loupe + drag-to-pan, and the DPI verdict + inches
  caption. Test: upload a low-res/blurry image, size it up on the shirt, open the preview → the softness
  should be visible when zoomed; the caption should match the amber low-res nudge. Vector/SVG uploads and
  clipart show no button (correct). Works desktop + mobile.
- **Lens 2 "cut-edge preview"** (built 2026-08-18, adversarial review clean after fixes). Inside the same
  preview modal, a **"Show cut lines"** toggle overlays the production trace (same `autoTraceSvg` the bench
  gets) as a magenta outline — so cut/transfer jobs show the exact edges that would cut. Gate = cuttability
  (the trace), garment color a hint (dark garments lead the overlay ON). Test: open the preview on a
  one-color logo → "Show cut lines" appears and outlines it; on a dark garment the outline leads on.
  **A failed trace now splits by garment (shop truth):** on a DARK garment it's a clean-up warning that
  NAMES the problem — "edges too fuzzy to cut cleanly" vs "too many colors" (on darks a failed trace means
  the bench cleans up then cuts, NOT that we print instead); on a LIGHT garment it's the simple "printed,
  not cut". AI/PSD/PDF uploads deliberately show NO cut toggle (the bench cuts their raw vector, not the
  preview PNG). Review found + fixed: SSRF/DoS on the new endpoint, a false "printed not cut" on fetch
  failures, the AI/PDF parity gap, and an undo-desync of the parity flag — all closed before push.
  Wording is language-editable (dark message = shop-truth warning, amber; Denise to tune phrasing).

## Recently DONE (verified, for morale)

Print Zones Z0–Z4 live (sleeves + hat zones, per-zone pricing/capture/cut
files) · hat-back auto-curve v1 (degrees, +45 frown default) · template admin
as single control panel (unavailable-product badge, live color sync, stale
badges, graceful unavailable page, picker filtering) · managed mockups as
single image source · type-on-path foundation (Z-hp-1 math) · volume discount
system + Function · language editor (~315 strings) · font management ·
error-boundary recovery · admin users · terms checkboxes · desired-by dates ·
edit-from-cart · N&N + curve + zoom + Layers + low-res + …the rest of
BETA_CHECKLIST's checked items.
