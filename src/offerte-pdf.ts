// ============================================================
// Belinus offerte / factuur / productreservatie PDF.
// Branded template per QT2025-000183 + F2025-000113 (betaald).
// ============================================================

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import { COMPANY, type LineItem } from "./pricing.ts";
import { BRAND, getFontBytes } from "./brand.ts";
import { LOGO_FILL, LOGO_H, LOGO_PATHS, LOGO_W } from "./logo-paths.ts";

export interface OfferteData {
  doc_type?: string;        // "Offerte" (default), "Factuur", "Productreservatie"
  paid_badge?: string;      // green header pill text, e.g. "BETAALD"
  paid_card?: {             // green confirmation card (replaces signature card)
    label: string;          // e.g. "BETAALD"
    pre: string;            // sentence before bold part
    bold: string;           // bold part (date / amount)
    post: string;           // sentence after bold part
    beneficiary: string;
    iban: string;
  };
  demo_note?: string;       // red demo indication in header
  general_terms?: boolean;  // append the general terms & conditions page
  meta_labels?: string[];   // default offerte labels
  meta_values?: string[];   // default offerte values
  customer_label?: string;  // default "OFFERTE VOOR"
  terms_override?: [string, string][];
  hide_deposit_line?: boolean;
  quote_number: string;
  quote_date: Date;
  valid_until: Date;
  reference: string;
  seller: string;
  customer: { name: string; address_lines: string[] };
  items: LineItem[];
  price: {
    subtotal_excl_vat: number;
    vat_groups: Record<string, { base: number; vat: number }>;
    total_incl_vat: number;
    deposit: number;
    deposit_label?: string;
    deposit_offline?: number;
    online_promo?: {
      label: string; condition: string; rate: number;
      discount_incl_vat: number; total_incl_vat: number; deposit: number;
    };
  };
  promo_applied?: boolean;  // invoice after online payment: promo lines already in items
}

const eur = (v: number) =>
  v.toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateNL = (d: Date) =>
  d.toLocaleDateString("nl-BE", { day: "2-digit", month: "short", year: "numeric" });

const CYAN = rgb(BRAND.cyan.r, BRAND.cyan.g, BRAND.cyan.b);
const BLACK = rgb(BRAND.black.r, BRAND.black.g, BRAND.black.b);
const GREY = rgb(BRAND.grey.r, BRAND.grey.g, BRAND.grey.b);
const LIGHT = rgb(BRAND.lightGrey.r, BRAND.lightGrey.g, BRAND.lightGrey.b);
const RULE = rgb(BRAND.rule.r, BRAND.rule.g, BRAND.rule.b);
const DARK = rgb(BRAND.dark.r, BRAND.dark.g, BRAND.dark.b);
const WHITE = rgb(1, 1, 1);
export const GREEN = rgb(0.18, 0.62, 0.36);
export const GREEN_LIGHT = rgb(0.925, 0.965, 0.937);
export const RED = rgb(0.9, 0.2, 0.2);

const A4: [number, number] = [595, 842];
const M = 56;
const W = A4[0] - 2 * M;

// General terms & conditions (demo version — to be replaced by legal text).
const GENERAL_TERMS: [string, string][] = [
  ["1. Toepasselijkheid.", "Deze algemene voorwaarden zijn van toepassing op alle offertes, reservaties, bestellingen en facturen van belinus energy B.V., met uitsluiting van de voorwaarden van de klant."],
  ["2. Offertes.", "Offertes zijn 30 dagen geldig en indicatief tot technische inspectie van de woning. Kennelijke vergissingen binden belinus niet."],
  ["3. Prijzen.", "Alle prijzen zijn inclusief installatie en btw, tenzij anders vermeld. BEBAT-bijdragen zijn vrijgesteld van btw (0%)."],
  ["4. Betaling.", "Bestelling met 50% voorschot; saldo na installatie en keuring. Reservaties van de nieuwe productlijn bedragen € 100,00 en zijn op elk moment volledig terugbetaalbaar, zonder enige verplichting."],
  ["5. Levering.", "Leveringstermijnen zijn indicatief. Voor de nieuwe productlijn geldt een verwachte levering in Q2 2027."],
  ["6. Eigendomsvoorbehoud.", "Geleverde goederen blijven eigendom van belinus tot volledige betaling van de prijs."],
  ["7. Garantie.", "Garantietermijnen per product zoals vermeld op de offerte. Nieuwe belinus panelen genieten 35 jaar triple garantie (product, vermogen en installatie)."],
  ["8. Herroepingsrecht.", "Consumenten beschikken over een herroepingstermijn van 14 kalenderdagen conform het Wetboek Economisch Recht."],
  ["9. Aansprakelijkheid.", "De aansprakelijkheid van belinus is beperkt tot het factuurbedrag, behoudens opzet of zware fout."],
  ["10. Overmacht.", "belinus is niet aansprakelijk voor vertraging of niet-nakoming ten gevolge van overmacht."],
  ["11. Privacy.", "Persoonsgegevens worden verwerkt conform de GDPR en uitsluitend voor de uitvoering van de overeenkomst."],
  ["12. Geschillen.", "Belgisch recht is van toepassing. De rechtbanken van Antwerpen zijn exclusief bevoegd."],
];

