# Tee Studio — Project Brief

> **Read this first.** One-document orientation for a fresh session. Deeper detail lives in
> [CLAUDE.md](CLAUDE.md) (the full dev guide + hard rules) and [BUILD_PLAN.md](BUILD_PLAN.md) (the
> path-to-launch roadmap). This brief is the map; those are the territory.

_Last meaningful update: 2026-08-05._

---

## 1. What Tee Studio is

A **custom t-shirt design tool** that replaces the store's old ImprintNext designer. A customer opens
the canvas designer, adds **text, clipart, uploaded images, and Names & Numbers** (team rosters) to a
garment, then adds the finished design to their **real Shopify cart** and checks out — mixed in with
off-the-shelf products, one checkout.

- **Owner:** Denise (dplumb@mac.com) — **non-technical**. Spell out exact steps; never ask for secrets
  in chat; she verifies visually (Illustrator for cut files, iPhone/Chrome for mobile).
- **Not live yet.** **ImprintNext still serves real customers** on the storefront. Tee Studio flips on
  at the **Phase 6 cutover**. Everything today is pre-launch.

---

## 2. Architecture

| Layer | Tech | Notes |
|---|---|---|
| Framework | **Next.js 16.2.4** (App Router) + **TypeScript 5** | Root `proxy.ts` (was `middleware.ts`) refreshes Supabase session per request |
| UI | **Tailwind CSS 4**, Radix UI, Lucide icons | Designer = dark palette; admin = light |
| Canvas | **Fabric.js 7.3.1** | The designer core (`DesignerCanvas.tsx`, ~3900 lines) |
| Database | **Supabase** (Postgres) | RLS on all public tables; project id **`yatiairlyensmcwbpldx`** |
| Storage | **Supabase Storage** (clipart, previews, customer uploads) + **Cloudinary** | Cloudinary: AI/PSD/EPS upload conversion + remove-bg re-hosting (URL-in/URL-out) |
| E-commerce | **Shopify** | Storefront API (product data), Online Store `/cart/add.js` (cart), Customer Account API (login, OIDC), `order/paid` webhook |
| Hosting | **Vercel** | See deploy topology below |
| Cut-file / print pipeline | **opentype.js** (glyph → outlined vector paths), **paper.js** (`paper-jsdom`, boolean ops), **potrace** (raster auto-trace), **sharp** (image processing) | Phase 5 — per-side SVG cut files for Roland-via-Illustrator |
| Export | html2canvas, pdfjs-dist | |
| Tests | **Vitest** + happy-dom + @testing-library/react | `vitest.config.mts`; `tests/` |

### Data flow (happy path)
1. Product page → designer (`/designer?product_id=…`) → Fabric canvas.
2. Design saved to **`design_orders`** (anonymous, URL-as-key by UUID).
3. **Add to cart** (`/api/design-orders/[id]/add-to-cart`): renders an **ephemeral Shopify product**
   (per-size variants at the folded price, `seo.hidden=1`, published to Online Store), then POSTs the
   customer's own `/cart/add.js` with cookies forwarded. Designs join the **real session cart**.
4. **`order/paid` webhook** marks `design_orders.status='completed'` + writes PII/shipping.

### Pricing model (Phase 4, current)
A finished design's per-size variants carry the **full folded `price_per_item`** (blank garment + print
charges). **No separate "Print Charge" line items.** Print is **flat per side** ($12/side), regardless
of garment. See CLAUDE.md → "designer_pricing operational rules" for the full history.

---

## 3. Where things live

### Repo & branches
- Working branch: **`phase5-cut-file`** — currently **66 commits ahead of `main`** (all of Phase 5 +
  Names & Numbers + error boundaries + auto-draft + tests). `main` is a **strict ancestor** (clean
  fast-forward available, no divergence).
- `main` last commit: `1602449` (2026-08-02). **`main` is stale** relative to the active work.

