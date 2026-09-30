#!/usr/bin/env python3
"""Build public/index.html from the Aurora version's index.html.

The customer-facing page must stay identical to the Aurora version
(belinus-solar-test), so instead of forking 1,600 lines of HTML we take the
original at a pinned commit and swap only the engine-specific lines:
same-origin API, local datasheets/terms, faster status polling, minimum
visible time per progress stage and the meter cap passed to the layout step.
Every replacement must match exactly once — if the original changes shape,
the build fails loudly instead of shipping a broken page.

usage: build_frontend.py <path to belinus-solar-test checkout> <out file>
"""
import sys

src_dir, out = sys.argv[1], sys.argv[2]
s = open(f"{src_dir}/index.html", encoding="utf-8").read()


def rep(a, b):
    global s
    n = s.count(a)
    if n != 1:
        sys.exit(f"build_frontend: expected 1 match, found {n}: {a[:80]!r}")
    s = s.replace(a, b)


rep('const API_BASE = "https://ywuuhcixtzutspcbxelr.supabase.co/functions/v1/solar";',
    '// Custom stack: same-origin API (Bunny Magic Container) — Google Solar API + PVGIS only.\n'
    'const API_BASE = location.origin + "/api";')
rep('const SHEETS_BASE = "https://steveminerva.github.io/belinus-solar-test/datasheets/";',
    'const SHEETS_BASE = location.origin + "/datasheets/";')
rep('href="https://steveminerva.github.io/belinus-solar-test/cowboy-voorwaarden.html"',
    'href="/cowboy-voorwaarden.html"')
rep('// Stage labels: "A" = Aurora roof design flow',
    '// Stage labels: "A" = roof design flow (Google Solar API + PVGIS)')
rep('  // admin: previously calculated scan → straight to the stored result (no Aurora consumption)',
    '  // admin: previously calculated scan → straight to the stored result (no API consumption)')
rep('  // ---- Branch A: new panel design via Aurora ----',
    '  // ---- Branch A: new panel design via Google Solar API + PVGIS ----')
rep("  // Aurora's irradiation-based kWp is used only for production output.",
    "  // The PVGIS irradiation-based production is used only for production output.")
rep('''    setStage(0, "active");
    const start = await api("POST", "start"''', '''    // The custom stack answers in seconds; keep each stage visible so the
    // progress screen reads exactly like the original flow.
    let stageT0 = Date.now();
    const holdStage = async (ms = 6000) => { const d = Date.now() - stageT0; if (d < ms) await sleep(ms - d); stageT0 = Date.now(); };
    setStage(0, "active");
    const start = await api("POST", "start"''')
rep('''    await poll(`design-status?design_id=${S.designId}`, (r) => r.ready);
    setStage(0, "done");''', '''    await poll(`design-status?design_id=${S.designId}`, (r) => r.ready, { interval: 1000 });
    await holdStage();
    setStage(0, "done");''')
rep('''      return r.status === "succeeded";
    });
    await consumptionP;
    setStage(1, "done");''', '''      return r.status === "succeeded";
    }, { interval: 1000 });
    await consumptionP;
    await holdStage();
    setStage(1, "done");''')
rep('const capWp = phase === "single" ? 5000 : 10000;',
    '// DC limit: inverter max 5 kVA (1-phase) / 10 kVA (3-phase) with 1.3 DC/AC oversizing\n'
    '    const capWp = (phase === "single" ? 5000 : 10000) * 1.3;')
rep('''        design_id: S.designId, target_kwh: targetKwh, mode: a.mode, panels_only: a.panels_only,
      });''', '''        design_id: S.designId, target_kwh: targetKwh, mode: a.mode, panels_only: a.panels_only,
        cap_wp: capWp,
      });''')
rep('''        }, { timeout: 600000 });
        break;''', '''        }, { interval: 1000, timeout: 600000 });
        break;''')
rep('''    }
    setStage(2, "done");''', '''    }
    await holdStage();
    setStage(2, "done");''')
rep('''      return r.status === "succeeded";
    });
    setStage(3, "done");''', '''      return r.status === "succeeded";
    }, { interval: 1000 });
    await holdStage();
    setStage(3, "done");''')
rep('<title>Belinus — My Energyscan</title>',
    '<title>Belinus — My Energyscan</title>\n<meta name="engine" content="google-solar+pvgis">')

