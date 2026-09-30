// ============================================================
// Belinus brand — colors + logo loader.
// Logo: set the LOGO_URL secret to a public PNG of the belinus
// logo (e.g. https://www.belinus.com/solar/belinus-logo.png once
// the widget assets are uploaded). Until then the PDF draws a
// text wordmark in brand cyan.
// ============================================================

export const BRAND = {
  cyan: { r: 0.02, g: 0.678, b: 0.898 },   // #05ade5
  black: { r: 0.043, g: 0.051, b: 0.059 }, // near-black header band
  grey: { r: 0.55, g: 0.58, b: 0.60 },
  lightGrey: { r: 0.949, g: 0.957, b: 0.965 },
  rule: { r: 0.88, g: 0.90, b: 0.91 },
  dark: { r: 0.13, g: 0.15, b: 0.16 },
};

let logoCache: Uint8Array | null | undefined;

/** Fetch the logo PNG once per isolate; returns null when unavailable. */
export async function getLogoBytes(): Promise<Uint8Array | null> {
  if (logoCache !== undefined) return logoCache;
  const url = Deno.env.get("LOGO_URL");
  if (!url) {
    logoCache = null;
    return null;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`logo fetch ${res.status}`);
    logoCache = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    console.error("logo fetch failed:", String(e));
    logoCache = null;
  }
  return logoCache;
}

// JetBrains Mono gives the technical numerals of the offerte template.
const FONT_URLS = {
  mono: "https://cdn.jsdelivr.net/gh/JetBrains/JetBrainsMono@2.304/fonts/ttf/JetBrainsMono-Regular.ttf",
  monoBold: "https://cdn.jsdelivr.net/gh/JetBrains/JetBrainsMono@2.304/fonts/ttf/JetBrainsMono-Bold.ttf",
};

const fontCache: Record<string, Uint8Array | null> = {};

export async function getFontBytes(kind: "mono" | "monoBold"): Promise<Uint8Array | null> {
  if (kind in fontCache) return fontCache[kind];
  try {
    const res = await fetch(FONT_URLS[kind]);
    if (!res.ok) throw new Error(`font fetch ${res.status}`);
    fontCache[kind] = new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    console.error("font fetch failed:", String(e));
    fontCache[kind] = null;
  }
  return fontCache[kind];
}
