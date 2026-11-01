// ============================================================
// belinus.com website forms
//
//   POST /api/forms      quote request, contact, partner, service request
//   POST /api/referrers  refer-a-friend registration
//
// Every submission is e-mailed to service@belinus.com through the
// group's imap-mcp server (Bunny container), sent from the
// service@belinus.com account, and stored in Supabase table
// public.web_submissions when that table exists (storage is
// best-effort; the e-mail is what must succeed).
//
// Env:
//   MAIL_MCP_URL      imap-mcp secret-path endpoint, https://<host>/<token>/mcp (secret)
//   MAIL_ACCOUNT      sending account on imap-mcp      (default service@belinus.com)
//   FORMS_TO          recipient                        (default service@belinus.com)
//   WEBSITE_ORIGINS   allowed browser origins, comma separated
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const MAIL_MCP_URL = Deno.env.get("MAIL_MCP_URL") ?? "";
const MAIL_ACCOUNT = Deno.env.get("MAIL_ACCOUNT") ?? "service@belinus.com";
const FORMS_TO = Deno.env.get("FORMS_TO") ?? "service@belinus.com";
const ORIGINS = (Deno.env.get("WEBSITE_ORIGINS") ??
  "https://belinus.com,https://www.belinus.com,https://belinuswebsite.b-cdn.net")
  .split(",").map((s) => s.trim()).filter(Boolean);

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") ?? "http://localhost",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "missing",
  { auth: { persistSession: false } },
);

export const KINDS: Record<string, string> = {
  quote: "Offerteaanvraag (B2C)",
  contact: "Contactaanvraag",
  partner: "Partneraanvraag",
  service: "Serviceaanvraag",
  referrer: "Nieuwe doorverwijzer",
};

export function formsConfigured() {
  return { mail_set: !!MAIL_MCP_URL, mail_account: MAIL_ACCOUNT, forms_to: FORMS_TO };
}

function cors(origin: string | null): Record<string, string> {
  const ok = origin && (ORIGINS.includes(origin) || ORIGINS.includes("*") ||
    /^http:\/\/localhost(:\d+)?$/.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ORIGINS[0],
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}

const reply = (data: unknown, status: number, h: Record<string, string>) =>
  new Response(JSON.stringify(data), { status, headers: h });

// ---- abuse limits (per container instance) ----
const hits = new Map<string, number[]>();
const RATE_MAX = Number(Deno.env.get("FORMS_RATE_MAX") ?? 10);
function limited(ip: string, max = RATE_MAX, windowMs = 10 * 60_000): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Flatten the submitted fields into readable "Label: value" lines. */
export function formatFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .filter(([k, v]) => !k.startsWith("_") && v !== undefined && v !== null && String(v).trim() !== "")
    .map(([k, v]) => {
      const val = Array.isArray(v) ? v.join(", ") : String(v);
      return `${k}: ${val.slice(0, 4000)}`;
    })
    .join("\n");
}

export function validate(kind: string, f: Record<string, unknown>): string | null {
  if (!KINDS[kind]) return "unknown_form";
  if (f._hp) return "spam"; // honeypot filled in
  const email = String(f._email ?? "").trim();
  if (!EMAIL_RE.test(email)) return "invalid_email";
  if (JSON.stringify(f).length > 20_000) return "too_large";
  if (kind !== "referrer" && f._consent !== true) return "consent_required";
  return null;
}

// ---- minimal MCP client (streamable HTTP, JSON or SSE replies) ----
async function mcpPost(body: unknown, session?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
  };
  if (session) headers["mcp-session-id"] = session;
  const r = await fetch(MAIL_MCP_URL, { method: "POST", headers, body: JSON.stringify(body) });
  const sid = r.headers.get("mcp-session-id") ?? session;
  const text = await r.text();
  if (!r.ok) throw new Error(`mail server ${r.status}: ${text.slice(0, 200)}`);
  let msg: any = null;
  if (text.trim().startsWith("{")) msg = JSON.parse(text);
  else {
    for (const line of text.split("\n")) {
      if (line.startsWith("data:")) {
        try { const m = JSON.parse(line.slice(5)); if (m.id === (body as any).id) msg = m; } catch { /* ignore */ }
      }
    }
  }
  return { sid, msg };
}

export async function sendMail(subject: string, text: string): Promise<void> {
  if (!MAIL_MCP_URL) throw new Error("MAIL_MCP_URL not set");
  const init = await mcpPost({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "belinus-website", version: "1" } },
  });
  const sid = init.sid ?? undefined;
  await mcpPost({ jsonrpc: "2.0", method: "notifications/initialized" }, sid).catch(() => {});
  const res = await mcpPost({
    jsonrpc: "2.0", id: 2, method: "tools/call",
    params: {
      name: "send_email",
      arguments: { account: MAIL_ACCOUNT, to: FORMS_TO, subject, body: text, include_signature: false },
    },
  }, sid);
  const m = res.msg;
  if (!m || m.error) throw new Error("mail send failed: " + JSON.stringify(m?.error ?? "no reply").slice(0, 200));
  const out = (m.result?.content ?? []).map((c: any) => c.text ?? "").join("\n");
  if (m.result?.isError || !/"status"\s*:\s*"sent"/.test(out)) {
    throw new Error("mail send failed: " + out.slice(0, 300));
  }
}

async function store(kind: string, lang: string, page: string, email: string, fields: Record<string, unknown>) {
  try {
    const { error } = await supabase.from("web_submissions").insert({ kind, lang, page, email, payload: fields });
    if (error) console.warn("web_submissions insert:", error.message);
  } catch (e) {
    console.warn("web_submissions insert failed:", (e as Error).message);
  }
}

export async function handleWebForms(req: Request, route: string): Promise<Response | null> {
  if (route !== "forms" && route !== "referrers") return null;
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405, h);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (limited(ip)) return reply({ error: "rate_limited" }, 429, h);

  let body: any;
  try { body = await req.json(); } catch { return reply({ error: "bad_json" }, 400, h); }
  const kind = route === "referrers" ? "referrer" : String(body.kind ?? "");
  const fields: Record<string, unknown> = body.fields ?? {};
  if (route === "referrers") {
    fields._email = body.email; fields._consent = true;
    Object.assign(fields, { Naam: body.name, "E-mail": body.email, Verwijscode: body.code, Taal: body.lang });
  }
  const err = validate(kind, fields);
  if (err === "spam") return reply({ ok: true }, 200, h); // silently drop
  if (err) return reply({ error: err }, 400, h);

  const lang = String(body.lang ?? fields.Taal ?? "").slice(0, 5);
  const page = String(body.page ?? "").slice(0, 300);
  const email = String(fields._email).trim();
  const name = String(fields._name ?? body.name ?? "").slice(0, 120);
  const subject = `[belinus.com] ${KINDS[kind]}${name ? " — " + name : ""}`;
  const text = [
    `${KINDS[kind]} via belinus.com`,
    `Taal: ${lang || "-"} · Pagina: ${page || "-"}`,
    `Antwoorden aan: ${email}`,
    "",
    formatFields(fields),
    "",
    `Ontvangen: ${new Date().toISOString()}`,
  ].join("\n");

  try {
    await sendMail(subject, text);
  } catch (e) {
    console.error("forms mail:", (e as Error).message);
    await store(kind, lang, page, email, { ...fields, _mail_error: (e as Error).message });
    return reply({ error: "mail_failed" }, 502, h);
  }
  await store(kind, lang, page, email, fields);
  return reply({ ok: true }, 200, h);
}
