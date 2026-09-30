import { designLayout, viewerZoom } from "../src/layout.ts";

// Synthetic gable roof in Antwerp: south face (seg 0) best, north face (seg 1) poor.
function fakeInsights() {
  const c = { latitude: 51.2194, longitude: 4.4025 };
  const panels = [];
  for (let i = 0; i < 24; i++) panels.push({ center: { latitude: c.latitude - 0.00002 + (i % 6) * 0.000001, longitude: c.longitude + (i % 6) * 0.00002 }, orientation: "PORTRAIT", segmentIndex: 0, yearlyEnergyDcKwh: 420 - i });
  for (let i = 0; i < 20; i++) panels.push({ center: { latitude: c.latitude + 0.00002, longitude: c.longitude + (i % 6) * 0.00002 }, orientation: "PORTRAIT", segmentIndex: 1, yearlyEnergyDcKwh: 220 - i });
  return {
    center: c,
    boundingBox: { sw: { latitude: c.latitude - 0.0001, longitude: c.longitude - 0.00015 }, ne: { latitude: c.latitude + 0.0001, longitude: c.longitude + 0.00015 } },
    solarPotential: {
      maxArrayPanelsCount: 44, panelCapacityWatts: 400, panelHeightMeters: 1.879, panelWidthMeters: 1.045,
      roofSegmentStats: [
        { pitchDegrees: 38, azimuthDegrees: 180, stats: { sunshineQuantiles: [700, 900, 1000, 1050, 1080, 1090, 1100, 1110, 1120, 1130, 1140] } },
        { pitchDegrees: 38, azimuthDegrees: 0, stats: { sunshineQuantiles: [300, 400, 500, 520, 540, 550, 560, 570, 580, 590, 600] } },
      ],
      solarPanels: panels,
    },
  };
}

Deno.test("meets target on the south face only", () => {
  const l = designLayout(fakeInsights(), 3500, 10000);
  console.log(l.panel_count, l.kwp, l.estimated_ac_kwh, l.limited_by, JSON.stringify(l.segments));
  if (l.estimated_ac_kwh < 3500) throw new Error("target not met");
  if (l.segments.some((s) => s.azimuth === 0)) throw new Error("north face used");
});
Deno.test("single-phase cap 5 kWp → max 10 panels", () => {
  const l = designLayout(fakeInsights(), 20000, 5000);
  console.log(l.panel_count, l.limited_by);
  if (l.panel_count !== 10 || l.limited_by !== "meter") throw new Error("cap not applied");
});
Deno.test("roof-limited", () => {
  const l = designLayout(fakeInsights(), 50000, 20000);
  console.log(l.panel_count, l.limited_by, l.max_panels_roof);
  if (l.limited_by !== "roof") throw new Error("expected roof limit");
});
Deno.test("zoom", () => { const z = viewerZoom(fakeInsights()); console.log("zoom", z); if (z < 18 || z > 21) throw 0; });

