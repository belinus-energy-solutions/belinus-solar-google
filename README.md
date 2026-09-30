# belinus solar — web-sales engine (custom stack)

Customer-facing solar + battery energy scan and online order flow, built on
**Google Solar API + PVGIS** instead of Aurora Solar. The customer flow, layout,
texts, pricing, PDFs and order/checkout are identical to the Aurora version
(`belinus-solar-test`) so the two can be compared side by side.

**This version never calls the Aurora Solar API.**

| | Aurora version | Custom stack (this repo) |
|---|---|---|
| Link | GitHub Pages `…/belinus-solar-test/` | Bunny Magic Container URL |
| Backend | Supabase edge function `solar` | this container (`/api/*`) |
| Roof geometry | Aurora AI roof | Google Solar API — Building Insights |
| Panel layout | Aurora AutoDesigner | `src/layout.ts` (Google's ranked panel slots) |
| Yield | Aurora simulation | PVGIS v5.3 per roof face × Google shading factor |
| Design view | Aurora 3D CAD iframe | `roof-viewer.html` (satellite + panel overlay) |
| Database | Supabase *Belinus Solar* | same project, `source = 'google'` |

## Architecture

```
browser ──► Bunny Magic Container (Deno, port 8080)
              ├─ /                 public/index.html (same UI as the Aurora version)
              ├─ /roof-viewer.html satellite + panel layout (iframe on the result page)
              └─ /api/*            JSON API, same routes as the edge function
                   ├─ Google Geocoding · Solar API · Maps Static   (GOOGLE_API_KEY, server-side only)
                   ├─ PVGIS PVcalc (EU JRC, no key)
                   └─ Supabase (existing project ywuuhcixtzutspcbxelr, service role)
GitHub (main) ──Actions──► ghcr.io/belinus-energy-solutions/belinus-solar-google:latest ──► Bunny
```

## Flow per scan (API calls)

1. `POST /api/start` — geocode address, create `leads` + `solar_designs` rows
2. `POST /api/ai-roof/run` — Google **buildingInsights:findClosest** (HIGH → MEDIUM → BASE)
3. `POST /api/autodesigner/run` — pick panels until the target kWh is met, capped by
   meter type (1-phase 5 kWp / 3-phase 10 kWp), roof area and a minimum-yield rule
4. `POST /api/simulation/run` — **PVGIS** per roof face, × Google shading factor
5. `POST /api/quote` — unchanged `pricing.ts` → offerte, PDFs, demo order/payment

Cost per scan: 1 Geocoding + 1 Building Insights + 1 Static Map (cached). Building
Insights free tier: 10,000 calls/month. Data Layers is **not** used.

## Deploy

1. **Google Cloud** — one API key with *Geocoding API*, *Solar API*, *Maps Static API*
   enabled; restrict it to those 3 APIs (no referrer restriction: it is used server-side).
2. **Supabase** — migration `supabase/migrations/20260930120000_google_stack.sql`
   (already applied to *Belinus Solar*; additive only, the Aurora version is untouched).
3. **GitHub** — push to `main`; Actions builds and pushes the image to GHCR.
4. **Bunny Magic Containers** — new app from image
   `ghcr.io/belinus-energy-solutions/belinus-solar-google:latest`
   (add GHCR pull credentials: a GitHub PAT with `read:packages`), port **8080**,
   env vars from `.env.example`, endpoint on e.g. `solar.belinus.com`.
5. Check `https://<host>/api/health` → `google_key_set: true, supabase_set: true`.

## Local run

```bash
cp .env.example .env   # fill in keys
deno run --allow-net --allow-env --allow-read --env-file=.env server.ts
deno test --allow-env test/
```

The customer page (`public/index.html`), datasheets, terms and logo are **not**
stored in this repo. The build takes them from `belinus-solar-test` at a pinned
commit (`UI_REF` in the workflow) and `scripts/build_frontend.py` swaps only the
engine-specific lines. That guarantees the two links show the same page; bump
`UI_REF` to carry UI changes over. The script fails the build if the original
changed shape or if any Aurora reference would remain.

For a local run, build the page first:

```bash
git clone https://github.com/belinus-energy-solutions/belinus-solar-test ../belinus-solar-test
python3 scripts/build_frontend.py ../belinus-solar-test public/index.html
cp -r ../belinus-solar-test/datasheets ../belinus-solar-test/cowboy-voorwaarden.html public/
```

## Roadmap

- **Odoo connector** — every web quote mirrored as a real Odoo quotation with Odoo
  numbering and product codes (`quotes.odoo_order_id / odoo_quote_number / odoo_synced_at`
  are reserved for it).
- Mollie payments and Sumsub signing (stubs unchanged from the Aurora version).
