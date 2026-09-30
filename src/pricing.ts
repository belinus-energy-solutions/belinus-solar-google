// ============================================================
// Belinus Solar — Pricing configuration & 30-year ROI engine
// Quote structure follows the official Belinus offerte format
// (ref. QT2025-000183): line items with per-line VAT, BEBAT at
// 0% VAT, 6% BTW on kit, 50% voorschot.
//
// Business rules (Steve, 2026-07-02):
//  - Electricity €0,30/kWh, +3%/year
//  - Battery saves ≥ €50/month per 10 kWh (dynamic pricing + peak shaving)
//  - EV charger option at €1.350
//  - Public EV charging €0,50/kWh vs own solar production
//  - Company-car home charging reimbursed by employer at €0,30/kWh
//  - Bank financing capped at the Belgian legal max duration per amount
//  - Rent = 20 years with end-of-contract buy option; system runs 10 more years
//  - Online promo −15% on the kit (stock) only when the 50% deposit is paid online (2026-09-30)
//  - Hybrid inverter always shown as a quote line (2026-09-30)
//  - ROI computed over 30 years
// ============================================================

export const COMPANY = {
  name: "belinus energy B.V.",
  address_lines: ["Silversquare · Frankrijklei 5", "2000 Antwerpen · België"],
  vat: "BTW BE 1020 081 989",
  website: "www.belinus.com",
  email: "finance@belinus.com",
};

export const PRICING = {
  currency: "EUR",
  vat_rate_kit: 0.06,       // residential ≥10 years old; 21% otherwise
  quote_valid_days: 30,
  deposit_rate: 0.50,       // 50% voorschot bij bestelling
  // Online promo (stock catalog): −15% on the kit lines, ONLY when the customer
  // pays the 50% deposit online at order. BEBAT (legal recycling fee) is not
  // discounted. The quote shows list prices + the conditional promo; the
  // invoice after online payment carries the discount as separate lines.
  online_promo: {
    rate: 0.15,
    label: "Online promo -15%",   // ASCII hyphen: PDF standard fonts
    condition: "enkel bij online betaling van 50% voorschot",
  },

  // Panels: 500 Wp factory spec; price per unit, installed (excl. VAT),
  // identical for both catalogs.
  panel_wp: 500,
  panel_unit_price_installed: 300,

  // PLACEHOLDER — installed PV price per kWp, tiered (excl. VAT). (unused)
  system_price_tiers: [
    { up_to_kwp: 4, eur_per_kwp: 1550 },
    { up_to_kwp: 6, eur_per_kwp: 1450 },
    { up_to_kwp: 10, eur_per_kwp: 1350 },
    { up_to_kwp: 1000, eur_per_kwp: 1250 },
  ],

  // Energywall HV modular battery (real prices from offerte QT2025-000222).
  battery: {
    product: "Energywall HV",
    module_kwh: 3.56,
    module_price: 1350,        // excl. VAT, per module
    bebat_per_module: 118.49,  // 0% VAT
    options: [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],  // module counts (0 = none)
    // Advised capacity bounds per meter type (kWh).
    phase_limits_kwh: {
      single: { min: 10, max: 20 },
      three: { min: 20, max: 50 },
    },
    // Dynamic pricing + peak shaving: ≥ €50/month per 10 kWh installed.
    dynamic_savings_eur_month_per_10kwh: 50,
  },

  // EV charger option.
  ev: {
    charger_price: 1350,          // excl. VAT
    charger_label: "KIT — belinus ETAP Pro EV lader 22kW",
    public_price_eur_kwh: 0.50,   // public charging in Belgium
    company_reimbursement: 0.30,  // employer pays per home-charged kWh (flat, contractual)
    default_annual_kwh: 2500,     // ≈ 15.000 km/year
  },

  // Energy market assumptions (Belgium).
  electricity_price_eur_kwh: 0.30,
  electricity_inflation: 0.03,
  injection_price_eur_kwh: 0.05,
  injection_inflation: 0.0,
  self_consumption_no_battery: 0.35,
  self_consumption_with_battery: 0.70,
  panel_degradation: 0.005,
  horizon_years: 30,             // full ROI horizon
  yield_kwh_per_kwp: 950,        // Belgian average annual yield (used for existing panels)

  // Max total panel power by meter type (Wp).
  phase_limits_wp: { single: 5000, three: 10000 },

  // Rent: 20-year contract, monthly = total incl. VAT × factor.
  // End of contract: buy option (buyout price to confirm with Belinus,
  // default €0 = included); system keeps producing 10 more years.
  rent: { monthly_factor: 0.0065, term_years: 20, end_buyout: 0 },

  // Financing: fixed APR; duration capped by Belgian law (lening op
  // afbetaling — maximale terugbetalingstermijn per kredietbedrag).
  finance: {
    apr: 0.059,
    legal_terms: [                 // { up to amount €, max months }
      { up_to: 2500, months: 24 },
      { up_to: 3700, months: 30 },
      { up_to: 5600, months: 36 },
      { up_to: 7500, months: 42 },
      { up_to: 10000, months: 48 },
      { up_to: 15000, months: 60 },
      { up_to: 20000, months: 84 },
      { up_to: 37000, months: 120 },
      { up_to: Infinity, months: 240 },
    ],
  },
};

