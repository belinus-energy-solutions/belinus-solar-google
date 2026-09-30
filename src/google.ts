import { fromArrayBuffer } from "npm:geotiff@2.1.3";
import { encode as encodePng } from "npm:fast-png@6.2.0";

// ============================================================
// Google Maps Platform helpers — Geocoding, Solar API (Building
// Insights + the Data Layers aerial image) and Maps Static (fallback
// satellite tile for the roof viewer).
//
// One server-side key (GOOGLE_API_KEY) with these APIs enabled:
//   - Geocoding API
//   - Solar API
//   - Maps Static API
// The key never reaches the browser: the viewer loads the roof image
// through /api/roof-image.
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

export type RoofImage = {
  png: Uint8Array;
  meta: {
    epsg: number;                              // UTM zone, e.g. 32631 for Belgium
    bbox: [number, number, number, number];    // minX, minY, maxX, maxY in metres (UTM)
    width: number; height: number;             // pixels
    imagery_date: string | null;
    quality: string | null;
  };
};

/**
 * The aerial image the Solar API itself used for the roof analysis
 * (Data Layers → RGB GeoTIFF). Unlike the Maps Static satellite tile it is
 * a true orthophoto: roofs sit exactly where the panel geometry says they
 * are, so the drawn panels line up with the real roof.
 * Billed as a Data Layers request (one per scan; the PNG is stored).
 */
export async function roofOrthophoto(lat: number, lng: number, radiusM: number): Promise<RoofImage> {
  requireKey();
  let layers: any = null, lastErr: any = null;
  for (const q of ["HIGH", "MEDIUM"]) {
    const u = new URL("https://solar.googleapis.com/v1/dataLayers:get");
    u.searchParams.set("location.latitude", lat.toFixed(7));
    u.searchParams.set("location.longitude", lng.toFixed(7));
    u.searchParams.set("radiusMeters", String(Math.round(radiusM)));
    u.searchParams.set("view", "IMAGERY_LAYERS");
    u.searchParams.set("requiredQuality", q);
    u.searchParams.set("pixelSizeMeters", q === "HIGH" ? "0.1" : "0.25");
    u.searchParams.set("key", KEY());
    try { layers = await gfetch(u.toString()); break; } catch (e: any) {
      lastErr = e;
      if (e?.status !== 404) throw e;
    }
  }
  if (!layers?.rgbUrl) throw lastErr ?? { status: 404, body: { message: "No aerial image" } };

  const res = await fetch(`${layers.rgbUrl}&key=${KEY()}`);
  if (!res.ok) throw { status: res.status, body: { message: `GeoTIFF ${res.status}` } };
  const tiff = await fromArrayBuffer(await res.arrayBuffer());
  const img = await tiff.getImage();
  const width = img.getWidth(), height = img.getHeight();
  const rgb = await img.readRasters({ interleave: true, samples: [0, 1, 2] }) as unknown as ArrayLike<number>;
  const png = encodePng({ width, height, data: Uint8Array.from(rgb), channels: 3 });
  const bb = img.getBoundingBox() as number[];
  const d = layers.imageryDate;
  return {
    png,
    meta: {
      epsg: Number(img.getGeoKeys()?.ProjectedCSTypeGeoKey ?? 32631),
      bbox: [bb[0], bb[1], bb[2], bb[3]],
      width, height,
      imagery_date: d ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day ?? 1).padStart(2, "0")}` : null,
      quality: layers.imageryQuality ?? null,
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
