// ============================================================
// Google Maps Platform helpers — Geocoding, Solar API (Building
// Insights) and Maps Static (satellite tile for the roof viewer).
//
// One server-side key (GOOGLE_API_KEY) with these APIs enabled:
//   - Geocoding API
//   - Solar API
//   - Maps Static API
// The key never reaches the browser: the viewer loads the satellite
// image through /api/roof-image.
// ============================================================

const KEY = () => (Deno.env.get("GOOGLE_API_KEY") ?? "").trim();

function requireKey() {
  if (!KEY()) {
    throw {
      status: 500,
      body: { message: "GOOGLE_API_KEY is not configured on the container. Check /api/health." },
    };
  }
}

async function gfetch(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw { status: res.status, body: json?.error ?? json };
  return json;
}

export type LatLng = { latitude: number; longitude: number };

/** Address → coordinates (biased to Belgium / the Netherlands). */
export async function geocode(address: string) {
  requireKey();
  const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  u.searchParams.set("address", address);
  u.searchParams.set("region", "be"); // bias only — Dutch addresses still resolve
  u.searchParams.set("language", "nl");
  u.searchParams.set("key", KEY());
  const r = await gfetch(u.toString());
  if (r.status !== "OK" || !r.results?.length) {
    throw {
      status: 400,
      body: { message: `Adres niet gevonden / address not found (${r.status ?? "no result"})` },
    };
  }
  const best = r.results[0];
  return {
    latitude: best.geometry.location.lat as number,
    longitude: best.geometry.location.lng as number,
    formatted_address: best.formatted_address as string,
    location_type: best.geometry.location_type as string, // ROOFTOP is what we want
  };
}

/**
 * Building Insights for the building closest to the point.
 * Quality ladder: HIGH → MEDIUM → BASE (expanded coverage). Belgium and the
 * Netherlands are mostly HIGH; BASE is only a fallback for rural edge cases.
 */
export async function buildingInsights(loc: LatLng) {
  requireKey();
  const tries: Array<{ q: string; exp?: string }> = [
    { q: "HIGH" }, { q: "MEDIUM" }, { q: "BASE", exp: "EXPANDED_COVERAGE" },
  ];
  let lastErr: any = null;
  for (const t of tries) {
    const u = new URL("https://solar.googleapis.com/v1/buildingInsights:findClosest");
    u.searchParams.set("location.latitude", loc.latitude.toFixed(7));
    u.searchParams.set("location.longitude", loc.longitude.toFixed(7));
    u.searchParams.set("requiredQuality", t.q);
    if (t.exp) u.searchParams.set("experiments", t.exp);
    u.searchParams.set("key", KEY());
    try {
      return await gfetch(u.toString());
    } catch (e: any) {
      lastErr = e;
      // 404 = no building at this quality level → try the next rung.
      if (e?.status !== 404) throw e;
    }
  }
  throw {
    status: 404,
    body: {
      message: "Geen dakgegevens beschikbaar voor dit adres / no roof data available for this address",
      detail: lastErr?.body ?? null,
    },
  };
}

/** Satellite PNG for the roof viewer (server-side proxy, key stays private). */
export async function staticSatellite(lat: number, lng: number, zoom: number) {
  requireKey();
  const u = new URL("https://maps.googleapis.com/maps/api/staticmap");
  u.searchParams.set("center", `${lat},${lng}`);
  u.searchParams.set("zoom", String(zoom));
  u.searchParams.set("size", "640x640");
  u.searchParams.set("scale", "2");
  u.searchParams.set("maptype", "satellite");
  u.searchParams.set("key", KEY());
  const res = await fetch(u.toString());
  if (!res.ok) throw { status: res.status, body: { message: `Static map ${res.status}` } };
  return new Uint8Array(await res.arrayBuffer());
}

export const googleConfigured = () => KEY().length > 0;
