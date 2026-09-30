// ============================================================
// Belinus Betaalbewijs (payment receipt) — replicates the
// branded template of Betaalbewijs BR2025-000113.
// ============================================================

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import { COMPANY } from "./pricing.ts";
import { BRAND, getFontBytes } from "./brand.ts";
import { LOGO_FILL, LOGO_PATHS, LOGO_W } from "./logo-paths.ts";
import { drawCheckCircle, drawPill, GREEN, RED } from "./offerte-pdf.ts";

export interface ReceiptData {
  receipt_number: string;      // BR2026-000114
  amount: number;
  doc_ref: string;             // F2026-000224 or PR2026-000001
  doc_ref_label: string;       // "FACTUURNUMMER" | "RESERVATIENUMMER"
  doc_kind_word: string;       // "factuur" | "reservatie"
  paid_date: Date;
  method: string;              // e.g. "Kredietkaart (demo)"
  payer: { name: string; address: string | null };
  demo_note?: string;
}

const IBAN = "BE71 0689 5494 0169";

const eur = (v: number) =>
  v.toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateNL = (d: Date) =>
  d.toLocaleDateString("nl-BE", { day: "2-digit", month: "short", year: "numeric" });

const CYAN = rgb(BRAND.cyan.r, BRAND.cyan.g, BRAND.cyan.b);
const BLACK = rgb(BRAND.black.r, BRAND.black.g, BRAND.black.b);
const GREY = rgb(BRAND.grey.r, BRAND.grey.g, BRAND.grey.b);
const RULE = rgb(BRAND.rule.r, BRAND.rule.g, BRAND.rule.b);
const DARK = rgb(BRAND.dark.r, BRAND.dark.g, BRAND.dark.b);
const WHITE = rgb(1, 1, 1);

const A4: [number, number] = [595, 842];
const M = 56;
const W = A4[0] - 2 * M;