// Rounded-rect outline pill (SVG path, y grows downward from anchor).
export function drawPill(page: PDFPage, xRight: number, yTop: number, w: number, h: number, color = GREEN) {
  const r = h / 2;
  const d = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
  page.drawSvgPath(d, { x: xRight - w, y: yTop, borderColor: color, borderWidth: 1 });
}

export function drawCheckCircle(page: PDFPage, cx: number, cy: number, radius: number, color = GREEN) {
  page.drawEllipse({ x: cx, y: cy, xScale: radius, yScale: radius, borderColor: color, borderWidth: 1.4 });
  const s = radius / 14;
  page.drawLine({
    start: { x: cx - 5 * s, y: cy - 0.5 * s }, end: { x: cx - 1.5 * s, y: cy - 4 * s },
    thickness: 1.8 * Math.max(s, 0.8), color,
  });
  page.drawLine({
    start: { x: cx - 1.5 * s, y: cy - 4 * s }, end: { x: cx + 5.5 * s, y: cy + 4 * s },
    thickness: 1.8 * Math.max(s, 0.8), color,
  });
}

export async function generateOffertePdf(data: OfferteData): Promise<Uint8Array> {
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

  let page = doc.addPage(A4);
  let y = 0;

  const footer = (p: PDFPage) => {
    p.drawText("www.belinus.com", { x: M, y: 46, size: 7, font: mono, color: GREY });
    const t = "finance@belinus.com";
    p.drawText(t, { x: M + W - mono.widthOfTextAtSize(t, 7), y: 46, size: 7, font: mono, color: GREY });
  };

  const newPage = () => {
    footer(page);
    page = doc.addPage(A4);
    y = A4[1] - 70;
  };
  const ensure = (needed: number) => { if (y - needed < 80) newPage(); };
  const text = (s: string, x: number, size: number, font: PDFFont, color = DARK, py = y) =>
    page.drawText(s, { x, y: py, size, font, color });
  const rightText = (s: string, xRight: number, size: number, font: PDFFont, color = DARK, py = y) =>
    page.drawText(s, { x: xRight - font.widthOfTextAtSize(s, size), y: py, size, font, color });
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

  if (data.paid_badge) {
    const bt = spaced(data.paid_badge);
    const bw = monoBold.widthOfTextAtSize(bt, 6.5) + 24;
    drawPill(page, M + W, A4[1] - 44, bw, 16, GREEN);
    page.drawText(bt, { x: M + W - bw + 12, y: A4[1] - 44 - 11, size: 6.5, font: monoBold, color: GREEN });
  }

  const docTitle = data.doc_type ?? "Offerte";
  let titleSize = 38;
  while (helv.widthOfTextAtSize(docTitle, titleSize) > 320 && titleSize > 22) titleSize -= 2;
  const offW = helv.widthOfTextAtSize(docTitle, titleSize);
  page.drawText(docTitle, { x: M + W - offW, y: A4[1] - 100, size: titleSize, font: helv, color: WHITE });
  const qnW = mono.widthOfTextAtSize(data.quote_number, 11);
  page.drawText(data.quote_number, { x: M + W - qnW, y: A4[1] - 122, size: 11, font: mono, color: rgb(0.75, 0.78, 0.80) });
  if (data.demo_note) {
    const dw = monoBold.widthOfTextAtSize(data.demo_note, 8);
    page.drawText(data.demo_note, { x: M + W - dw, y: A4[1] - 140, size: 8, font: monoBold, color: RED });
  }

  // ================= META ROW =================
  y = A4[1] - bandH - 36;
  const cols = [M, M + 128, M + 256, M + 400];
  const heads = data.meta_labels ?? ["OFFERTEDATUM", "VERVALDATUM", "JOUW REFERENTIE", "VERKOPER"];
  const vals = data.meta_values ?? [dateNL(data.quote_date), dateNL(data.valid_until), data.reference, data.seller];
  heads.forEach((h, i) => {
    if (i > 0) {
      page.drawLine({ start: { x: cols[i] - 14, y: y - 26 }, end: { x: cols[i] - 14, y: y + 8 }, thickness: 0.7, color: RULE });
    }
    text(spaced(h), cols[i], 6.5, monoBold, GREY);
  });
  y -= 15;
  let metaBottom = y;
  vals.forEach((v, i) => {
    const maxW = (cols[i + 1] ?? M + W + 24) - cols[i] - 22;
    let line = "", yy = y;
    for (const word of v.split(" ")) {
      const t2 = line ? line + " " + word : word;
      if (mono.widthOfTextAtSize(t2, 9.5) > maxW && line) {
        page.drawText(line, { x: cols[i], y: yy, size: 9.5, font: mono, color: DARK });
        yy -= 12; line = word;
      } else line = t2;
    }
    page.drawText(line, { x: cols[i], y: yy, size: 9.5, font: mono, color: DARK });
    metaBottom = Math.min(metaBottom, yy);
  });
  y = metaBottom - 40;

  // ================= CUSTOMER =================
  text(spaced(data.customer_label ?? "OFFERTE VOOR"), M, 6.5, monoBold, CYAN);
  y -= 16;
  text(data.customer.name, M, 12, helvBold, DARK);
  y -= 15;
  for (const l of data.customer.address_lines) { text(l, M, 9.5, helv, rgb(0.35, 0.38, 0.40)); y -= 13; }
  y -= 18;

  // ================= ITEMS TABLE =================
  const cN = M, cD = M + 30, cQ = M + 300, cP = M + 374, cV = M + 418, cA = M + W;
  const tableHead = () => {
    text(spaced("#"), cN, 6.5, monoBold, GREY);
    text(spaced("OMSCHRIJVING"), cD, 6.5, monoBold, GREY);
    rightText(spaced("AANTAL"), cQ, 6.5, monoBold, GREY);
    rightText(spaced("PRIJS"), cP, 6.5, monoBold, GREY);
    rightText(spaced("BTW"), cV, 6.5, monoBold, GREY);
    rightText(spaced("BEDRAG"), cA, 6.5, monoBold, GREY);
    y -= 8;
    page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.7, color: RULE });
    y -= 20;
  };
  tableHead();

  data.items.forEach((it, i) => {
    ensure(52);
    text(String(i + 1).padStart(2, "0"), cN, 9, mono, CYAN);
    text(it.description, cD, 10, helvBold, DARK);
    rightText(it.quantity.toLocaleString("nl-BE", { minimumFractionDigits: 2 }), cQ, 9, mono, DARK);
    rightText(eur(it.unit_price), cP, 9, mono, DARK);
    rightText((it.vat_rate * 100).toFixed(0) + "%", cV, 9, mono, DARK);
    rightText(eur(it.amount), cA, 9, monoBold, DARK);
    y -= 12;
    rightText("Stuk(s)", cQ, 6.5, mono, GREY);
    y -= 14;
    page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.7, color: RULE });
    y -= 20;
  });

  // ================= TOTALS =================
  ensure(70);
  const totLbl = M + 340;
  const totalRow = (label: string, value: string) => {
    rightText(label, totLbl + 60, 9, helv, GREY);
    rightText(value, cA, 9, mono, DARK);
    y -= 15;
  };
  const totalsTopY = y;
  totalRow("Excl. btw", eur(data.price.subtotal_excl_vat));
  for (const [rate, g] of Object.entries(data.price.vat_groups)) {
    totalRow(`BTW ${rate}% op ${eur(g.base)}`, eur(g.vat));
  }
  y -= 22;

  // ================= TOTAAL BAND =================
  ensure(70);
  const bandY = y - 10;
  page.drawRectangle({ x: M + 250, y: bandY, width: A4[0] - (M + 250), height: 34, color: BLACK });
  page.drawRectangle({ x: M + 250, y: bandY, width: 3, height: 34, color: CYAN });
  page.drawText(spaced("TOTAAL"), { x: M + 268, y: bandY + 13, size: 8, font: monoBold, color: WHITE });
  const totS = `€ ${eur(data.price.total_incl_vat)}`;
  page.drawText(totS, {
    x: M + W - monoBold.widthOfTextAtSize(totS, 14), y: bandY + 11, size: 14, font: monoBold, color: WHITE,
  });
  y = bandY - 16;
  const op = data.promo_applied ? undefined : data.price.online_promo;
  if (!data.hide_deposit_line) {
    const depLine = data.price.deposit_label === "reservation"
      ? `Reservatie (volledig terugbetaalbaar bij annulatie): € ${eur(data.price.deposit)}`
      : `Voorschot bij bestelling (50%): € ${eur(op ? (data.price.deposit_offline ?? data.price.total_incl_vat * 0.5) : data.price.deposit)}`;
    rightText(depLine, M + W, 8, mono, GREY);
  }
  y -= 34;

  // ================= ONLINE PROMO (conditional) =================
  // Drawn left of the totals block (same height), so it never forces a page break.
  if (op && !data.hide_deposit_line) {
    const boxH = 84, boxX = M, boxW = 230;
    const boxY = totalsTopY + 10 - boxH;
    page.drawRectangle({ x: boxX, y: boxY, width: boxW, height: boxH, color: LIGHT });
    page.drawRectangle({ x: boxX, y: boxY, width: 3, height: boxH, color: CYAN });
    let yy = boxY + boxH - 16;
    page.drawText(spaced(op.label.toUpperCase()), { x: boxX + 14, y: yy, size: 6.5, font: monoBold, color: CYAN });
    yy -= 13;
    page.drawText(op.condition.charAt(0).toUpperCase() + op.condition.slice(1), { x: boxX + 14, y: yy, size: 7.5, font: helv, color: GREY });
    const row = (label: string, value: string, bold = false) => {
      yy -= 15;
      page.drawText(label, { x: boxX + 14, y: yy, size: 8.5, font: bold ? helvBold : helv, color: DARK });
      const f = bold ? monoBold : mono;
      page.drawText(value, { x: boxX + boxW - 12 - f.widthOfTextAtSize(value, 9), y: yy, size: 9, font: f, color: DARK });
    };
    row("Korting (incl. btw)", `- € ${eur(op.discount_incl_vat)}`);
    row("Totaal bij online betaling", `€ ${eur(op.total_incl_vat)}`, true);
    row("Voorschot online (50%)", `€ ${eur(op.deposit)}`);
  }

  // ================= PAID CARD =================
  if (data.paid_card) {
    ensure(100);
    const pc = data.paid_card;
    const cardH = 78;
    const cardY = y - cardH;
    page.drawRectangle({ x: M, y: cardY, width: W, height: cardH, color: GREEN_LIGHT });
    page.drawRectangle({ x: M, y: cardY, width: 3, height: cardH, color: GREEN });
    page.drawText(spaced(pc.label), { x: M + 24, y: cardY + cardH - 22, size: 6.5, font: monoBold, color: GREEN });
    let tx = M + 24;
    const ty = cardY + cardH - 40;
    page.drawText(pc.pre, { x: tx, y: ty, size: 9, font: helv, color: DARK });
    tx += helv.widthOfTextAtSize(pc.pre, 9);
    page.drawText(pc.bold, { x: tx, y: ty, size: 9, font: helvBold, color: DARK });
    tx += helvBold.widthOfTextAtSize(pc.bold, 9);
    page.drawText(pc.post, { x: tx, y: ty, size: 9, font: helv, color: DARK });
    page.drawText(spaced("BEGUNSTIGDE"), { x: M + 24, y: cardY + 26, size: 6, font: monoBold, color: GREY });
    page.drawText(pc.beneficiary, { x: M + 24, y: cardY + 13, size: 8.5, font: helv, color: DARK });
    page.drawText(spaced("IBAN"), { x: M + 240, y: cardY + 26, size: 6, font: monoBold, color: GREY });
    page.drawText(pc.iban, { x: M + 240, y: cardY + 13, size: 9, font: mono, color: DARK });
    drawCheckCircle(page, M + W - 46, cardY + cardH / 2, 20, GREEN);
    y = cardY - 28;
  }

  // ================= VOORWAARDEN =================
  ensure(110);
  text(spaced("VOORWAARDEN & BEPALINGEN"), M, 6.5, monoBold, GREY);
  y -= 15;
  const terms: [string, string][] = data.terms_override ?? [
    ["Levering:", " na betaling van het voorschot en technische inspectie."],
    ["Betaling:", " 50% voorschot bij bestelling, saldo na installatie en keuring."],
    ["", "BEBAT-bijdrage is vrijgesteld van btw (0%). 150 eur technische inspectiekosten zijn inbegrepen in de prijs en worden"],
    ["", "aangerekend indien de bestelling geannuleerd zou worden."],
    ["", "Deze offerte werd automatisch gegenereerd op basis van een automatische dakanalyse en is indicatief tot technische inspectie."],
  ];
  for (const [lead, rest] of terms) {
    if (lead) {
      text(lead, M, 8.5, helvBold, DARK);
      text(rest, M + helvBold.widthOfTextAtSize(lead, 8.5), 8.5, helv, rgb(0.35, 0.38, 0.40));
    } else {
      text(rest, M, 8.5, helv, rgb(0.35, 0.38, 0.40));
    }
    y -= 13;
  }
  y -= 20;

  // ================= SIGNATURE CARD (offertes only) =================
  if (!data.paid_card) {
    ensure(130);
    const cardH = 110;
    const cardY = y - cardH;
    page.drawRectangle({ x: M, y: cardY, width: W, height: cardH, color: LIGHT });
    page.drawText(spaced("VOOR AKKOORD"), { x: M + 24, y: cardY + cardH - 28, size: 6.5, font: monoBold, color: CYAN });
    page.drawText("Gelieve te ondertekenen ter bevestiging van deze offerte.", {
      x: M + 24, y: cardY + cardH - 44, size: 9, font: helv, color: DARK,
    });
    const lineY = cardY + 34;
    page.drawLine({ start: { x: M + 24, y: lineY }, end: { x: M + 300, y: lineY }, thickness: 0.8, color: rgb(0.6, 0.63, 0.65) });
    page.drawLine({ start: { x: M + 340, y: lineY }, end: { x: M + W - 24, y: lineY }, thickness: 0.8, color: rgb(0.6, 0.63, 0.65) });
    page.drawText(spaced("HANDTEKENING KLANT"), { x: M + 24, y: lineY - 13, size: 6.5, font: monoBold, color: GREY });
    page.drawText(spaced("DATUM"), { x: M + 340, y: lineY - 13, size: 6.5, font: monoBold, color: GREY });
  }

  // ================= ALGEMENE VOORWAARDEN (extra page) =================
  if (data.general_terms) {
    newPage();
    text(spaced("ALGEMENE VOORWAARDEN"), M, 8, monoBold, CYAN);
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.7, color: RULE });
    y -= 20;
    const grey2 = rgb(0.35, 0.38, 0.40);
    for (const [lead, rest] of GENERAL_TERMS) {
      ensure(40);
      text(lead, M, 8.5, helvBold, DARK);
      let x0 = M + helvBold.widthOfTextAtSize(lead, 8.5) + 4;
      let maxW = M + W - x0;
      let line = "";
      for (const w2 of rest.split(" ")) {
        const t2 = line ? line + " " + w2 : w2;
        if (helv.widthOfTextAtSize(t2, 8.5) > maxW && line) {
          text(line, x0, 8.5, helv, grey2);
          y -= 12; x0 = M; maxW = W; line = w2;
        } else line = t2;
      }
      if (line) text(line, x0, 8.5, helv, grey2);
      y -= 18;
    }
  }

  footer(page);
  return await doc.save();
}
