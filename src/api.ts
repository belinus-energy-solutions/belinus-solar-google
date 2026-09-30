// ============================================================
// Belinus Solar — custom stack API (Google Solar API + PVGIS)
// Drop-in replacement for the Aurora-based Supabase edge function
// "solar": same routes, same request/response shapes, so the
// customer-facing flow is identical.
//
// Aurora step            → custom stack
//   start (project)      → Google Geocoding + solar_designs row
//   design-status        → imagery/geocode ready
//   ai-roof              → Google Solar API buildingInsights
//   autodesigner         → layout.ts (ranked Google panel slots)
//   cad-url (3D iframe)  → /roof-viewer.html (Solar API orthophoto + panels)
//   simulation           → PVGIS PVcalc per roof segment
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_API_KEY,
//      ALLOWED_ORIGINS (default *), PVGIS_BASE_URL (opt), LOGO_URL (opt)
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { batteryOptions, computeQuote, PRICING } from "./pricing.ts";
import { generateOffertePdf } from "./offerte-pdf.ts";
import { generateReceiptPdf } from "./receipt-pdf.ts";
import { buildingInsights, geocode, googleConfigured, roofOrthophoto, staticSatellite } from "./google.ts";
import { pvcalc } from "./pvgis.ts";
import { designLayout, type FaceYield, faceMount, PANEL, reachableFaces, viewerZoom } from "./layout.ts";

const SOURCE = "google";
const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ?? "*").split(",").map((s) => s.trim());

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "http://localhost",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "missing",
  { auth: { persistSession: false } },
);

function corsHeaders(origin: string | null) {
  const allow = ALLOWED.includes("*")
    ? "*"
    : (origin && ALLOWED.includes(origin) ? origin : ALLOWED[0] ?? "");
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Content-Type": "application/json",
  };
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers });
}

// ---- Simple in-memory rate limit (per container) ----
const hits = new Map<string, { n: number; t: number }>();
function rateLimited(ip: string, max = 120, windowMs = 60_000): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > windowMs) {
    hits.set(ip, { n: 1, t: now });
    return false;
  }
  h.n++;
  return h.n > max;
}

// ---- solar_designs helpers ----
async function getDesign(id: string | null) {
  if (!id) throw { status: 400, body: { message: "design_id required" } };
  const { data, error } = await supabase.from("solar_designs").select("*").eq("id", id).single();
  if (error || !data) throw { status: 404, body: { message: "Design not found" } };
  return data as Record<string, any>;
}
async function patchDesign(id: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from("solar_designs")
    .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw { status: 500, body: { message: error.message } };
}

/**
 * PVGIS per reachable roof face: AC yield per kWp of the way it will be
 * mounted (flat roofs: east–west racks) and the unshaded irradiation of the
 * plane Google measured (flat roofs: horizontal) — the reference for shading.
 * Falls back to the generic model per face if PVGIS is unreachable.
 */
async function faceYields(ins: any, lat: number, lng: number, address: { lat: number; lng: number }) {
  const segs: any[] = ins?.solarPotential?.roofSegmentStats ?? [];
  const out: Record<number, FaceYield> = {};
  const cache = new Map<string, Promise<{ annual_kwh: number; irradiation_kwh_m2: number }>>();
  const call = (tilt: number, az: number) => {
    const key = `${Math.round(tilt)}:${Math.round(az / 5) * 5}`;
    if (!cache.has(key)) cache.set(key, pvcalc({ lat, lng, kwp: 1, pitch: tilt, azimuthGoogle: az }));
    return cache.get(key)!;
  };
  await Promise.all(reachableFaces(ins, address).map(async (idx) => {
    const st = segs[idx] ?? {};
    const m = faceMount(st);
    try {
      const mounts = await Promise.all(m.azimuths.map((az) => call(m.tilt, az)));
      const plane = (st.pitchDegrees ?? 30) < 10
        ? await call(0, 180)
        : mounts[0];
      out[idx] = {
        kwh_per_kwp: mounts.reduce((a, r) => a + r.annual_kwh, 0) / mounts.length,
        ref_irradiation: plane.irradiation_kwh_m2,
      };
    } catch (e) {
      console.error("PVGIS face yield failed, generic model used:", String((e as any)?.body?.message ?? e));
    }
  }));
  return out;
}

