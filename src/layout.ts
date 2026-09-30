// ============================================================
// Panel layout engine — replaces Aurora's AI roof + AutoDesigner.
//
// Input: Google Solar API buildingInsights (roof segments + ranked panel
// slots, best-yield first). Output: the belinus panel layout that meets the
// customer's target consumption, capped by the meter type, drawn as polygons
// for the roof viewer.
//
// Assumptions (override with env):
//   PANEL_WP           500     belinus factory spec (pricing.ts)
//   PANEL_LENGTH_M     1.954   belinus 500 Wp back-contact module
//   PANEL_WIDTH_M      1.134
//   MIN_SLOT_YIELD     0.60    skip slots below 60% of the best slot's yield
//                               (poor north faces — Belgian installer practice)
// ============================================================

const num = (k: string, d: number) => {
  const v = Number(Deno.env.get(k));
  return Number.isFinite(v) && v > 0 ? v : d;
};

export const PANEL = {
  wp: () => num("PANEL_WP", 500),
  length: () => num("PANEL_LENGTH_M", 1.954),
  width: () => num("PANEL_WIDTH_M", 1.134),
  minSlotYield: () => num("MIN_SLOT_YIELD", 0.6),
};

const DC_TO_AC = 0.86; // sizing estimate only — final yield comes from PVGIS

export type Segment = {
  segment_index: number;
  pitch: number;
  azimuth: number;           // Google: 0 = N, 90 = E, 180 = S
  panel_count: number;
  kwp: number;
  shade_factor: number;      // Google shaded yield vs. best spot on that segment
  google_dc_kwh: number;     // Google estimate, scaled to belinus Wp
};

export type Layout = {
  panel_count: number;
  kwp: number;
  segments: Segment[];
  panels: Array<{ segment_index: number; poly: Array<[number, number]>; kwh: number }>;
  max_panels_roof: number;
  target_kwh: number;
  cap_wp: number;
  estimated_ac_kwh: number;
  limited_by: "target" | "roof" | "meter";
};

/** Offset a lat/lng by (east, north) metres — equirectangular, fine at roof scale. */
function offset(lat: number, lng: number, east: number, north: number): [number, number] {
  const dLat = north / 111_320;
  const dLng = east / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lat + dLat, lng + dLng];
}

/** Panel rectangle (ground projection), same maths as Google's Solar API demo. */
function panelPolygon(
  lat: number, lng: number, orientation: string, azimuth: number, gW: number, gH: number,
): Array<[number, number]> {
  const w = gW / 2, h = gH / 2;
  const pts = [[w, h], [w, -h], [-w, -h], [-w, h]];
  const rot = orientation === "PORTRAIT" ? 90 : 0;
  return pts.map(([x, y]) => {
    const d = Math.hypot(x, y);
    const heading = ((Math.atan2(y, x) * 180) / Math.PI + rot + azimuth) * (Math.PI / 180);
    return offset(lat, lng, d * Math.sin(heading), d * Math.cos(heading));
  });
}

export function designLayout(insights: any, targetKwh: number, capWp: number): Layout {
  const sp = insights?.solarPotential;
  const slots: any[] = sp?.solarPanels ?? [];
  const segs: any[] = sp?.roofSegmentStats ?? [];
  if (!sp || !slots.length) {
    throw { status: 422, body: { message: "Geen geschikt dakvlak gevonden / no suitable roof surface found" } };
  }
  const gWatt = sp.panelCapacityWatts ?? 400;
  const gH = sp.panelHeightMeters ?? 1.879;
  const gW = sp.panelWidthMeters ?? 1.045;
  const wp = PANEL.wp();
  const scale = wp / gWatt;

  // Google slots are sized for its reference panel; belinus modules are larger,
  // so the roof holds proportionally fewer of them.
  const areaRatio = (gH * gW) / (PANEL.length() * PANEL.width());
  const maxRoof = Math.max(0, Math.floor((sp.maxArrayPanelsCount ?? slots.length) * areaRatio));
  const maxMeter = Math.floor(capWp / wp);

  const best = Math.max(...slots.map((s) => s.yearlyEnergyDcKwh ?? 0));
  const usable = slots.filter((s) => (s.yearlyEnergyDcKwh ?? 0) >= best * PANEL.minSlotYield());
  const limit = Math.min(maxRoof, maxMeter, usable.length);

  const chosen: any[] = [];
  let est = 0;
  let limited: Layout["limited_by"] = "target";
  for (const s of usable) {
    if (chosen.length >= limit) {
      limited = limit === maxMeter ? "meter" : "roof";
      break;
    }
    chosen.push(s);
    est += (s.yearlyEnergyDcKwh ?? 0) * scale * DC_TO_AC;
    if (est >= targetKwh) break;
  }
  if (est < targetKwh && limited === "target") limited = chosen.length >= maxMeter ? "meter" : "roof";
  if (!chosen.length) {
    throw { status: 422, body: { message: "Dak te klein voor zonnepanelen / roof too small for panels" } };
  }

  const bySeg = new Map<number, any[]>();
  for (const s of chosen) {
    const k = s.segmentIndex ?? 0;
    if (!bySeg.has(k)) bySeg.set(k, []);
    bySeg.get(k)!.push(s);
  }

  const segments: Segment[] = [...bySeg.entries()].map(([idx, list]) => {
    const st = segs[idx] ?? {};
    const dc = list.reduce((a, s) => a + (s.yearlyEnergyDcKwh ?? 0), 0);
    const perKw = dc / list.length / (gWatt / 1000);
    const q: number[] = st.stats?.sunshineQuantiles ?? [];
    const peak = q.length ? q[q.length - 1] : 0;
    const shade = peak > 0 ? Math.min(1, Math.max(0.6, perKw / peak)) : 1;
    return {
      segment_index: idx,
      pitch: Number((st.pitchDegrees ?? 30).toFixed(1)),
      azimuth: Number((st.azimuthDegrees ?? 180).toFixed(1)),
      panel_count: list.length,
      kwp: (list.length * wp) / 1000,
      shade_factor: Number(shade.toFixed(3)),
      google_dc_kwh: Math.round(dc * scale),
    };
  }).sort((a, b) => b.panel_count - a.panel_count);

  const panels = chosen.map((s) => ({
    segment_index: s.segmentIndex ?? 0,
    kwh: Math.round((s.yearlyEnergyDcKwh ?? 0) * scale),
    poly: panelPolygon(
      s.center.latitude, s.center.longitude, s.orientation ?? "LANDSCAPE",
      segs[s.segmentIndex ?? 0]?.azimuthDegrees ?? 180, gW, gH,
    ),
  }));

  return {
    panel_count: chosen.length,
    kwp: (chosen.length * wp) / 1000,
    segments,
    panels,
    max_panels_roof: maxRoof,
    target_kwh: Math.round(targetKwh),
    cap_wp: capWp,
    estimated_ac_kwh: Math.round(est),
    limited_by: limited,
  };
}

/** Zoom level that frames the building with some margin in a 640 px tile. */
export function viewerZoom(insights: any): number {
  const bb = insights?.boundingBox;
  const lat = insights?.center?.latitude ?? 51;
  if (!bb?.sw || !bb?.ne) return 20;
  const dy = (bb.ne.latitude - bb.sw.latitude) * 111_320;
  const dx = (bb.ne.longitude - bb.sw.longitude) * 111_320 * Math.cos((lat * Math.PI) / 180);
  const span = Math.max(dx, dy, 10) * 2.2;
  const z = Math.floor(Math.log2((156_543.03 * Math.cos((lat * Math.PI) / 180) * 640) / span));
  return Math.max(18, Math.min(21, z));
}
