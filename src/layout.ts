// ============================================================
// Panel layout engine — replaces Aurora's AI roof + AutoDesigner.
//
// Input: Google Solar API buildingInsights (roof segments + every possible
// panel slot with its yearly yield) and the geocoded address point.
// Output: a belinus panel layout an installer would draw:
//   1. only roof faces of THIS house — Google often returns a whole terrace
//      block, so slots further than MAX_DIST_M from the address point are
//      dropped (neighbours' roofs);
//   2. as few roof faces as possible — if one face can carry the whole
//      system it gets all panels;
//   3. compact blocks — within a face the panels form one cluster around
//      the best spot, never a scatter of single panels;
//   4. no face with fewer than MIN_PER_FACE panels (except a one-face system);
//   5. flat roofs slightly de-prioritised vs. a comparable pitched face.
// Capped by the customer's consumption target, the meter type
// (1-phase 5 kWp / 3-phase 10 kWp) and the roof area.
//
// Assumptions (override with env):
//   PANEL_WP 500 · PANEL_LENGTH_M 1.954 · PANEL_WIDTH_M 1.134
//   MIN_SLOT_YIELD 0.60   skip slots below 60% of the best slot's yield
//   MAX_DIST_M     9      max distance of a panel from the address point
//   MIN_PER_FACE   4      smallest group of panels worth putting on a face
//   FLAT_FACTOR    0.92   score multiplier for flat roofs (pitch < 10°)
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
  maxDist: () => num("MAX_DIST_M", 9),
  minPerFace: () => num("MIN_PER_FACE", 4),
  flatFactor: () => num("FLAT_FACTOR", 0.92),
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
  address_point: [number, number] | null;
};

type Slot = {
  seg: number; kwh: number; lat: number; lng: number; orientation: string;
  x: number; y: number; // metres east/north of the reference point
};

const M_PER_DEG = 111_320;

/** Panel rectangle projected on the ground (foreshortened along the slope). */
function panelPolygon(
  lat: number, lng: number, orientation: string, azimuth: number, pitch: number, gW: number, gH: number,
): Array<[number, number]> {
  // Portrait = long side up the slope. The along-slope side shrinks by cos(pitch)
  // when seen from above, which is how the satellite image shows the roof.
  const along = (orientation === "PORTRAIT" ? gH : gW) * Math.cos((pitch * Math.PI) / 180);
  const across = orientation === "PORTRAIT" ? gW : gH;
  const a = (azimuth * Math.PI) / 180;
  const u = [Math.sin(a), Math.cos(a)];                 // downslope (east, north)
  const v = [Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2)]; // across
  const cosLat = Math.cos((lat * Math.PI) / 180);
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([su, sv]) => {
    const e = (su * along / 2) * u[0] + (sv * across / 2) * v[0];
    const n = (su * along / 2) * u[1] + (sv * across / 2) * v[1];
    return [lat + n / M_PER_DEG, lng + e / (M_PER_DEG * cosLat)] as [number, number];
  });
}

/**
 * The k slots forming the best tidy block on one face: rows across the slope
 * are filled before starting a new row (distance along the slope counts
 * double), and compactness outweighs small yield differences between slots.
 */
function bestCluster(slots: Slot[], k: number, azimuthDeg: number): Slot[] {
  if (k >= slots.length) return slots.slice();
  const a = (azimuthDeg * Math.PI) / 180;
  const dist = (p: Slot, q: Slot) => {
    const dx = p.x - q.x, dy = p.y - q.y;
    const along = dx * Math.sin(a) + dy * Math.cos(a);   // up/down the slope
    const across = dx * Math.cos(a) - dy * Math.sin(a);  // along the row
    return Math.hypot(along * 2, across);
  };
  let best: Slot[] = [], bestScore = -Infinity;
  for (const seed of slots) {
    const pick = slots.map((s) => ({ s, d: dist(s, seed) })).sort((x, y) => x.d - y.d).slice(0, k);
    const score = pick.reduce((acc, p) => acc + p.s.kwh, 0) - pick.reduce((acc, p) => acc + p.d, 0) * 4;
    if (score > bestScore) { bestScore = score; best = pick.map((p) => p.s); }
  }
  return best;
}