// Real roof (terraced house, Waasland): Google returns the whole block.
function terraced() {
  const d = JSON.parse(Deno.readTextFileSync(new URL("./fixtures/terraced-house.json", import.meta.url)));
  return {
    geo: { lat: d.geocode[0], lng: d.geocode[1] },
    ins: {
      center: { latitude: d.center[0], longitude: d.center[1] },
      boundingBox: { sw: { latitude: d.bbox[0][0], longitude: d.bbox[0][1] }, ne: { latitude: d.bbox[1][0], longitude: d.bbox[1][1] } },
      solarPotential: {
        panelHeightMeters: d.dims[0], panelWidthMeters: d.dims[1], panelCapacityWatts: d.dims[2], maxArrayPanelsCount: d.slots.length,
        roofSegmentStats: d.segs.map((s: any) => ({ pitchDegrees: s[1], azimuthDegrees: s[2], stats: { sunshineQuantiles: [s[4]] } })),
        solarPanels: d.slots.map((s: any) => ({ segmentIndex: s[0], yearlyEnergyDcKwh: s[1], orientation: s[2], center: { latitude: s[3], longitude: s[4] } })),
      },
    },
  };
}
Deno.test("terraced house: one face, compact, nothing on the neighbours' roofs", () => {
  const { ins, geo } = terraced();
  for (const [target, cap] of [[3500, 10000], [4500, 5000], [8000, 10000]]) {
    const l = designLayout(ins, target, cap, geo);
    if (l.segments.some((s) => s.panel_count < 4)) throw new Error("stray panels on a face");
    for (const p of l.panels) {
      const [la, ln] = [p.poly.reduce((a, q) => a + q[0], 0) / 4, p.poly.reduce((a, q) => a + q[1], 0) / 4];
      const dist = Math.hypot((la - geo.lat) * 111320, (ln - geo.lng) * 111320 * Math.cos(geo.lat * Math.PI / 180));
      if (dist > 10) throw new Error(`panel ${dist.toFixed(1)} m from the address`);
    }
    if (target <= 4500 && l.segments.length !== 1) throw new Error("small system split over faces");
  }
});

// ---- v3: oversizing, flat roof east–west, shading per position ----
function grid(seg: number, lat0: number, lng0: number, n: number, kwh: (i: number) => number, ori = "LANDSCAPE") {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ segmentIndex: seg, yearlyEnergyDcKwh: kwh(i), orientation: ori,
      center: { latitude: lat0 + Math.floor(i / 5) * 0.000012, longitude: lng0 + (i % 5) * 0.000017 } });
  }
  return out;
}
function houseWithFlatRoof(flatKwh: number, eastKwh: number) {
  const c = { latitude: 51.2, longitude: 4.4 };
  return {
    center: c,
    solarPotential: {
      panelCapacityWatts: 400, panelHeightMeters: 1.879, panelWidthMeters: 1.045,
      roofSegmentStats: [
        { pitchDegrees: 40, azimuthDegrees: 90 },   // east slope
        { pitchDegrees: 2, azimuthDegrees: 180 },   // flat rear extension
      ],
      solarPanels: [
        ...grid(0, c.latitude - 0.00002, c.longitude - 0.00003, 15, () => eastKwh),
        ...grid(1, c.latitude + 0.00001, c.longitude - 0.00003, 15, () => flatKwh),
      ],
    },
  };
}
const addr = { lat: 51.2, lng: 4.4 };
const yieldsEF = { 0: { kwh_per_kwp: 773, ref_irradiation: 900 }, 1: { kwh_per_kwp: 880, ref_irradiation: 1050 } };

Deno.test("oversize: fills to the DC limit, not to consumption", () => {
  const l = designLayout(houseWithFlatRoof(420, 360), 3000, 6500, addr, yieldsEF);
  if (l.panel_count !== 13) throw new Error(`expected 13 panels (6.5 kWp), got ${l.panel_count}`);
});
Deno.test("unshaded flat roof: east–west racks combined with the east slope", () => {
  const l = designLayout(houseWithFlatRoof(420, 360), 3000, 13000, addr, yieldsEF);
  const flat = l.segments.find((s) => s.flat);
  if (!flat) throw new Error("flat roof not used");
  if (flat.mount.azimuths.join() !== "90,270") throw new Error("flat roof not east–west");
  if (l.segments.length < 2) throw new Error("expected a combination of faces");
});
Deno.test("shaded flat roof is skipped", () => {
  // flat positions get 60% of the unshaded irradiation → value below MIN_VALUE
  const l = designLayout(houseWithFlatRoof(0.6 * 1050 * 0.4, 360), 3000, 6500, addr, yieldsEF);
  if (l.segments.some((s) => s.flat)) throw new Error("shaded flat roof used");
  if (l.segments[0].shade_factor < 0.95) throw new Error("unshaded east face reported as shaded");
});