export async function generateReceiptPdf(data: ReceiptData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const monoBytes = await getFontBytes("mono");
  const monoBoldBytes = await getFontBytes("monoBold");
  const mono = monoBytes
    ? await doc.embedFont(monoBytes, { subset: true })
    : await doc.embedFont(StandardFonts.Courier);
  const monoBold = monoBoldBytes
    ? await doc.embedFont(monoBoldBytes, { subset: true })
    : await doc.embedFont(StandardFonts.CourierBold);

  const page = doc.addPage(A4);
  const spaced = (s: string) => s.split("").join(" ");

  // ================= HEADER BAND =================
  const bandH = 190;
  page.drawRectangle({ x: 0, y: A4[1] - bandH, width: A4[0], height: bandH, color: BLACK });
  page.drawRectangle({ x: 0, y: A4[1] - bandH - 2, width: A4[0], height: 2, color: CYAN });

  {
    const lw = 132;
    const s = lw / LOGO_W;
    const logoColor = rgb(LOGO_FILL.r, LOGO_FILL.g, LOGO_FILL.b);
    for (const d of LOGO_PATHS) {
      page.drawSvgPath(d, { x: M, y: A4[1] - 48, scale: s, color: logoColor, borderWidth: 0 });
    }
  }

  let hy = A4[1] - 122;
  page.drawText(COMPANY.name, { x: M, y: hy, size: 7, font: monoBold, color: WHITE });
  hy -= 11;
  for (const l of [...COMPANY.address_lines, COMPANY.vat]) {
    page.drawText(l, { x: M, y: hy, size: 7, font: mono, color: rgb(0.62, 0.65, 0.67) });
    hy -= 11;
  }

  {
    const bt = spaced("BETAALD");
    const bw = monoBold.widthOfTextAtSize(bt, 6.5) + 24;
    drawPill(page, M + W, A4[1] - 44, bw, 16, GREEN);
    page.drawText(bt, { x: M + W - bw + 12, y: A4[1] - 44 - 11, size: 6.5, font: monoBold, color: GREEN });
  }

  const title = "Betaalbewijs";
  const tW = helv.widthOfTextAtSize(title, 38);
  page.drawText(title, { x: M + W - tW, y: A4[1] - 100, size: 38, font: helv, color: WHITE });
  const qnW = mono.widthOfTextAtSize(data.receipt_number, 11);
  page.drawText(data.receipt_number, { x: M + W - qnW, y: A4[1] - 122, size: 11, font: mono, color: rgb(0.75, 0.78, 0.80) });
  if (data.demo_note) {
    const dw = monoBold.widthOfTextAtSize(data.demo_note, 8);
    page.drawText(data.demo_note, { x: M + W - dw, y: A4[1] - 140, size: 8, font: monoBold, color: RED });
  }

  // ================= AMOUNT HERO =================
  let y = A4[1] - bandH - 80;
  drawCheckCircle(page, M + 30, y + 12, 30, GREEN);
  const hx = M + 90;
  page.drawText(spaced("BETALING ONTVANGEN"), { x: hx, y: y + 26, size: 6.5, font: monoBold, color: GREY });
  page.drawText(`€ ${eur(data.amount)}`, { x: hx, y: y - 8, size: 30, font: helv, color: DARK });
  y -= 62;

  // Confirmation sentence with bold doc number
  {
    const pre = `Wij bevestigen de goede ontvangst van uw betaling voor ${data.doc_kind_word} `;
    const post = ". Hartelijk dank.";
    let tx = M;
    page.drawText(pre, { x: tx, y, size: 9.5, font: helv, color: DARK });
    tx += helv.widthOfTextAtSize(pre, 9.5);
    page.drawText(data.doc_ref, { x: tx, y, size: 9.5, font: helvBold, color: DARK });
    tx += helvBold.widthOfTextAtSize(data.doc_ref, 9.5);
    page.drawText(post, { x: tx, y, size: 9.5, font: helv, color: DARK });
  }
  y -= 40;

  // ================= DETAIL GRID (2 cols x 3 rows) =================
  const rows: [string, string[], string, string[]][] = [
    ["BETAALD DOOR", [data.payer.name, ...(data.payer.address ? [data.payer.address] : [])],
     "BEGUNSTIGDE", [COMPANY.name, IBAN]],
    [data.doc_ref_label, [data.doc_ref], "BETAALDATUM", [dateNL(data.paid_date)]],
    ["BETAALMETHODE", [data.method], "MEDEDELING", [data.doc_ref]],
  ];
  const rowH = [64, 46, 46];
  const midX = M + W / 2;
  let gy = y;
  rows.forEach((r, ri) => {
    const h = rowH[ri];
    // cell borders
    page.drawRectangle({ x: M, y: gy - h, width: W, height: h, borderColor: RULE, borderWidth: 0.7 });
    page.drawLine({ start: { x: midX, y: gy - h }, end: { x: midX, y: gy }, thickness: 0.7, color: RULE });
    const cell = (x: number, label: string, lines: string[]) => {
      page.drawText(spaced(label), { x: x + 20, y: gy - 18, size: 6, font: monoBold, color: GREY });
      let ly = gy - 33;
      lines.forEach((ln, li) => {
        const bold = li === 0;
        const useMono = /\d/.test(ln) && !bold;
        page.drawText(ln, {
          x: x + 20, y: ly, size: bold ? 9.5 : 8.5,
          font: bold ? helvBold : (useMono ? mono : helv),
          color: bold ? DARK : rgb(0.35, 0.38, 0.40),
        });
        ly -= 13;
      });
    };
    cell(M, r[0], r[1]);
    cell(midX, r[2], r[3]);
    gy -= h;
  });
  y = gy - 44;

  // ================= TOTAAL BETAALD BAND =================
  const bandY = y - 10;
  page.drawRectangle({ x: M + 210, y: bandY, width: A4[0] - (M + 210), height: 34, color: BLACK });
  page.drawRectangle({ x: M + 210, y: bandY, width: 3, height: 34, color: CYAN });
  page.drawText(spaced("TOTAAL BETAALD"), { x: M + 228, y: bandY + 13, size: 8, font: monoBold, color: WHITE });
  const totS = `€ ${eur(data.amount)}`;
  page.drawText(totS, {
    x: M + W - monoBold.widthOfTextAtSize(totS, 14), y: bandY + 11, size: 14, font: monoBold, color: WHITE,
  });

  // ================= FOOTER =================
  page.drawText("www.belinus.com", { x: M, y: 46, size: 7, font: mono, color: GREY });
  const ft = "finance@belinus.com";
  page.drawText(ft, { x: M + W - mono.widthOfTextAtSize(ft, 7), y: 46, size: 7, font: mono, color: GREY });

  return await doc.save();
}