// ============================================================
// Hardware catalogs: current stock vs new 2027 products.
// ============================================================
export type Catalog = "stock" | "new";

export const CATALOG = {
  stock: {
    kit_name: "belinus Residential Standard",
    price_factor: 1.0,
    deposit_flat: null as number | null,  // null → 50% deposit
    delivery: null as string | null,
    // TODO: add the AIKO datasheet PDF to belinus-solar-test/datasheets and set it here.
    panels: { name: "AIKO Back Contact zonnepanelen", warranty: "25y", sheet: null as string | null },
    inverter: {
      single: { name: "Solis 5kW Hybrid 1P", sheet: "Datasheet Solis 5kW Hybrid 1P.pdf" },
      three: { name: "Solis 3P 10kW Hybrid", sheet: "Datasheet Solis 3P 10kW Hybrid.pdf" },
      warranty: "5y",
      // Price per inverter, excl. VAT. 0 = included in the kit price (the line
      // is still shown on the quote as "inbegrepen").
      price: { single: 0, three: 0 },
    },
    battery: {
      single: { name: "belinus Energywall LV", sheet: "Datasheet_Belinus_Energiewall_LV_NL_20230502.pdf" },
      three: { name: "belinus Energywall HV", sheet: "Datasheet_Belinus_Energiewall_HV_NL 20230502.pdf" },
      warranty: "12y",
    },
    ems: { name: "belinus Themis EMS", warranty: null as string | null, sheet: "belinus Themisv2.pdf" },
  },
  new: {
    kit_name: "belinus Residential Pro",
    price_factor: 1.3,                    // new products are 30% more expensive
    deposit_flat: 100,                    // €100 reservation, fully refundable
    delivery: "Q2 2027",
    panels: { name: "belinus GAIA Smart — Back Contact met geïntegreerde optimizer", warranty: "35y triple warranty", sheet: "belinus GAIA Smart ENv2.pdf" },
    inverter: {
      single: { name: "belinus Powerbox S1-5", sheet: "belinus Powerbox S1-5 ENv2.pdf" },
      three: { name: "belinus Powerbox S3-10", sheet: "belinus Powerbox S3-10 ENv2.pdf" },
      warranty: "10y",
      price: { single: 0, three: 0 },   // excl. VAT; 0 = included in the kit
    },
    battery: {
      single: { name: "Energywall H1 — sodium-ion", sheet: "belinus Energywall H1v2.pdf" },
      three: { name: "Energywall H1 — sodium-ion", sheet: "belinus Energywall H1v2.pdf" },
      warranty: "20y",
    },
    ems: { name: "belinus AI energy management (Themis)", warranty: null as string | null, sheet: "belinus Themisv2.pdf" },
  },
};

