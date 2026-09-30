// ============================================================
// Panel layout engine — replaces Aurora's AI roof + AutoDesigner.
//
// Inputs
//   - Google Solar API buildingInsights: roof faces + every possible panel
//     position with its yearly irradiation (local shading included);
//   - PVGIS per roof face: AC yield per kWp and unshaded in-plane irradiation
//     (see faceYields in api.ts);
//   - the geocoded address point and the DC limit of the connection.
//
// Rules (what an installer would draw)
//   1. Own roof only: positions > MAX_DIST_M from the address point are
//      dropped (Google often returns a whole terraced block).
//   2. Shading counted per position: shade = Google irradiation on that spot
//      ÷ PVGIS unshaded irradiation for that face, calibrated on the least
//      shaded spots of the house (removes the climate-data bias between the
//      two sources). Value of a position = PVGIS kWh/kWp × shade × panel kWp.
//   3. Flat roofs are mounted east–west at FLAT_TILT° (Belgian standard):
//      dense, low wind load, and a production curve spread over the day.
//   4. Oversizing (default): fill up to the DC limit of the inverter
//      (1-phase 5 kVA / 3-phase 10 kVA × DC/AC ratio, sent by the frontend),
//      but only with positions worth ≥ MIN_VALUE × the best position.
//   5. Faces are filled best-value first, each as one compact block of tidy
//      rows; a face whose orientation adds to the daily spread (≥ 90° apart,
//      or an east–west flat roof) gets a SPREAD_BONUS in the ranking.
//   6. No face gets fewer than MIN_PER_FACE panels (except a one-face system).
//
// Env (defaults): PANEL_WP 500 · PANEL_LENGTH_M 1.954 · PANEL_WIDTH_M 1.134
//   MAX_DIST_M 9 · MIN_PER_FACE 4 · MIN_VALUE 0.7 · FLAT_TILT 12
//   FLAT_DENSITY 0.85 (edge set-backs on flat roofs) · SPREAD_BONUS 0.05
//   OVERSIZE 1 (0 = size to consumption instead)
// ============================================================

const num = (k: string, d: number) => {
  const raw = Deno.env.get(k);
  if (raw === undefined || raw.trim() === "") return d;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : d;
};

export const PANEL = {
  wp: () => num("PANEL_WP", 500),
  length: () => num("PANEL_LENGTH_M", 1.954),
  width: () => num("PANEL_WIDTH_M", 1.134),
  maxDist: () => num("MAX_DIST_M", 9),
  minPerFace: () => num("MIN_PER_FACE", 4),
  minValue: () => num("MIN_VALUE", 0.7),
  flatTilt: () => num("FLAT_TILT", 12),
  flatDensity: () => num("FLAT_DENSITY", 0.85),
  spreadBonus: () => num("SPREAD_BONUS", 0.05),
  oversize: () => num("OVERSIZE", 1) > 0,
};

export const FLAT_PITCH = 10; // faces flatter than this are treated as flat roofs

/** How a face is mounted: pitched = on the roof plane; flat = east–west racks. */
export type Mount = { tilt: number; azimuths: number[] };

/** PVGIS result per mount orientation, 1 kWp. */
export type FaceYield = {
  kwh_per_kwp: number;       // AC, incl. system losses (mount orientation)
  ref_irradiation: number;   // unshaded in-plane irradiation of the plane Google models
};

export type Segment = {
  segment_index: number;
  pitch: number;
  azimuth: number;           // Google: 0 = N, 90 = E, 180 = S
  flat: boolean;
  mount: Mount;
  panel_count: number;
  kwp: number;
  shade_factor: number;      // mean shading of the chosen positions (1 = unshaded)
  kwh_per_kwp: number;       // PVGIS yield of the mount orientation
  expected_kwh: number;      // kWp × kwh_per_kwp × shade
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
  oversized: boolean;
  address_point: [number, number] | null;
};

type Slot = {
  seg: number; kwh: number; lat: number; lng: number; orientation: string;
  x: number; y: number;      // metres east/north of the reference point
  shade: number; value: number; // value = expected AC kWh for one belinus panel
};

