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

## New items — Denise 2026-08-19

1. **BUG — vertical text breaks in sleeve zones.** Unisex Long Sleeve T → add a sleeve print area → add
   text → Direction=Vertical: text goes OUTSIDE the box and wraps in weird places. The text-fit/wrap logic
   (`reWrapText`/`fitAndConstrain`) is not vertical-aware in the new zone boxes; sleeves are tall+narrow,
   which worsens it. Repro solid. NEEDS FIX (not started).
2. ✅ **DONE — admin lands on ORDERS after login, not Clip Art.** Changed the two login-redirect defaults
   (`auth/callback` `next`, `admin-login` `from`) `/admin/clipart` → `/admin/orders`.
3. **Hat-back arc guide — option to HIDE the dotted line (propose).** Recommendation: **auto-hide the guide
   once text is placed** (zero-config; the guide helps placement while the zone is empty and vanishes from
   the final look) + optionally a per-template admin toggle for hats where you never want it. Awaiting
   Denise's pick before build.
4. **SCOPE — "PrepStation Manual"** (content feature). A simple, good-looking one-page "how it works" guide
   (add text, uploads, sleeves, saving…). Proposed: a dedicated `/how-it-works` page (shareable/bookmarkable,
   linkable from emails/support) + a "How it works" link in the designer top bar. Content written later
   (Denise + Claude). Scope = the page container + entry link + language-editable copy; not started.
5. **Clipart quality (two related):**
   - (a) **False low-res warning on clipart — the guard is PRESENT + correct in current code**
     (`lowResMessageFor` line ~2744: `if (!obj._uploadSrc) return null`; clipart is NEVER stamped
     `_uploadSrc`). So the current code cannot produce this. Most likely a STALE deploy (we just resolved a
     serious deploy problem). **Step 1: re-test on the fresh post-sharp-fix deploy.** If it still repros,
     it's a genuine hole needing a live console check (inspect the selected object's props) — NO blind fix.
   - (b) **Enlarged clipart blurry — CONFIRMED bug.** SVG clipart loads via `FabricImage.fromURL` →
     rasterized at its 250px natural size → blur when enlarged (recolor is a BlendColor filter on that
     raster). Fix options: **interim = rasterize the SVG at high res (~1500px)** (keeps the recolor-filter +
     cut-file `.src` architecture; crisp up to that size); **proper = load SVG as true vectors** (infinite
     crispness, but reworks recolor→path-fill AND the cut-file `isClipartObj`/`.src` read — a real refactor).
     Recommend the interim now, proper later. **UPLOAD SPEC (Claude's requirement, per Denise's pushback —
     on-screen crispness only, NOT print res; bench pulls the original from the decal folder; keep Supabase
     lean):** SVG → natural size IRRELEVANT once the render fix lands, keep them tiny (prefer SVG); PNG decal
     → **~1024px on the longest side** (crisp at full print-area size on a Retina screen; ~100–500KB). Drop
     the ImprintNext 250×250 rule. Not started.

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
