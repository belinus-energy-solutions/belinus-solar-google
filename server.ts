// Belinus Solar — custom stack (Google Solar API + PVGIS)
// Single container: static frontend (public/) + JSON API under /api/*.
import { handleApi } from "./src/api.ts";

const PORT = Number(Deno.env.get("PORT") ?? 8080);
const ROOT = new URL("./public/", import.meta.url);

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", ico: "image/x-icon",
  pdf: "application/pdf", json: "application/json", txt: "text/plain; charset=utf-8",
};

async function serveStatic(pathname: string): Promise<Response> {
  let p = decodeURIComponent(pathname);
  if (p.endsWith("/")) p += "index.html";
  if (p.includes("..")) return new Response("Bad request", { status: 400 });
  const file = new URL("." + p, ROOT);
  try {
    const data = await Deno.readFile(file);
    const ext = p.split(".").pop()!.toLowerCase();
    const type = TYPES[ext] ?? "application/octet-stream";
    return new Response(data, {
      headers: {
        "Content-Type": type,
        // HTML is never cached so a redeploy shows immediately; assets for a day.
        "Cache-Control": ext === "html" ? "no-cache" : "public, max-age=86400",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/healthz") return new Response("ok");
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    return handleApi(req, url.pathname.replace(/^\/api\/?/, ""));
  }
  return serveStatic(url.pathname);
});