const M_PER_DEG = 111_320;

/** Mount used for a Google roof face. */
export function faceMount(seg: any): Mount {
  const pitch = seg?.pitchDegrees ?? 30;
  if (pitch < FLAT_PITCH) return { tilt: PANEL.flatTilt(), azimuths: [90, 270] };
  return { tilt: pitch, azimuths: [seg?.azimuthDegrees ?? 180] };
}

/** Faces that can carry panels for this address (before PVGIS). */
export function reachableFaces(insights: any, address?: { lat: number; lng: number } | null): number[] {
  const sp = insights?.solarPotential;
  const ref = address ?? { lat: insights?.center?.latitude, lng: insights?.center?.longitude };
  const cosLat = Math.cos((ref.lat * Math.PI) / 180);
  const set = new Set<number>();
  for (const s of sp?.solarPanels ?? []) {
    const d = Math.hypot((s.center.longitude - ref.lng) * M_PER_DEG * cosLat, (s.center.latitude - ref.lat) * M_PER_DEG);
    if (!address || d <= PANEL.maxDist()) set.add(s.segmentIndex ?? 0);
  }
  return [...set];
}

/** Panel rectangle projected on the ground (foreshortened along the slope). */
function panelPolygon(
  lat: number, lng: number, orientation: string, azimuth: number, pitch: number, gW: number, gH: number,
): Array<[number, number]> {
  const along = (orientation === "PORTRAIT" ? gH : gW) * Math.cos((pitch * Math.PI) / 180);
  const across = orientation === "PORTRAIT" ? gW : gH;
  const a = (azimuth * Math.PI) / 180;
  const u = [Math.sin(a), Math.cos(a)];
  const v = [Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2)];
  const cosLat = Math.cos((lat * Math.PI) / 180);
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([su, sv]) => {
    const e = (su * along / 2) * u[0] + (sv * across / 2) * v[0];
    const n = (su * along / 2) * u[1] + (sv * across / 2) * v[1];
    return [lat + n / M_PER_DEG, lng + e / (M_PER_DEG * cosLat)] as [number, number];
  });
}

/** k positions forming the most valuable tidy block on one face (rows first). */
function bestCluster(slots: Slot[], k: number, azimuthDeg: number): Slot[] {
  if (k >= slots.length) return slots.slice();
  const a = (azimuthDeg * Math.PI) / 180;
  const dist = (p: Slot, q: Slot) => {
    const dx = p.x - q.x, dy = p.y - q.y;
    const along = dx * Math.sin(a) + dy * Math.cos(a);
    const across = dx * Math.cos(a) - dy * Math.sin(a);
    return Math.hypot(along * 2, across);
  };
  let best: Slot[] = [], bestScore = -Infinity;
  for (const seed of slots) {
    const pick = slots.map((s) => ({ s, d: dist(s, seed) })).sort((x, y) => x.d - y.d).slice(0, k);
    // value (kWh) first; compactness breaks ties between similar positions
    const score = pick.reduce((acc, p) => acc + p.s.value, 0) - pick.reduce((acc, p) => acc + p.d, 0) * 4;
    if (score > bestScore) { bestScore = score; best = pick.map((p) => p.s); }
  }
  return best;
}

const angleDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * @param yields PVGIS per face: key = segment index. When missing (tests,
 *   PVGIS down) a generic Belgian orientation model is used.
 */
