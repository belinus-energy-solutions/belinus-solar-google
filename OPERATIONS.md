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
| Roof image blank | Maps Static API not enabled on the key |

## Tuning (env, no redeploy of code needed — restart container)
- `PANEL_WP`, `PANEL_LENGTH_M`, `PANEL_WIDTH_M` — belinus module spec (default 500 Wp, 1.954 × 1.134 m)
- `MIN_SLOT_YIELD` — skip panel positions below this fraction of the best position (default 0.6)
- Prices, battery sizing, VAT, finance: `src/pricing.ts` (identical to the Aurora version — keep in sync)

## Data
Same Supabase project as the Aurora version (*Belinus Solar*, `ywuuhcixtzutspcbxelr`).
- `leads.source`, `quotes.source` — `'google'` for this stack, `'aurora'` for the old one
- `solar_designs` — geocode, raw Building Insights, chosen layout, PVGIS production
- Quote/invoice/receipt numbering is shared (same RPCs) — both versions draw from one sequence.

## Free-tier note
The Supabase free tier pauses a project after a week without traffic. If both
versions stop working, restore the project in the Supabase dashboard.