### Deploy topology (⚠️ important — this bit customer-visible testing)
| Domain | Serves | Cart works? |
|---|---|---|
| **`create.tshirtdeli.com`** | **`main`** (Vercel production) — *stale until a merge/re-point* | ✅ (it's on `.tshirtdeli.com`) |
| **`*.vercel.app`** | `phase5-cut-file` branch previews | ❌ **cart is empty** |

**Why the cart only works on `create.tshirtdeli.com`:** Shopify's cart cookie is scoped
`.tshirtdeli.com`. The add-to-cart route proxies the customer's own `/cart/add.js` with forwarded
cookies, so it **must be same-registrable-domain**. On `*.vercel.app` the browser has no
`.tshirtdeli.com` cookie → Shopify makes a fresh cart the browser can't hold → cart shows empty. This
is a browser cross-domain rule, unfixable in code. **To test the cart, the branch must be on a
`.tshirtdeli.com` domain** (merge to `main`, or point `create.tshirtdeli.com` at the branch in Vercel).

### Admin (`/admin`)
Auth = Supabase OTP (8-digit emailed code) + `ADMIN_EMAILS` allowlist; DB writes gated by
`auth.users.app_metadata.is_admin`. Tabs: **Clipart · Orders · Pricing · Templates**
(`/admin/templates` = per-product print areas + colors).

### Product templates (live, all 3 have front+back print areas)
| Product | Back box (px) | Aspect | Physical |
|---|---|---|---|
| 100% Cotton Onesie | 493 × 629 | 0.78 | 12″ × 12″ |
| Unisex Triblends | 874 × 1273 | 0.69 | 12″ × 12″ |
| Unisex 100% Cotton T-Shirt | 780 × 1219 | 0.64 | 12″ × 16.4″ |
> Note: px-box aspect and physical inches don't perfectly match on some — worth truing for honest
> Phase-5 cut scaling. (Denise's admin template pass.)

### Key files
- `app/components/DesignerCanvas.tsx` — the designer (canvas, tools, N&N, save/restore).
- `app/lib/namesNumbers.ts` — pure N&N engine (roster parse, uppercase, condense-to-fit, jersey layout).
- `app/lib/server/` — cut-file pipeline (`generateCutFile`, `autoTrace`, `cutBoolean`, `rateLimit`).
- `app/api/design-orders/[id]/add-to-cart/route.ts` — the cart join.
- `types/database.ts` — generated Supabase types (regen after schema changes; hand-bridge if MCP down).
- `supabase/migrations/` — canonical migration record.

### Memory & transcripts (continuity system)
- **Auto-memory:** `~/.claude/projects/-Users-deniseplumb-Desktop-tee-studio/memory/` — one fact per
  file, `MEMORY.md` is the loaded index. Types: `user`, `feedback`, `project`, `reference`. Key files:
  `project_names_numbers.md`, `project_phase5_fulfillment.md`, `project_phase_status.md`,
  `reference_infra.md`, `user_profile.md`.
- **Session transcripts:** `~/.claude/projects/-Users-deniseplumb-Desktop-tee-studio/<sessionId>.jsonl`
  — full turn-by-turn record; read it when continuing prior work.

---

## 4. Current phase status

- **Phases 1–4: COMPLETE.** Customer login (Shopify Customer Account API, OIDC, confidential client,
  **no PKCE** — see CLAUDE.md), the ephemeral-product cart join, per-template print areas + colors,
  desktop restructure, and **mobile (BLOCKER-2)** — all built. Transaction spine proven (**8 completed
  orders**, incl. ship + pickup + multi-design).
- **Phase 5 (cut-file pipeline): BUILT + hardened.** Per-side SVG, colors as layers, **outlined glyph
  paths** (opentype.js), curved-text→vector, boolean-op curve-fidelity gate, 300dpi + physical inches,
  font-fidelity sweep. See `project_phase5_fulfillment.md`.
- **Names & Numbers (D3 rail feature): Phases 1–3 DONE, Phase 4 pending.**
  - P1 designer: roster table + placeholders (`_nnRole`) + live preview cycling + **locked jersey stack**
    (fixed slots, box-hug via `_fontSizeMult`/`_fontSizeFraction`, geometry locked / style-only).
    Forced **UPPERCASE**; third **Title** field; auto-show-back; header-aware paste + roster template.
  - P2 order: `design_orders.roster` JSONB (Option 1 pricing = personalization is the printed side, no
    separate fee); read-only manifest on the order page.
  - P3 cart: **one cart line per roster entry** with visible Name/Number/Title properties;
    blank-size rows **block checkout**. ← *awaiting a `.tshirtdeli.com`-domain test (see deploy note)*.
  - **P4 (pending):** per-entry cut files (shared base produced once + per-player personalization
    overlays aligned in the print space + roster manifest in `OrderInfo.txt`).

**Genuinely left to beta** (rough): N&N Phase 4 · **D2 Design Portability** (launch-scope) · **Layers**
· polish backlog · per-phase verification. See §6.

---

## 5. How we work (the rules that prevent mistakes)

### 🚨 Show-plan-first for migrations (HARD RULE)
**Never apply a Supabase migration without first showing the SQL to Denise in plain language and
getting explicit approval** — including "trivial" ones (add column, index, policy, seed). She's
non-technical: name the table, say what changes in everyday terms, call out anything irreversible.
Then: apply → write the file to `supabase/migrations/` → regen `types/database.ts` → `tsc` → commit
together.

### Backstop protocol (adversarial review on fresh scar tissue)
After building something load-bearing, **adversarially review it** before trusting it — this session's
auto-draft feature had a HIGH data-loss bug that only a skeptical second pass found. For risky
work: build → adversarially verify → fix → test. Error boundaries + smoke tests protect the freshest
code first.

### Verify against the REAL repo, not stale memory
Recalled memory reflects *when it was written*. Before acting on it, **check the actual code/git**
(a "tool-complete board" was once built from stale memory and was wrong). If a memory names a file/flag,
confirm it still exists.

### The `tsc` gate (bit us 3× — do not skip)
`next build` prints "Compiled successfully" but **type-checks in a separate step** that fails the Vercel
deploy. **Always run `npx tsc --noEmit` before pushing.** Standard pre-push: `tsc` clean + `vitest run`
green + `next build` exit 0.

### Parity gates (geometry safety)
The designer has a read-only **parity harness** (`?parity=1` → `window.__parity`) that characterizes
load-bearing geometry/export functions with golden-master fixtures, so canvas refactors can be proven
parity-neutral. Don't change geometry casually; if you touch constrain/export/print-area math, run it.

### Full-replace APIs re-assert the FULL intended state
Recurring bug shape: Fabric `toObject(props)` (not `toJSON`), Shopify `productSet` (re-assert type +
seo.hidden + tags + status on every update), and "blind read surfaces" that hide channels/webhooks.
Before trusting a write ask "is this a full replace?"; before trusting a read ask "what does this
surface refuse to show me?"

### Commit cadence
Rhythm: **build → `tsc`/tests/build → commit → push → Denise prod-tests.** **Check in BEFORE pushing**
if a commit adds an admin screen/route, changes DB schema, or bundles unrelated concerns. Commit
messages end with the `Co-Authored-By: Claude` trailer. Denise verifies between phases.

### Known infra quirks (as of this session)
- **Supabase MCP: disconnected.** Migrations can't be applied via MCP; the `roster` column was applied
  by Denise via the **dashboard SQL editor**, so the server migration-history lacks that record —
  **backfill it when the MCP reconnects.** Read-only DB queries can be done with a service-role script.
- **Vercel MCP: 403** for this team scope — can't inspect/deploy from tools.
- `.env.local` holds secrets — leave it alone; never print its values.

---

## 6. Backlog

### Next up (N&N close-out)
- **N&N Phase 4** — per-entry cut files (reuses `jerseyStackLayout` + `rosterValue` uppercase +
  `condensedScaleX`; curved-name re-bake per entry).
- **Curve-for-placeholders** — curved N&N text (rides with Phase-4's per-entry re-bake).
- **Admin N&N stack-preview overlay** (real, logged) — draw the locked NAME/TITLE/NUMBER stack in
  `/admin/templates` so box setup shows where it lands. Prevention-at-source, like the anisotropy badge.
- **Front chest-number layout** — the locked stack applies the same big-centered layout on any side;
  a real front chest number is a different (small, upper-left) convention — deferred.

### Launch-scope
- **D2 Design Portability** (⭐ promoted in-scope) — re-fit a saved design onto any product; switch
  garments mid-design. ~9–13 dev-days; curved text is the risk. Re-fit rule DECIDED (proportional).
- **Designer on Mobile** — done (BLOCKER-2), phone-confirmed; keep an eye on order-page mobile polish.

### Polish / quality
- **Low-resolution upload warning** (scoped, not built) — WARN don't block; effective-DPI at placed size.
- **Font Categories** — grouped/searchable font picker (per-font preview already shipped via shared
  `FontPicker`); + full font-management "admin owns all fonts" sub-project; + universal Illustrator-like
  icon set.
- **Language editor / labels-as-data** — make customer-facing wording admin-editable (folds in the
  "Screen Print" → "Print" rename so it can't regress).
- **Layers** (desktop-only surface).
- Pull-to-refresh gesture re-enable (mobile, on-device); pre-launch durable rate-limit for `remove-bg`.

### Named future features (real projects, need discovery)
- **Embroidery** (3rd production mode — stitch files DST/PES, digitizing; in-house hats→sweatshirts,
  flat add-on price).
- **Decal Designs** (catalog split + sell-through tracking; Part 2 capture must precede launch volume).
- **AI image generator**, recolorable single-color vector uploads.

### Cosmetic / tech debt
- "Screen Print" → "Print" (display only — the `screen_print` DB key is load-bearing, ~40 call sites).
- Product image naming collisions; faux-bold; `DesignerCanvas.tsx` is large.

### ⚠️ Deferred with a landmine
- **Draft-cleanup cron** — delete `status='draft' AND created_at < now()-7d`, **but MUST exclude saved
  designs** (`saved_designs.design_order_id` is `ON DELETE CASCADE` — a naive age-delete silently
  destroys customers' saved work). See CLAUDE.md.

---

## 7. First moves for a fresh session
1. Read this brief, then **`MEMORY.md`** (index) and **CLAUDE.md** (hard rules).
2. Check `git log --oneline origin/main..phase5-cut-file` to see what's ahead of `main`.
3. If continuing prior work, read the latest session `.jsonl` transcript.
4. Before any DB change: **show-plan-first**. Before any push: **`tsc` + tests + build**.
5. When in doubt about state, **verify against the repo/git**, not memory.