export function designLayout(
  insights: any, targetKwh: number, capWp: number, address?: { lat: number; lng: number } | null,
): Layout {
  const sp = insights?.solarPotential;
  const rawSlots: any[] = sp?.solarPanels ?? [];
  const segs: any[] = sp?.roofSegmentStats ?? [];
  if (!sp || !rawSlots.length) {
    throw { status: 422, body: { message: "Geen geschikt dakvlak gevonden / no suitable roof surface found" } };
  }
  const gWatt = sp.panelCapacityWatts ?? 400;
  const gH = sp.panelHeightMeters ?? 1.879;
  const gW = sp.panelWidthMeters ?? 1.045;
  const wp = PANEL.wp();
  const scale = wp / gWatt;
  // Google slots are sized for its 400 W reference panel; belinus modules are
  // larger, so each face holds proportionally fewer of them.
  const areaRatio = (gH * gW) / (PANEL.length() * PANEL.width());
  const maxMeter = Math.floor(capWp / wp);

  const ref = address ?? { lat: insights.center?.latitude, lng: insights.center?.longitude };
  const cosLat = Math.cos((ref.lat * Math.PI) / 180);
  const toXY = (lat: number, lng: number) => ({
    x: (lng - ref.lng) * M_PER_DEG * cosLat, y: (lat - ref.lat) * M_PER_DEG,
  });

  // 1. own roof only + minimum yield
  const best = Math.max(...rawSlots.map((s) => s.yearlyEnergyDcKwh ?? 0));
  let slots: Slot[] = rawSlots.map((s) => ({
    seg: s.segmentIndex ?? 0, kwh: s.yearlyEnergyDcKwh ?? 0,
    lat: s.center.latitude, lng: s.center.longitude, orientation: s.orientation ?? "LANDSCAPE",
    ...toXY(s.center.latitude, s.center.longitude),
  })).filter((s) => s.kwh >= best * PANEL.minSlotYield());
  if (address) {
    const near = slots.filter((s) => Math.hypot(s.x, s.y) <= PANEL.maxDist());
    // Geocode landed off the roof (e.g. front garden): keep the faces closest to it.
    slots = near.length >= PANEL.minPerFace() ? near : slots.filter((s) => Math.hypot(s.x, s.y) <= PANEL.maxDist() * 1.6);
  }

  // 2. faces with their capacity in belinus modules
  const bySeg = new Map<number, Slot[]>();
  for (const s of slots) {
    if (!bySeg.has(s.seg)) bySeg.set(s.seg, []);
    bySeg.get(s.seg)!.push(s);
  }
  const faces = [...bySeg.entries()].map(([idx, list]) => {
    const st = segs[idx] ?? {};
    const pitch = st.pitchDegrees ?? 30;
    const cap = Math.max(0, Math.floor(list.length * areaRatio));
    const factor = pitch < 10 ? PANEL.flatFactor() : 1;
    return { idx, list, pitch, cap, factor, azimuth: st.azimuthDegrees ?? 180 };
  }).filter((f) => f.cap > 0);
  const maxRoof = faces.reduce((a, f) => a + f.cap, 0);
  if (!maxRoof) {
    throw { status: 422, body: { message: "Dak te klein voor zonnepanelen / roof too small for panels" } };
  }

  // 3. how many panels: target ÷ expected yield per panel on the best faces
  const perPanel = (f: { list: Slot[] }) =>
    (f.list.reduce((a, s) => a + s.kwh, 0) / f.list.length) * scale * DC_TO_AC;
  const avgPerPanel = faces.map(perPanel).sort((a, b) => b - a)[0];
  let wanted = Math.max(PANEL.minPerFace(), Math.ceil(targetKwh / avgPerPanel));
  let limited: Layout["limited_by"] = "target";
  if (wanted > maxMeter) { wanted = maxMeter; limited = "meter"; }
  if (wanted > maxRoof) { wanted = maxRoof; limited = "roof"; }

  // 4. one face if possible, else fill faces in order of quality
  const clusterScore = (f: typeof faces[number], k: number) => {
    const c = bestCluster(f.list, k, f.azimuth);
    return { c, score: (c.reduce((a, s) => a + s.kwh, 0) / c.length) * f.factor };
  };
  let chosen: Slot[] = [];
  const single = faces.filter((f) => f.cap >= wanted)
    .map((f) => ({ f, ...clusterScore(f, wanted) }))
    .sort((a, b) => b.score - a.score)[0];
  if (single) {
    chosen = single.c;
  } else {
    const ranked = faces.map((f) => ({ f, per: perPanel(f) * f.factor }))
      .sort((a, b) => b.per - a.per || b.f.cap - a.f.cap);
    let remaining = wanted;
    for (const { f } of ranked) {
      if (remaining <= 0) break;
      const k = Math.min(f.cap, remaining);
      if (k < PANEL.minPerFace() && chosen.length > 0) continue; // no stray 1–3 panel groups
      chosen.push(...bestCluster(f.list, k, f.azimuth));
      remaining -= k;
    }
    if (remaining > 0 && limited === "target") limited = "roof";
  }

  // 5. per-face summary (shading factor vs. the best spot of that face)
  const chosenBySeg = new Map<number, Slot[]>();
  for (const s of chosen) {
    if (!chosenBySeg.has(s.seg)) chosenBySeg.set(s.seg, []);
    chosenBySeg.get(s.seg)!.push(s);
  }
  const segments: Segment[] = [...chosenBySeg.entries()].map(([idx, list]) => {
    const st = segs[idx] ?? {};
    const dc = list.reduce((a, s) => a + s.kwh, 0);
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

  const est = chosen.reduce((a, s) => a + s.kwh * scale * DC_TO_AC, 0);
  const panels = chosen.map((s) => {
    const st = segs[s.seg] ?? {};
    return {
      segment_index: s.seg,
      kwh: Math.round(s.kwh * scale),
      poly: panelPolygon(s.lat, s.lng, s.orientation, st.azimuthDegrees ?? 180, st.pitchDegrees ?? 0, gW, gH),
    };
  });

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
    address_point: address ? [address.lat, address.lng] : null,
  };
}

/** Zoom level that frames the building with some margin in a 640 px tile. */
export function viewerZoom(insights: any): number {
  const bb = insights?.boundingBox;
  const lat = insights?.center?.latitude ?? 51;
  if (!bb?.sw || !bb?.ne) return 20;
  const dy = (bb.ne.latitude - bb.sw.latitude) * M_PER_DEG;
  const dx = (bb.ne.longitude - bb.sw.longitude) * M_PER_DEG * Math.cos((lat * Math.PI) / 180);
  const span = Math.max(dx, dy, 10) * 2.2;
  const z = Math.floor(Math.log2((156_543.03 * Math.cos((lat * Math.PI) / 180) * 640) / span));
  return Math.max(18, Math.min(21, z));
}
