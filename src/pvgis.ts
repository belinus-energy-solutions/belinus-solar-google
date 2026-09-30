// ============================================================
// PVGIS (EU Joint Research Centre) — grid-connected PV yield.
// Free, no API key. https://re.jrc.ec.europa.eu/api/v5_3/PVcalc
// Called once per roof segment that carries panels.
// ============================================================

const BASE = () => (Deno.env.get("PVGIS_BASE_URL") ?? "https://re.jrc.ec.europa.eu/api/v5_3").replace(/\/$/, "");

export type PvgisResult = {
  annual_kwh: number;       // E_y
  monthly_kwh: number[];    // E_m, Jan..Dec
};

/**
 * @param azimuthGoogle Google convention: 0 = north, 90 = east, 180 = south.
 * PVGIS "aspect": 0 = south, 90 = west, -90 = east.
 */
export async function pvcalc(opts: {
  lat: number; lng: number; kwp: number; pitch: number; azimuthGoogle: number; loss?: number;
}): Promise<PvgisResult> {
  let aspect = opts.azimuthGoogle - 180;
  if (aspect > 180) aspect -= 360;
  if (aspect < -180) aspect += 360;
  const u = new URL(`${BASE()}/PVcalc`);
  u.searchParams.set("lat", opts.lat.toFixed(5));
  u.searchParams.set("lon", opts.lng.toFixed(5));
  u.searchParams.set("peakpower", opts.kwp.toFixed(3));
  u.searchParams.set("loss", String(opts.loss ?? 14));
  u.searchParams.set("angle", Math.max(0, Math.min(90, opts.pitch)).toFixed(1));
  u.searchParams.set("aspect", aspect.toFixed(1));
  u.searchParams.set("outputformat", "json");

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(u.toString());
      if (res.status === 429 || res.status >= 500) throw new Error(`PVGIS ${res.status}`);
      const j = await res.json();
      if (!res.ok) throw { status: 502, body: { message: "PVGIS error", detail: j } };
      const fixed = j.outputs?.totals?.fixed;
      const months: any[] = j.outputs?.monthly?.fixed ?? [];
      if (!fixed) throw new Error("PVGIS: unexpected response");
      return {
        annual_kwh: Number(fixed.E_y),
        monthly_kwh: months.sort((a, b) => a.month - b.month).map((m) => Number(m.E_m)),
      };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw { status: 502, body: { message: "PVGIS unreachable", detail: String((lastErr as any)?.message ?? lastErr) } };
}
