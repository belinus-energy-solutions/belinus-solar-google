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