// Satellite tiles are immutable per design — cache in memory.
const tileCache = new Map<string, Uint8Array>();

// Long-running steps run as background "jobs" so the frontend keeps the same
// run → poll status pattern it used with Aurora.
function job(id: string, field: "roof_status" | "layout_status" | "sim_status", work: () => Promise<Record<string, unknown>>) {
  (async () => {
    try {
      const patch = await work();
      await patchDesign(id, { ...patch, [field]: "succeeded" });
    } catch (e: any) {
      console.error(`${field} failed:`, JSON.stringify(e?.body ?? e?.message ?? e));
      await patchDesign(id, {
        [field]: "failed",
        last_error: typeof e?.body?.message === "string" ? e.body.message : String(e?.message ?? "failed"),
      }).catch(() => {});
    }
  })();
}

export async function handleApi(req: Request, route: string): Promise<Response> {
  const headers = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) return json({ error: "Too many requests" }, 429, headers);

  const url = new URL(req.url);
  const q = url.searchParams;

  try {
    const body = req.method === "GET" ? {} : await req.json().catch(() => ({}));

    switch (`${req.method} ${route}`) {
      // ---------- Diagnostics ----------
      case "GET health": {
        return json({
          engine: "google-solar+pvgis",
          google_key_set: googleConfigured(),
          supabase_set: !!Deno.env.get("SUPABASE_URL") && !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
          panel: { wp: PANEL.wp(), length_m: PANEL.length(), width_m: PANEL.width() },
          allowed_origins: ALLOWED,
        }, 200, headers);
      }

      // ---------- Phase 1: site & roof ----------
      case "POST start": {
        const { street, city, postal_code } = body;
        if (!street || !city || !postal_code) {
          return json({ error: "street, city and postal_code are required" }, 400, headers);
        }
        const address = `${street}, ${city}, ${postal_code}`;
        const g = await geocode(`${street}, ${postal_code} ${city}`);

        const { data: lead, error: le } = await supabase.from("leads")
          .insert({ address, source: SOURCE }).select("id").single();
        if (le) throw { status: 500, body: { message: le.message } };

        const { data: d, error: de } = await supabase.from("solar_designs").insert({
          lead_id: lead.id, address, formatted_address: g.formatted_address,
          lat: g.latitude, lng: g.longitude, geocode_type: g.location_type,
        }).select("id").single();
        if (de) throw { status: 500, body: { message: de.message } };
        await supabase.from("leads").update({ solar_design_id: d.id }).eq("id", lead.id);

        // project_id and design_id are the same record in this stack.
        return json({ project_id: d.id, design_id: d.id, lead_id: lead.id }, 200, headers);
      }

      case "POST lead": {
        // Lead without a design (customer already has panels).
        const { data: lead } = await supabase.from("leads").insert({
          address: body.address ?? null, source: SOURCE,
        }).select("id").single();
        return json({ lead_id: lead?.id }, 200, headers);
      }

      case "GET design-status": {
        const d = await getDesign(q.get("design_id"));
        return json({ ready: d.lat != null && d.lng != null, image_src: "google", lidar_src: "google" }, 200, headers);
      }

      case "POST ai-roof/run": {
        const d = await getDesign(body.design_id);
        await patchDesign(d.id, { roof_status: "running" });
        job(d.id, "roof_status", async () => {
          const ins = await buildingInsights({ latitude: d.lat, longitude: d.lng });
          // True-ortho aerial image for the roof viewer (the Maps Static tile is
          // not orthorectified: roofs lean and panels would look misplaced).
          let roof_image: Record<string, unknown> | null = null;
          try {
            const bb = ins.boundingBox;
            const half = bb ? Math.hypot(
              (bb.ne.latitude - bb.sw.latitude) * 111_320,
              (bb.ne.longitude - bb.sw.longitude) * 111_320 * Math.cos((d.lat * Math.PI) / 180),
            ) / 2 : 20;
            const radius = Math.max(20, Math.min(50, half + 10));
            const c = ins.center ?? { latitude: d.lat, longitude: d.lng };
            const img = await roofOrthophoto(c.latitude, c.longitude, radius);
            const path = `${d.id}.png`;
            const { error: ue } = await supabase.storage.from("roof-images")
              .upload(path, img.png, { contentType: "image/png", upsert: true });
            if (ue) throw ue;
            roof_image = { ...img.meta, path };
          } catch (e: any) {
            console.error("orthophoto failed, falling back to Maps Static:", JSON.stringify(e?.body ?? e?.message ?? e));
          }
          return {
            insights: ins,
            roof_image,
            imagery_date: ins.imageryDate
              ? `${ins.imageryDate.year}-${String(ins.imageryDate.month).padStart(2, "0")}-${String(ins.imageryDate.day ?? 1).padStart(2, "0")}`
              : null,
            imagery_quality: ins.imageryQuality ?? null,
          };
        });
        return json({ job_id: `roof-${d.id}`, status: "running" }, 200, headers);
      }

      case "GET ai-roof/status": {
        const d = await getDesign(q.get("design_id"));
        return json({ status: d.roof_status ?? "queued", error: d.roof_status === "failed" ? d.last_error : null }, 200, headers);
      }

      // ---------- Phase 2: consumption, layout, simulation ----------
      case "PUT consumption": {
        const { project_id, annual_kwh } = body;
        const profile = [0.105, 0.095, 0.09, 0.08, 0.07, 0.065, 0.065, 0.065, 0.075, 0.085, 0.095, 0.11];
        const monthly = profile.map((f) => Math.round(annual_kwh * f));
        monthly[0] += Math.round(annual_kwh) - monthly.reduce((a, b) => a + b, 0);
        if (project_id) await patchDesign(project_id, { annual_kwh: Math.round(annual_kwh), monthly_consumption: monthly });
        return json({ ok: true, monthly_energy: monthly }, 200, headers);
      }

      case "POST autodesigner/run": {
        const d = await getDesign(body.design_id);
        if (!d.insights) throw { status: 409, body: { message: "Roof analysis not finished" } };
        const capWp = Number(body.cap_wp) > 0 ? Number(body.cap_wp) : PRICING.phase_limits_wp.three;
        await patchDesign(d.id, { layout_status: "running" });
        job(d.id, "layout_status", async () => {
          const address = { lat: d.lat, lng: d.lng };
          const yields = await faceYields(d.insights, d.lat, d.lng, address);
          const layout = designLayout(d.insights, Number(body.target_kwh) || 3500, capWp, address, yields);
          return { layout, panel_count: layout.panel_count, kwp: layout.kwp, target_kwh: layout.target_kwh };
        });
        return json({ job_id: `layout-${d.id}`, components_used: { solar_panels: [`belinus ${PANEL.wp()} Wp`] } }, 200, headers);
      }

      case "GET autodesigner/status": {
        const d = await getDesign(q.get("design_id"));
        return json({ status: d.layout_status ?? "queued", error: d.layout_status === "failed" ? d.last_error : null }, 200, headers);
      }

      case "POST cad-url": {
        // Same-origin viewer page (replaces Aurora's CAD iframe share).
        const d = await getDesign(body.design_id);
        return json({ url: `/roof-viewer.html?design_id=${d.id}` }, 200, headers);
      }

      case "POST simulation/run": {
        const d = await getDesign(body.design_id);
        if (!d.layout) throw { status: 409, body: { message: "Layout not finished" } };
        await patchDesign(d.id, { sim_status: "running" });
        job(d.id, "sim_status", async () => {
          // One PVGIS run per face and mount orientation (flat roofs: half east,
          // half west), multiplied by the face's shading factor.
          const segs = d.layout.segments as any[];
          const perSeg = await Promise.all(segs.map(async (s) => {
            const mount = s.mount ?? { tilt: s.pitch, azimuths: [s.azimuth] };
            const parts = await Promise.all(mount.azimuths.map((az: number) =>
              pvcalc({ lat: d.lat, lng: d.lng, kwp: s.kwp / mount.azimuths.length, pitch: mount.tilt, azimuthGoogle: az })
            ));
            const pv = parts.reduce((a, r) => a + r.annual_kwh, 0);
            const monthly = Array.from({ length: 12 }, (_, m) => parts.reduce((a, r) => a + (r.monthly_kwh[m] ?? 0), 0) * s.shade_factor);
            return {
              segment_index: s.segment_index, kwp: s.kwp, flat: !!s.flat, mount,
              pvgis_kwh: Math.round(pv), shade_factor: s.shade_factor,
              kwh: Math.round(pv * s.shade_factor), monthly,
            };
          }));
          const monthly = Array.from({ length: 12 }, (_, m) => Math.round(perSeg.reduce((a, s) => a + s.monthly[m], 0)));
          const annual = perSeg.reduce((a, s) => a + s.kwh, 0);
          return {
            production: {
              annual_kwh: annual, monthly_kwh: monthly,
              segments: perSeg.map(({ monthly: _m, ...rest }) => rest),
              source: "PVGIS v5.3 × Google shading per panel position",
            },
            annual_production_kwh: annual,
          };
        });
        return json({ job_id: `sim-${d.id}` }, 200, headers);
      }

      case "GET simulation/status": {
        const d = await getDesign(q.get("design_id"));
        return json({ status: d.sim_status ?? "queued", error: d.sim_status === "failed" ? d.last_error : null }, 200, headers);
      }

      case "GET summary": {
        const d = await getDesign(q.get("design_id"));
        return json({ layout: d.layout, production: d.production, imagery_date: d.imagery_date }, 200, headers);
      }

      // ---------- Roof viewer data ----------
      case "GET design": {
        const d = await getDesign(q.get("design_id"));
        const ins = d.insights ?? {};
        return json({
          center: { lat: ins.center?.latitude ?? d.lat, lng: ins.center?.longitude ?? d.lng },
          zoom: viewerZoom(ins),
          address: d.formatted_address ?? d.address,
          imagery_date: d.imagery_date, imagery_quality: d.imagery_quality,
          panel_count: d.layout?.panel_count ?? 0, kwp: d.layout?.kwp ?? 0,
          segments: d.layout?.segments ?? [],
          panels: d.layout?.panels ?? [],
          address_point: d.layout?.address_point ?? [d.lat, d.lng],
          roof_image: d.roof_image ?? null, // set → image is a UTM orthophoto (see utm.js)
          production: d.production ?? null,
        }, 200, headers);
      }

      case "GET roof-image": {
        const d = await getDesign(q.get("design_id"));
        if (d.roof_image?.path) {
          const { data: blob, error } = await supabase.storage.from("roof-images").download(d.roof_image.path);
          if (!error && blob) {
            return new Response(blob, {
              status: 200,
              headers: { ...headers, "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
            });
          }
        }
        const ins = d.insights ?? {};
        const lat = ins.center?.latitude ?? d.lat, lng = ins.center?.longitude ?? d.lng;
        const zoom = viewerZoom(ins);
        const key = `${d.id}:${zoom}`;
        let png = tileCache.get(key);
        if (!png) {
          png = await staticSatellite(lat, lng, zoom);
          if (tileCache.size > 500) tileCache.clear();
          tileCache.set(key, png);
        }
        return new Response(png as unknown as BodyInit, {
          status: 200,
          headers: { ...headers, "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
        });
      }

      // ---------- Quote & order ----------
      case "GET pricing-options": {
        return json({
          battery_options: batteryOptions(),
          vat_rate: PRICING.vat_rate_kit,
          deposit_rate: PRICING.deposit_rate,
          ev: {
            charger_price: PRICING.ev.charger_price,
            default_annual_kwh: PRICING.ev.default_annual_kwh,
          },
          phase_limits_wp: PRICING.phase_limits_wp,
          yield_kwh_per_kwp: PRICING.yield_kwh_per_kwp,
        }, 200, headers);
      }

      case "POST quote": {
        const { design_id, lead_id, annual_consumption_kwh, battery_modules, phase, ev_present, ev_add_charger, ev_annual_kwh, ev_company, existing_panels, existing_wp, catalog } = body;

        let system_kwp: number;
        let annual_production: number;
        let panel_count: number | null = null;

        if (existing_panels) {
          system_kwp = (existing_wp ?? 0) / 1000;
          annual_production = system_kwp * PRICING.yield_kwh_per_kwp;
        } else {
          const d = await getDesign(design_id);
          if (!d.layout || !d.production) throw { status: 409, body: { message: "Design not complete" } };
          system_kwp = d.layout.kwp;
          annual_production = d.production.annual_kwh;
          panel_count = d.layout.panel_count;
        }

        const quote = computeQuote({
          system_kwp,
          annual_production_kwh: annual_production,
          annual_consumption_kwh: annual_consumption_kwh ?? annual_production,
          battery_modules: battery_modules ?? null,
          phase: phase === "single" ? "single" : "three",
          panel_count: panel_count ?? undefined,
          ev_present: !!ev_present,
          ev_add_charger: !!ev_add_charger,
          ev_annual_kwh: ev_annual_kwh ?? undefined,
          ev_company: !!ev_company,
          existing_panels: !!existing_panels,
          catalog: catalog === "new" ? "new" : "stock",
        });

        const reference =
          (existing_panels
            ? `Bestaande zonnepanelen ${quote.system.kwp} kWp`
            : `Zonnepanelen ${quote.system.kwp} kWp`) +
          (quote.system.battery.kwh
            ? ` + ${quote.system.battery.product} ${quote.system.battery.kwh} kWh`
            : "") +
          (quote.system.ev_charger ? " + EV laadpaal" : "");

        const { data: row, error: qe } = await supabase.from("quotes").insert({
          lead_id: lead_id ?? null,
          solar_design_id: existing_panels ? null : design_id,
          source: SOURCE,
          system_kwp,
          annual_production_kwh: annual_production,
          annual_consumption_kwh: annual_consumption_kwh ?? null,
          battery_kwh: quote.system.battery.kwh,
          total_incl_vat: quote.price.total_incl_vat,
          customer_ref: reference,
          quote_json: quote,
        }).select("id, quote_number").single();
        if (qe) throw { status: 500, body: { message: qe.message } };

        return json({ quote_id: row?.id, quote_number: row?.quote_number, ...quote }, 200, headers);
      }

      case "GET scans": {
        // Admin/testing: previous scans of THIS stack only.
        const { data } = await supabase.from("quotes")
          .select("id, quote_number, created_at, total_incl_vat, customer_ref, leads(address)")
          .eq("source", SOURCE)
          .order("created_at", { ascending: false }).limit(100);
        return json({
          scans: (data ?? []).map((r: any) => ({
            quote_id: r.id, quote_number: r.quote_number, created_at: r.created_at,
            total_incl_vat: r.total_incl_vat, reference: r.customer_ref,
            address: r.leads?.address ?? null,
          })),
        }, 200, headers);
      }

      case "GET scan": {
        const { data: qrow } = await supabase.from("quotes")
          .select("*, leads(id, first_name, last_name, email, phone, address)")
          .eq("id", q.get("quote_id")).eq("source", SOURCE).single();
        if (!qrow) return json({ error: "Scan not found" }, 404, headers);
        return json({
          quote_id: qrow.id, quote_number: qrow.quote_number, created_at: qrow.created_at,
          design_id: qrow.solar_design_id, lead: qrow.leads,
          annual_consumption_kwh: qrow.annual_consumption_kwh,
          quote: qrow.quote_json,
        }, 200, headers);
      }

      case "GET quote-pdf": {
        const { data: qrow } = await supabase.from("quotes")
          .select("*, leads(first_name, last_name, address)")
          .eq("id", q.get("quote_id")).single();
        if (!qrow) return json({ error: "Quote not found" }, 404, headers);
        const lead = qrow.leads;
        const qd = new Date(qrow.created_at);
        const pdf = await generateOffertePdf({
          quote_number: qrow.quote_number,
          quote_date: qd,
          valid_until: new Date(qd.getTime() + PRICING.quote_valid_days * 86400_000),
          reference: qrow.customer_ref ?? "Zonnepanelen",
          seller: "Belinus Online Calculator",
          customer: {
            name: [lead?.first_name, lead?.last_name].filter(Boolean).join(" ") || "Klant",
            address_lines: lead?.address ? lead.address.split(", ") : [],
          },
          items: qrow.quote_json.items,
          price: qrow.quote_json.price,
          general_terms: true,
          demo_note: "DEMO — geen bindend aanbod / demo application",
        });
        return new Response(pdf as unknown as BodyInit, {
          status: 200,
          headers: {
            ...headers,
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="belinus Offerte ${qrow.quote_number}.pdf"`,
          },
        });
      }

      case "POST contact": {
        // Contact details live only in Supabase (no third-party CRM push).
        const { lead_id, first_name, last_name, email, phone } = body;
        if (lead_id) {
          await supabase.from("leads").update({ first_name, last_name, email, phone })
            .eq("id", lead_id);
        }
        return json({ ok: true }, 200, headers);
      }

      case "POST order": {
        const { quote_id, lead_id, plan } = body; // plan: buy | rent | finance
        if (!["buy", "rent", "finance"].includes(plan)) {
          return json({ error: "plan must be buy, rent or finance" }, 400, headers);
        }
        const { data: order } = await supabase.from("orders").insert({
          quote_id, lead_id: lead_id ?? null, plan, status: "created",
        }).select("id").single();

        // ------------------------------------------------------------------
        // TODO(Mollie): create payment and return checkout URL.
        //   const mollie = await fetch("https://api.mollie.com/v2/payments", {
        //     method: "POST",
        //     headers: { Authorization: `Bearer ${Deno.env.get("MOLLIE_API_KEY")}` },
        //     body: JSON.stringify({
        //       amount: { currency: "EUR", value: deposit.toFixed(2) },
        //       description: `Belinus Solar order ${order.id}`,
        //       redirectUrl: `https://www.belinus.com/solar/thanks?order=${order.id}`,
        //       webhookUrl: `${Deno.env.get("PUBLIC_URL")}/api/mollie-webhook`,
        //       method: ["bancontact", "ideal", "creditcard"],
        //     }),
        //   });
        // ------------------------------------------------------------------
        // TODO(Sumsub): create applicant + signature flow, return access token
        //   for the WebSDK so the customer verifies identity and signs.
        // ------------------------------------------------------------------
        return json({
          order_id: order?.id,
          status: "created",
          payment_url: null, // filled once Mollie is connected
          signing_token: null, // filled once Sumsub is connected
          message: "Order registered. Payment & signing integrations are stubbed in this prototype.",
        }, 200, headers);
      }

      case "POST pay-demo": {
        // DEMO ONLY — simulates a successful Mollie payment. Marks the order
        // paid. Stock orders get an invoice (F...), pre-orders get a product
        // reservation document (PR...); both get a payment receipt (BR...).
        const { order_id } = body;
        if (!order_id) return json({ error: "order_id required" }, 400, headers);
        const { data: ord } = await supabase.from("orders")
          .select("id, quote_id, quotes(quote_json)").eq("id", order_id).single();
        if (!ord) return json({ error: "Order not found" }, 404, headers);
        const price = (ord as any).quotes?.quote_json?.price ?? {};
        const amount = price.deposit ?? 0;
        const isReservation = price.deposit_label === "reservation";
        const { data: docNo } = await supabase.rpc(
          isReservation ? "next_reservation_number" : "next_invoice_number",
        );
        const { data: rcptNo } = await supabase.rpc("next_receipt_number");
        const invoice_number = docNo as unknown as string;
        const receipt_number = rcptNo as unknown as string;
        await supabase.from("orders").update({
          status: "paid", paid_at: new Date().toISOString(),
          invoice_number, receipt_number, amount_paid: amount,
        }).eq("id", order_id);
        return json({
          ok: true,
          doc_kind: isReservation ? "reservation" : "invoice",
          invoice_number, receipt_number, amount_paid: amount,
        }, 200, headers);
      }

      case "GET invoice-pdf": {
        // Renders the Factuur (stock orders) or Productreservatie (pre-orders).
        const { data: ord } = await supabase.from("orders")
          .select("*, quotes(*, leads(first_name, last_name, address, email))")
          .eq("id", q.get("order_id")).single();
        if (!ord || !(ord as any).quotes) return json({ error: "Document not found" }, 404, headers);
        const qrow = (ord as any).quotes;
        const lead = qrow.leads;
        const pd = new Date((ord as any).paid_at ?? Date.now());
        const paidAmt = Number((ord as any).amount_paid ?? qrow.quote_json.price.deposit);
        const isReservation = qrow.quote_json.price.deposit_label === "reservation";
        const docNo = (ord as any).invoice_number ?? "DEMO";
        const dateStr = pd.toLocaleDateString("nl-BE", { day: "2-digit", month: "short", year: "numeric" });
        const amtStr = `€ ${paidAmt.toLocaleString("nl-BE", { minimumFractionDigits: 2 })}`;
        const customer = {
          name: [lead?.first_name, lead?.last_name].filter(Boolean).join(" ") || "Klant",
          address_lines: lead?.address ? lead.address.split(", ") : [],
        };
        const pdf = await generateOffertePdf(isReservation
          ? {
            doc_type: "Productreservatie",
            paid_badge: "GERESERVEERD",
            quote_number: docNo,
            quote_date: pd,
            valid_until: pd,
            reference: qrow.customer_ref ?? "",
            seller: "Belinus Online Calculator",
            meta_labels: ["RESERVATIEDATUM", "LEVERING", "BETALING", "OFFERTE"],
            meta_values: [dateStr, "Q2 2027", `${amtStr} reservatie`, qrow.quote_number ?? "—"],
            customer_label: "RESERVATIE VOOR",
            customer,
            items: qrow.quote_json.items,
            price: qrow.quote_json.price,
            hide_deposit_line: true,
            paid_card: {
              label: "RESERVATIE BEVESTIGD",
              pre: "Reservatie bevestigd op ",
              bold: dateStr,
              post: `. ${amtStr} ontvangen — volledig terugbetaalbaar.`,
              beneficiary: "Belinus Energy B.V. · Belfius",
              iban: "BE71 0689 5494 0169",
            },
            terms_override: [
              ["Levering:", " nieuwe belinus productlijn, verwachte levering Q2 2027."],
              ["Reservatie:", ` ${amtStr}, volledig terugbetaalbaar bij annulatie, verrekend met het voorschot bij bestelling.`],
              ["Prijs:", " de offerteprijs wordt vastgeklikt tot en met de levering."],
              ["", "Dit document is geen factuur. De factuur volgt bij de definitieve bestelling."],
            ],
            general_terms: true,
            demo_note: "DEMO — geen echte reservatie / no real reservation",
          }
          : {
            doc_type: "Factuur",
            paid_badge: "BETAALD",
            quote_number: docNo,
            quote_date: pd,
            valid_until: pd,
            reference: qrow.customer_ref ?? "",
            seller: "Belinus Online Calculator",
            meta_labels: ["FACTUURDATUM", "VERVALDATUM", "BETALING", "OFFERTE"],
            meta_values: [dateStr, dateStr, "Voorschot voldaan", qrow.quote_number ?? "—"],
            customer_label: "FACTUREREN AAN",
            customer,
            items: qrow.quote_json.items,
            price: qrow.quote_json.price,
            paid_card: {
              label: "BETAALD",
              pre: "Voorschot van",
              bold: ` ${amtStr} (50%)`,
              post: ` voldaan op ${dateStr}. Saldo na installatie en keuring.`,
              beneficiary: "Belinus Energy B.V. · Belfius",
              iban: "BE71 0689 5494 0169",
            },
            general_terms: true,
            demo_note: "DEMO — geen echte factuur / no real invoice",
          });
        const fname = isReservation ? `belinus Productreservatie ${docNo}.pdf` : `belinus Factuur ${docNo}.pdf`;
        return new Response(pdf as unknown as BodyInit, {
          status: 200,
          headers: {
            ...headers,
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="${fname}"`,
          },
        });
      }

      case "GET receipt-pdf": {
        // Betaalbewijs — payment receipt, both scenarios.
        const { data: ord } = await supabase.from("orders")
          .select("*, quotes(*, leads(first_name, last_name, address, email))")
          .eq("id", q.get("order_id")).single();
        if (!ord || !(ord as any).quotes) return json({ error: "Receipt not found" }, 404, headers);
        const qrow = (ord as any).quotes;
        const lead = qrow.leads;
        const isReservation = qrow.quote_json.price.deposit_label === "reservation";
        const pdf = await generateReceiptPdf({
          receipt_number: (ord as any).receipt_number ?? "BR-DEMO",
          amount: Number((ord as any).amount_paid ?? qrow.quote_json.price.deposit),
          doc_ref: (ord as any).invoice_number ?? "DEMO",
          doc_ref_label: isReservation ? "RESERVATIENUMMER" : "FACTUURNUMMER",
          doc_kind_word: isReservation ? "reservatie" : "factuur",
          paid_date: new Date((ord as any).paid_at ?? Date.now()),
          method: "Kredietkaart (demo)",
          payer: {
            name: [lead?.first_name, lead?.last_name].filter(Boolean).join(" ") || "Klant",
            address: lead?.address ?? null,
          },
          demo_note: "DEMO — geen echt betaalbewijs / no real receipt",
        });
        return new Response(pdf as unknown as BodyInit, {
          status: 200,
          headers: {
            ...headers,
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="belinus Betaalbewijs ${(ord as any).receipt_number ?? "DEMO"}.pdf"`,
          },
        });
      }

      case "POST mollie-webhook": {
        // TODO(Mollie): fetch payment status by body.id and update orders.status → paid
        return json({ ok: true }, 200, headers);
      }

      default:
        return json({ error: `Unknown route: ${req.method} ${route}` }, 404, headers);
    }
  } catch (err: any) {
    console.error("api error:", JSON.stringify(err?.body ?? err?.message ?? err));
    const status = typeof err?.status === "number" ? err.status : 500;
    const msg = err?.body?.message ?? err?.body ?? err?.message ?? "Internal error";
    return json({ error: msg }, status, headers);
  }
}