/**
 * Ideal battery size (in Energywall HV modules) to optimise performance:
 * shifts the evening/night share of daily consumption (incl. EV) into the
 * battery, bounded by the daily solar surplus, the meter type (single phase
 * supports a smaller battery inverter) and the available module options.
 */
export function idealBatteryModules(opts: {
  annual_consumption_kwh: number;
  annual_production_kwh: number;
  phase?: "single" | "three";
  ev_kwh?: number;
}): number {
  const B = PRICING.battery;
  const phase = (opts.phase ?? "three") === "single" ? "single" : "three";
  const lim = B.phase_limits_kwh[phase]; // single: 10–20 kWh, three: 20–50 kWh
  const minMods = Math.ceil(lim.min / B.module_kwh);
  const maxMods = Math.floor(lim.max / B.module_kwh);

  // Ideal target: shift the evening/night share of daily use (incl. EV),
  // bounded by the daily solar surplus — then clamped to the advised range.
  const dailyUse = (opts.annual_consumption_kwh + (opts.ev_kwh ?? 0)) / 365;
  const eveningShare = 0.6;
  const dailySurplus = Math.max(
    opts.annual_production_kwh -
      opts.annual_consumption_kwh * PRICING.self_consumption_no_battery, 0) / 365;
  const targetKwh = Math.min(dailyUse * eveningShare, Math.max(dailySurplus, lim.min));
  return Math.max(minMods, Math.min(maxMods, Math.round(targetKwh / B.module_kwh)));
}

export function legalTermMonths(amount: number): number {
  for (const t of PRICING.finance.legal_terms) {
    if (amount <= t.up_to) return t.months;
  }
  return 240;
}

export function batteryOptions() {
  const B = PRICING.battery;
  return B.options.map((mods) => {
    const kwh = round1(mods * B.module_kwh);
    return {
      modules: mods,
      kwh,
      price_excl_vat: mods * B.module_price,
      bebat: round2(mods * B.bebat_per_module),
      label: mods === 0 ? "No battery" : `${B.product} ${kwh} kWh`,
    };
  });
}

export interface QuoteInput {
  system_kwp: number;
  annual_production_kwh: number;
  annual_consumption_kwh: number;  // household, excl. EV
  battery_modules?: number | null; // omit/null = auto-size (idealBatteryModules)
  phase?: "single" | "three";
  panel_count?: number;
  ev_present?: boolean;            // charger already installed (no line item)
  ev_add_charger?: boolean;        // add charger to the quote (+ line item)
  ev_annual_kwh?: number;          // home-charged kWh per year
  ev_company?: boolean;            // company car: employer reimburses home charging
  existing_panels?: boolean;       // customer already owns the PV system:
                                   // no panel line item; savings count only the
                                   // ADDED value of battery/EV (not the panels).
  catalog?: Catalog;               // "stock" (default) or "new" (2027 lineup, +30%)
}

export interface LineItem {
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;  // excl. VAT
  vat_rate: number;
  amount: number;      // excl. VAT
  no_discount?: boolean; // excluded from the online promo (BEBAT)
  // Product/service folder: a datasheet file name (served from /datasheets/)
  // or an absolute URL. Shown as a link on the quote line.
  link?: string | null;
}

/** Subtotal, VAT per rate and total incl. VAT for a set of line items. */
export function totals(items: LineItem[]) {
  const subtotal_excl_vat = round2(items.reduce((a, i) => a + i.amount, 0));
  const vat_groups: Record<string, { base: number; vat: number }> = {};
  for (const i of items) {
    const key = (i.vat_rate * 100).toFixed(0);
    vat_groups[key] ??= { base: 0, vat: 0 };
    vat_groups[key].base = round2(vat_groups[key].base + i.amount);
  }
  let total_vat = 0;
  for (const [rate, g] of Object.entries(vat_groups)) {
    g.vat = round2(g.base * (Number(rate) / 100));
    total_vat += g.vat;
  }
  total_vat = round2(total_vat);
  return { subtotal_excl_vat, vat_groups, total_vat, total_incl_vat: round2(subtotal_excl_vat + total_vat) };
}