export function designLayout(
  insights: any, targetKwh: number, capWp: number,
  address?: { lat: number; lng: number } | null,
  yields?: Record<number, FaceYield>,
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
  const areaRatio = (gH * gW) / (PANEL.length() * PANEL.width());
  const maxMeter = Math.floor(capWp / wp);

  const ref = address ?? { lat: insights.center?.latitude, lng: insights.center?.longitude };
  const cosLat = Math.cos((ref.lat * Math.PI) / 180);
  const toXY = (lat: number, lng: number) => ({
    x: (lng - ref.lng) * M_PER_DEG * cosLat, y: (lat - ref.lat) * M_PER_DEG,
  });

  const yieldOf = (idx: number): FaceYield => yields?.[idx] ?? genericYield(segs[idx]);

  // 1. own roof only
  let raw = rawSlots.map((s) => ({
    seg: s.segmentIndex ?? 0, kwh: s.yearlyEnergyDcKwh ?? 0,
    lat: s.center.latitude, lng: s.center.longitude, orientation: s.orientation ?? "LANDSCAPE",
    ...toXY(s.center.latitude, s.center.longitude),
  }));
  if (address) {
    const near = raw.filter((s) => Math.hypot(s.x, s.y) <= PANEL.maxDist());
    raw = near.length >= PANEL.minPerFace() ? near : raw.filter((s) => Math.hypot(s.x, s.y) <= PANEL.maxDist() * 1.6);
  }

  // 2. shading per position, calibrated on the least-shaded spots of the house
  const ratio = (s: { seg: number; kwh: number }) => {
    const refIrr = yieldOf(s.seg).ref_irradiation;
    return refIrr > 0 ? (s.kwh / (gWatt / 1000)) / refIrr : 1;
  };
  const ratios = raw.map(ratio).sort((a, b) => a - b);
  const p95 = ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * 0.95))] ?? 1;
  const calib = Math.max(0.85, Math.min(1.2, p95));
  let slots: Slot[] = raw.map((s) => {
    const shade = Math.max(0.3, Math.min(1, ratio(s) / calib));
    return { ...s, shade, value: (wp / 1000) * yieldOf(s.seg).kwh_per_kwp * shade };
  });
  const bestValue = Math.max(...slots.map((s) => s.value));
  slots = slots.filter((s) => s.value >= bestValue * PANEL.minValue());

  // 3. faces with their capacity in belinus modules
  const bySeg = new Map<number, Slot[]>();
  for (const s of slots) {
    if (!bySeg.has(s.seg)) bySeg.set(s.seg, []);
    bySeg.get(s.seg)!.push(s);
  }
  const faces = [...bySeg.entries()].map(([idx, list]) => {
    const st = segs[idx] ?? {};
    const flat = (st.pitchDegrees ?? 30) < FLAT_PITCH;
    const cap = Math.max(0, Math.floor(list.length * areaRatio * (flat ? PANEL.flatDensity() : 1)));
    const mean = list.reduce((a, s) => a + s.value, 0) / list.length;
    return { idx, list, flat, cap, mean, azimuth: st.azimuthDegrees ?? 180, mount: faceMount(st) };
  }).filter((f) => f.cap > 0);
  const maxRoof = faces.reduce((a, f) => a + f.cap, 0);
  if (Deno.env.get("LAYOUT_DEBUG")) console.error(JSON.stringify(faces.map((f) => ({ i: f.idx, flat: f.flat, n: f.list.length, cap: f.cap, mean: Math.round(f.mean), shade: +(f.list.reduce((a, s) => a + s.shade, 0) / f.list.length).toFixed(2) }))), "calib", calib.toFixed(3), "best", Math.round(bestValue));
  if (!maxRoof) {
    throw { status: 422, body: { message: "Dak te klein voor zonnepanelen / roof too small for panels" } };
  }

  // 4. how many panels
  const oversize = PANEL.oversize();
  const bestMean = Math.max(...faces.map((f) => f.mean));
  let wanted = oversize ? maxMeter : Math.max(PANEL.minPerFace(), Math.ceil(targetKwh / bestMean));
  let limited: Layout["limited_by"] = oversize ? "meter" : "target";
  if (wanted > maxMeter) { wanted = maxMeter; limited = "meter"; }
  if (wanted > maxRoof) { wanted = maxRoof; limited = "roof"; }

  // 5. fill faces best-value first; orientations that spread the day get a bonus
  const alloc = new Map<number, number>(); // face idx → panels
  const used: typeof faces = [];
  let remaining = wanted;
  const pool = faces.slice();
  while (remaining > 0 && pool.length) {
    const score = (f: typeof faces[number]) => {
      if (!used.length) return f.mean;
      const spreads = f.flat || used.every((u) => !u.flat && angleDiff(u.azimuth, f.azimuth) >= 90);
      const alreadyFlat = f.flat && used.some((u) => u.flat);
      return f.mean * (spreads && !alreadyFlat ? 1 + PANEL.spreadBonus() : 1);
    };
    pool.sort((a, b) => score(b) - score(a) || b.cap - a.cap);
    const f = pool.shift()!;
    let k = Math.min(f.cap, remaining);
    const minF = PANEL.minPerFace();
    if (k < minF && used.length > 0) {
      // Too few left for a group of their own: borrow from a face already used
      // so this face gets a proper group (e.g. 11 + 2 → 9 + 4).
      const need = minF - k;
      const donor = used.slice().reverse().find((u) => (alloc.get(u.idx) ?? 0) - need >= minF);
      if (!donor || f.cap < minF) continue;
      alloc.set(donor.idx, (alloc.get(donor.idx) ?? 0) - need);
      remaining += need;
      k = minF;
    }
    alloc.set(f.idx, k);
    used.push(f);
    remaining -= k;
  }
  if (remaining > 0) limited = "roof";
  const chosen: Slot[] = [];
  for (const f of used) chosen.push(...bestCluster(f.list, alloc.get(f.idx) ?? 0, f.azimuth));

  // 6. per-face summary
  const chosenBySeg = new Map<number, Slot[]>();
  for (const s of chosen) {
    if (!chosenBySeg.has(s.seg)) chosenBySeg.set(s.seg, []);
    chosenBySeg.get(s.seg)!.push(s);
  }
  const segments: Segment[] = [...chosenBySeg.entries()].map(([idx, list]) => {
    const st = segs[idx] ?? {};
    const mount = faceMount(st);
    const kwp = (list.length * wp) / 1000;
    const shade = list.reduce((a, s) => a + s.shade, 0) / list.length;
    const y = yieldOf(idx);
    return {
      segment_index: idx,
      pitch: Number((st.pitchDegrees ?? 30).toFixed(1)),
      azimuth: Number((st.azimuthDegrees ?? 180).toFixed(1)),
      flat: (st.pitchDegrees ?? 30) < FLAT_PITCH,
      mount,
      panel_count: list.length,
      kwp,
      shade_factor: Number(shade.toFixed(3)),
      kwh_per_kwp: Math.round(y.kwh_per_kwp),
      expected_kwh: Math.round(kwp * y.kwh_per_kwp * shade),
    };
  }).sort((a, b) => b.panel_count - a.panel_count);

  const panels = chosen.map((s) => {
    const st = segs[s.seg] ?? {};
    return {
      segment_index: s.seg,
      kwh: Math.round(s.value),
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
    estimated_ac_kwh: Math.round(chosen.reduce((a, s) => a + s.value, 0)),
    limited_by: limited,
    oversized: oversize,
    address_point: address ? [address.lat, address.lng] : null,
  };
}

/**
 * Fallback when PVGIS is unavailable: Belgian orientation model fitted on
 * PVGIS (≈ 1,000 kWh/kWp at 35° south, 870 flat, 780 east/west at 40°).
 */
export function genericYield(seg: any): FaceYield {
  const m = faceMount(seg);
  const f = (tilt: number, az: number) => {
    const t = Math.min(60, tilt);
    return 0.87 + 0.005675 * t * Math.cos(((az - 180) * Math.PI) / 180) - 0.000056 * t * t;
  };
  const kwh = 1000 * m.azimuths.reduce((a, az) => a + f(m.tilt, az), 0) / m.azimuths.length;
  const pitch = seg?.pitchDegrees ?? 30;
  // irradiation of the plane Google models (flat roofs: horizontal), ≈ yield / 0.86 PR
  const ref = (1000 * f(pitch < FLAT_PITCH ? 0 : pitch, seg?.azimuthDegrees ?? 180)) / 0.86;
  return { kwh_per_kwp: kwh, ref_irradiation: ref };
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