# ---- Online promo on the quote: shown as a condition (50% deposit paid online) ----
rep("""  .deposit { text-align: right; font-family: 'JetBrains Mono', monospace; font-size: .74rem; color: var(--grey); margin-top: 10px; }""",
    """  .deposit { text-align: right; font-family: 'JetBrains Mono', monospace; font-size: .74rem; color: var(--grey); margin-top: 10px; }
  .onlinePromo { margin: 12px 0 0 auto; max-width: 420px; text-align: left; padding: 12px 16px; border-left: 3px solid var(--cyan);
                 background: rgba(0,170,228,.07); font-family: Inter, sans-serif; color: var(--ink); }
  .onlinePromo .opl { font-family: 'JetBrains Mono', monospace; font-size: .62rem; letter-spacing: .2em; color: var(--cyan); font-weight: 700; }
  .onlinePromo .opc { font-size: .72rem; color: var(--grey); margin: 3px 0 8px; }
  .onlinePromo .opr { display: flex; justify-content: space-between; gap: 16px; font-size: .8rem; padding: 2px 0; }
  .onlinePromo .opr .mono { font-family: 'JetBrains Mono', monospace; }""")
rep("""const depositText = (qt) => qt.price.deposit_label === "reservation"
  ? I18N[LANG].depositReservation(fmt2.format(qt.price.deposit))
  : I18N[LANG].depositLine(fmt2.format(qt.price.deposit));""",
    """// Deposit line + the online promo as a condition: −15% only when the 50%
// deposit is paid online at order (returns HTML).
const OP_TXT = {
  en: { cond: "Only when you pay the 50% deposit online at order", disc: "Discount (incl. VAT)", tot: "Total when paying online", dep: "Deposit paid online (50%)" },
  nl: { cond: "Enkel bij online betaling van 50% voorschot bij bestelling", disc: "Korting (incl. btw)", tot: "Totaal bij online betaling", dep: "Voorschot online (50%)" },
};
const depositText = (qt) => {
  const p = qt.price, L = I18N[LANG];
  if (p.deposit_label === "reservation") return L.depositReservation(fmt2.format(p.deposit));
  const op = p.online_promo;
  if (!op) return L.depositLine(fmt2.format(p.deposit));
  const T = OP_TXT[LANG] || OP_TXT.en;
  return L.depositLine(fmt2.format(p.deposit_offline ?? Math.round(p.total_incl_vat * 50) / 100)) +
    `<div class="onlinePromo"><div class="opl">${t("promoLbl15")}</div><div class="opc">${T.cond}</div>` +
    `<div class="opr"><span>${T.disc}</span><span class="mono">− € ${fmt2.format(op.discount_incl_vat)}</span></div>` +
    `<div class="opr"><b>${T.tot}</b><b class="mono">€ ${fmt2.format(op.total_incl_vat)}</b></div>` +
    `<div class="opr"><span>${T.dep}</span><span class="mono">€ ${fmt2.format(op.deposit)}</span></div></div>`;
};""")
rep("""  $("depositLine").textContent = depositText(qt);""",
    """  $("depositLine").innerHTML = depositText(qt);""")
# Kit card: state the condition under the promo prices
rep("""    sb += `<div class="kitPrices"><span class="strike mono">€ ${fmt2.format(listT)}</span><span class="promoPrice mono">€ ${fmt2.format(promoT)}</span></div>`;""",
    """    sb += `<div class="kitPrices"><span class="strike mono">€ ${fmt2.format(listT)}</span><span class="promoPrice mono">€ ${fmt2.format(promoT)}</span></div>`;
    sb += `<div class="note" style="color:#9aa3a8;margin-top:4px">${(OP_TXT[LANG] || OP_TXT.en).cond}</div>`;""")

# Quote lines link to the product/service folder (datasheet PDF or website)
rep("""    html += `<tr><td class="num">${String(i + 1).padStart(2, "0")}</td><td class="desc">${it.description}</td>` +""",
    """    const lk = it.link ? (/^https?:/.test(it.link) ? it.link : SHEETS_BASE + encodeURIComponent(it.link)) : null;
    const lkLbl = it.link && /^https?:/.test(it.link) ? it.link.replace(/^https?:\\/\\/(www\\.)?/, "") : (LANG === "nl" ? "Productfolder (PDF)" : "Product folder (PDF)");
    const desc = lk ? `<a href="${lk}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${it.description}</a>` +
      `<br><a class="sheetLink" href="${lk}" target="_blank" rel="noopener">${lkLbl}</a>` : it.description;
    html += `<tr><td class="num">${String(i + 1).padStart(2, "0")}</td><td class="desc">${desc}</td>` +""")

if "aurora" in s.lower():
    sys.exit("build_frontend: an Aurora reference is left in the page")
open(out, "w", encoding="utf-8").write(s)
print(f"build_frontend: wrote {out}")