export function computeQuote(input: QuoteInput) {
  const P = PRICING;
  const B = P.battery;
  const isExistingEarly = !!input.existing_panels;
  const evAdd = !!input.ev_add_charger;
  const evPresent = !!input.ev_present;
  // EV savings count when a charger is (or will be) there — except when both
  // the panels AND the charger already exist (that benefit is not new).
  const hasEv = (evPresent || evAdd) && !(isExistingEarly && evPresent && !evAdd);
  const evKwh = hasEv ? (input.ev_annual_kwh ?? P.ev.default_annual_kwh) : 0;

  // Battery: auto-size unless an explicit module count is given.
  const autoBattery = input.battery_modules === undefined || input.battery_modules === null;
  const mods = autoBattery
    ? idealBatteryModules({
        annual_consumption_kwh: input.annual_consumption_kwh,
        annual_production_kwh: input.annual_production_kwh,
        phase: input.phase,
        ev_kwh: evKwh,
      })
    : (B.options.includes(input.battery_modules!) ? input.battery_modules! : 0);
  const battery_kwh = round1(mods * B.module_kwh);

  const isExisting = isExistingEarly;

  // ---- Catalog (in-stock vs new 2027 lineup) ----
  const catKey: Catalog = input.catalog === "new" ? "new" : "stock";
  const cat = CATALOG[catKey];
  const pf = cat.price_factor;
  const phaseKey = input.phase === "single" ? "single" : "three";
  const batName = cat.battery[phaseKey].name;

  // Panels are 500 Wp factory spec: estimate the count when the design didn't
  // provide one; the display/pricing kWp for the panels line is theoretical
  // (count × 0,5 kWp). The irradiation-based annual production is untouched.
  const panelCount = input.panel_count ?? Math.max(1, Math.round(input.system_kwp * 1000 / P.panel_wp));
  const kwpTheoretical = round2(panelCount * 0.5);

  // GAIA Smart integrated optimizers: +8% production for the new lineup.
  const prodFactor = catKey === "new" && !isExisting ? 1.08 : 1;
  const annualProd = input.annual_production_kwh * prodFactor;

  // ---- Line items (offerte format) ----
  const items: LineItem[] = [];
  if (!isExisting) {
    // Panels priced per unit, installed (€300/panel, both catalogs).
    const unit = P.panel_unit_price_installed;
    items.push({
      description: `KIT — ${cat.panels.name} ${kwpTheoretical} kWp`,
      quantity: panelCount, unit: "Stuk(s)", unit_price: unit,
      vat_rate: P.vat_rate_kit, amount: round2(panelCount * unit),
      link: cat.panels.sheet,
    });
  }
  {
    // Hybrid inverter — always part of the kit (panels and/or battery).
    const inv = cat.inverter[phaseKey];
    const invPrice = round2(cat.inverter.price[phaseKey] * pf);
    items.push({
      description: `KIT — ${inv.name}${invPrice === 0 ? " (inbegrepen)" : ""}`,
      quantity: 1, unit: "Stuk(s)", unit_price: invPrice,
      vat_rate: P.vat_rate_kit, amount: invPrice,
      link: inv.sheet,
    });
  }
  if (mods > 0) {
    const batPrice = round2(mods * B.module_price * pf);
    items.push({
      description: `KIT — ${batName} ${battery_kwh} kWh`,
      quantity: 1, unit: "Stuk(s)", unit_price: batPrice,
      vat_rate: P.vat_rate_kit, amount: batPrice,
      link: cat.battery[phaseKey].sheet,
    });
    items.push({
      description: `BEBAT thuisbatterij`,
      quantity: mods, unit: "Stuk(s)", unit_price: B.bebat_per_module,
      vat_rate: 0, amount: round2(mods * B.bebat_per_module), no_discount: true,
      link: "https://www.bebat.be",
    });
  }
  if (evAdd) {
    const chPrice = round2(P.ev.charger_price * pf);
    items.push({
      description: P.ev.charger_label,
      quantity: 1, unit: "Stuk(s)", unit_price: chPrice,
      vat_rate: P.vat_rate_kit, amount: chPrice,
      link: "belinus ETAPPro v2.pdf",
    });
  }

  // ---- Hardware component list (display: names, warranties, datasheets) ----
  const components: { type: string; name: string; detail: string | null; warranty: string | null; sheet: string | null }[] = [];
  if (!isExisting) {
    components.push({
      type: "panels", name: cat.panels.name,
      detail: `${kwpTheoretical} kWp · ${panelCount} panelen`,
      warranty: cat.panels.warranty, sheet: cat.panels.sheet,
    });
  }
  components.push({
    type: "inverter", name: cat.inverter[phaseKey].name,
    detail: phaseKey === "single" ? "hybrid · 1-fase" : "hybrid · 3-fase",
    warranty: cat.inverter.warranty, sheet: cat.inverter[phaseKey].sheet,
  });
  if (mods > 0) {
    components.push({
      type: "battery", name: batName, detail: `${battery_kwh} kWh`,
      warranty: cat.battery.warranty, sheet: cat.battery[phaseKey].sheet,
    });
  }
  components.push({ type: "ems", name: cat.ems.name, detail: null, warranty: cat.ems.warranty, sheet: cat.ems.sheet });
  if (evAdd) {
    components.push({ type: "charger", name: "belinus ETAP Pro EV lader 22kW", detail: null, warranty: null, sheet: "belinus ETAPPro v2.pdf" });
  }

  // ---- Totals with per-rate VAT split ----
  const { subtotal_excl_vat, vat_groups, total_vat, total_incl_vat } = totals(items);

  // Online promo (stock only): one discount line per VAT rate on the kit lines,
  // valid only when the 50% deposit is paid online at order.
  let online_promo: null | {
    rate: number; label: string; condition: string; items: LineItem[];
    subtotal_excl_vat: number; vat_groups: Record<string, { base: number; vat: number }>;
    total_vat: number; total_incl_vat: number; discount_incl_vat: number; deposit: number;
  } = null;
  if (catKey === "stock") {
    const OP = P.online_promo;
    const bases: Record<string, number> = {};
    for (const i of items) if (!i.no_discount && i.amount > 0) bases[String(i.vat_rate)] = (bases[String(i.vat_rate)] ?? 0) + i.amount;
    const promoItems: LineItem[] = Object.entries(bases).map(([rate, base]) => {
      const d = -round2(base * OP.rate);
      return { description: `${OP.label} — online betaling voorschot`, quantity: 1, unit: "Stuk(s)", unit_price: d, vat_rate: Number(rate), amount: d, no_discount: true };
    });
    const t = totals([...items, ...promoItems]);
    online_promo = {
      rate: OP.rate, label: OP.label, condition: OP.condition, items: promoItems, ...t,
      discount_incl_vat: round2(total_incl_vat - t.total_incl_vat),
      deposit: round2(t.total_incl_vat * P.deposit_rate),
    };
  }
  const promo_total_incl_vat = online_promo ? online_promo.total_incl_vat : null;
  // Stock: 50% deposit. Paid online (the web checkout) → on the promo total;
  // otherwise (bank transfer / Odoo quote) → on the list total.
  // New lineup: €100 reservation, fully refundable.
  const deposit_offline = cat.deposit_flat != null ? cat.deposit_flat : round2(total_incl_vat * P.deposit_rate);
  const deposit = cat.deposit_flat != null
    ? cat.deposit_flat
    : (online_promo ? online_promo.deposit : deposit_offline);
  const deposit_label: "deposit" | "reservation" = cat.deposit_flat != null ? "reservation" : "deposit";

  // ---- Hardware economics: replacement costs over the 30-year horizon ----
  //  stock — battery replacement at end of years 10 & 20 + inverter €1.200 at years 10 & 20
  //  new   — inverter €1.200 at year 15 only; battery replacement at year 20 only
  const inverterReplacement = 1200;
  const batteryReplacement = round2(mods * B.module_price * pf);
  const maintenance = (y: number): number => {
    if (catKey === "stock") return (y === 9 || y === 19) ? batteryReplacement + inverterReplacement : 0;
    return (y === 14 ? inverterReplacement : 0) + (y === 19 ? batteryReplacement : 0);
  };
  let maintenance_30y = 0;
  for (let y = 0; y < P.horizon_years; y++) maintenance_30y += maintenance(y);
  maintenance_30y = round2(maintenance_30y);

  // ---- Yearly benefits over 30 years ----
  const sc = mods > 0 ? P.self_consumption_with_battery : P.self_consumption_no_battery;
  // Battery: dynamic pricing + peak shaving, flat ("at least").
  const battery_dynamic_yr = round2(battery_kwh * (B.dynamic_savings_eur_month_per_10kwh * 12) / 10);

  const yearly_savings: number[] = [];
  for (let y = 0; y < P.horizon_years; y++) {
    const production = annualProd * Math.pow(1 - P.panel_degradation, y);
    const elec = P.electricity_price_eur_kwh * Math.pow(1 + P.electricity_inflation, y);
    const inj = P.injection_price_eur_kwh * Math.pow(1 + P.injection_inflation, y);
    let year = 0;

    const pub = P.ev.public_price_eur_kwh * Math.pow(1 + P.electricity_inflation, y);

    // House self-consumption and the solar surplus available for the EV.
    const selfUsedHouse = Math.min(production * sc, input.annual_consumption_kwh);
    // The EV can only charge from solar that the house doesn't use itself.
    const evSolar = hasEv ? Math.min(evKwh, Math.max(production - selfUsedHouse, 0)) : 0;
    const evGrid = hasEv ? evKwh - evSolar : 0;

    if (isExisting) {
      // Customer already owns the panels: the panels' own production value is
      // NOT counted. Only the ADDED value of battery and charger:
      // 1. Battery: ONLY the €50/month per 10 kWh rule (added below) — the
      //    self-consumption shift is considered part of that figure, so it is
      //    not counted separately (avoids double counting).
      // 2. Charger: the EV absorbs solar surplus that otherwise went to
      //    injection — valued at the home grid price (conservative), or the
      //    employer reimbursement for company cars. Grid-charged kWh add nothing.
      if (hasEv) {
        const rate = input.ev_company
          ? Math.max(P.ev.company_reimbursement - inj, 0)
          : Math.max(elec - inj, 0);
        year += evSolar * rate;
      }
    } else {
      // New system: production value is part of the quote.
      // 1. Self-consumed solar replaces grid electricity.
      // 2. Remaining surplus (after EV) is injected.
      const injected = Math.max(production - selfUsedHouse - evSolar, 0);
      year += selfUsedHouse * elec + injected * inj;
      // 3. EV: solar-charged kWh replace public charging (€0,50); grid-charged
      //    kWh at home still beat public charging for private cars.
      if (hasEv) {
        if (input.ev_company) {
          year += evSolar * Math.max(P.ev.company_reimbursement - inj, 0);
        } else {
          year += evSolar * Math.max(pub - inj, 0) + evGrid * Math.max(pub - elec, 0);
        }
      }
    }

    // Battery: dynamic tariffs + peak shaving (battery is part of the quote).
    year += battery_dynamic_yr;

    yearly_savings.push(round2(year));
  }
  const total_savings = round2(yearly_savings.reduce((a, b) => a + b, 0));

  // ---- Plans (all evaluated over 30 years; maintenance included) ----
  // BUY
  const buyCum = cumulative(yearly_savings, total_incl_vat, (y) => maintenance(y));
  const payback_year = buyCum.findIndex((v) => v >= 0) + 1 || null;

  // RENT: pay 20 years, buy option at end of contract, then 10 free years.
  const rent_monthly = round2(total_incl_vat * P.rent.monthly_factor);
  const rentYears = P.rent.term_years;
  const rent_total = round2(rent_monthly * 12 * rentYears + P.rent.end_buyout);
  const rentCum = cumulative(yearly_savings, 0, (y) =>
    (y < rentYears ? rent_monthly * 12 : 0) + (y === rentYears - 1 ? P.rent.end_buyout : 0) +
    maintenance(y));

  // FINANCE: APR fixed, duration capped by Belgian law for the amount.
  const n = legalTermMonths(total_incl_vat);
  const r = P.finance.apr / 12;
  const finance_monthly = round2((total_incl_vat * r) / (1 - Math.pow(1 + r, -n)));
  const finance_total = round2(finance_monthly * n);
  const finCum = cumulative(yearly_savings, 0,
    (y) => (y * 12 < n ? finance_monthly * Math.min(12, n - y * 12) : 0) + maintenance(y));

  return {
    currency: P.currency,
    system: {
      kwp: round2(input.system_kwp),
      kwp_theoretical: kwpTheoretical,
      phase: phaseKey,
      panel_count: isExisting ? (input.panel_count ?? null) : panelCount,
      annual_production_kwh: Math.round(annualProd),
      catalog: catKey,
      kit_name: cat.kit_name,
      delivery: cat.delivery,
      battery: { modules: mods, kwh: battery_kwh, product: batName },
      ev_charger: evAdd,
      ev_present: evPresent,
      ev_benefit_counted: hasEv,
      ev_annual_kwh: evKwh,
      ev_company: !!input.ev_company,
      existing_panels: isExisting,
      battery_auto_sized: autoBattery,
      self_consumption_rate: sc,
    },
    items,
    components,
    price: {
      subtotal_excl_vat,
      vat_groups,
      total_vat,
      total_incl_vat,
      list_total_incl_vat: total_incl_vat,
      ...(online_promo ? { promo_total_incl_vat, promo_rate: online_promo.rate, online_promo } : {}),
      deposit_rate: P.deposit_rate,
      deposit,          // amount charged by the online checkout
      deposit_offline,  // 50% of the list total (no online payment)
      deposit_label,
    },
    savings: {
      horizon_years: P.horizon_years,
      yearly: yearly_savings,
      total_30y: total_savings,
      battery_dynamic_per_year: battery_dynamic_yr,
    },
    plans: {
      maintenance_30y,
      buy: {
        upfront: total_incl_vat, total_cost_30y: total_incl_vat,
        net_benefit_30y: round2(total_savings - total_incl_vat - maintenance_30y),
        payback_year, cumulative: buyCum,
      },
      rent: {
        monthly: rent_monthly, term_years: rentYears,
        end_buyout: P.rent.end_buyout,
        total_cost_30y: rent_total,
        net_benefit_30y: round2(total_savings - rent_total - maintenance_30y), cumulative: rentCum,
      },
      finance: {
        monthly: finance_monthly, apr: P.finance.apr, term_months: n,
        total_cost_30y: finance_total,
        net_benefit_30y: round2(total_savings - finance_total - maintenance_30y), cumulative: finCum,
      },
    },
    assumptions: {
      electricity_price_eur_kwh: P.electricity_price_eur_kwh,
      electricity_inflation: P.electricity_inflation,
      injection_price_eur_kwh: P.injection_price_eur_kwh,
      panel_degradation: P.panel_degradation,
      vat_rate: P.vat_rate_kit,
      battery_dynamic_eur_month_per_10kwh: B.dynamic_savings_eur_month_per_10kwh,
      ev_public_price: P.ev.public_price_eur_kwh,
      ev_company_reimbursement: P.ev.company_reimbursement,
      horizon_years: P.horizon_years,
    },
  };
}

function cumulative(yearly: number[], upfront: number, yearlyCost: (y: number) => number): number[] {
  const out: number[] = [];
  let acc = -upfront;
  yearly.forEach((s, y) => { acc += s - yearlyCost(y); out.push(round2(acc)); });
  return out;
}
function round2(v: number) { return Math.round(v * 100) / 100; }
function round1(v: number) { return Math.round(v * 10) / 10; }
