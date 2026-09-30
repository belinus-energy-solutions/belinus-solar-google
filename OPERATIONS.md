# OPERATIONS — belinus solar web-sales engine (custom stack)

## Health
- `GET /healthz` → `ok` (Bunny health check)
- `GET /api/health` → which secrets are set (booleans only), panel assumptions

## Environment (Bunny Magic Container)
See `.env.example`. Secrets: `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_API_KEY`.

## Common issues
| Symptom | Cause / fix |
|---|---|
| "Adres niet gevonden" | Geocoding found nothing — check spelling / postcode |
| "Geen dakgegevens beschikbaar" | Solar API has no building at any quality for that point (rare in BE/NL) |
| "Dak te klein" / "Geen geschikt dakvlak" | No panel slots, or all below `MIN_SLOT_YIELD` of the best slot |
| 403 from Google | API not enabled on the key, or billing not active on the GCP project |
| PVGIS unreachable | JRC service down/rate-limited (retries 3×); try again later |
| Roof image blank | Solar API Data Layers failed and Maps Static API not enabled on the key |
| Panels look shifted on the image | Old scan made before the orthophoto fix (Maps Static tile is not orthorectified) — run a new scan |

## Tuning (env, no redeploy of code needed — restart container)
- `PANEL_WP`, `PANEL_LENGTH_M`, `PANEL_WIDTH_M` — belinus module spec (default 500 Wp, 1.954 × 1.134 m)
- `MIN_SLOT_YIELD` — skip panel positions below this fraction of the best position (default 0.6)
- `MAX_DIST_M` — max distance of a panel from the address point, keeps panels off neighbours' roofs (default 9)
- `MIN_PER_FACE` — smallest group of panels allowed on one roof face (default 4)
- `FLAT_FACTOR` — score multiplier for flat roofs vs. pitched faces (default 0.92)
- Prices, battery sizing, VAT, finance: `src/pricing.ts` (identical to the Aurora version — keep in sync)

## Data
Same Supabase project as the Aurora version (*Belinus Solar*, `ywuuhcixtzutspcbxelr`).
- `leads.source`, `quotes.source` — `'google'` for this stack, `'aurora'` for the old one
- `solar_designs` — geocode, raw Building Insights, chosen layout, PVGIS production, `roof_image` (orthophoto metadata)
- Storage bucket `roof-images` (private) — one PNG per scan, served via `/api/roof-image`
- Quote/invoice/receipt numbering is shared (same RPCs) — both versions draw from one sequence.

## Google cost per scan
1 Geocoding + 1 Building Insights + 1 Data Layers (aerial image, 1,000 free/month, then the most expensive call) — Maps Static only as fallback.

## Free-tier note
The Supabase free tier pauses a project after a week without traffic. If both
versions stop working, restore the project in the Supabase dashboard.
