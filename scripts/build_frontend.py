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

if "aurora" in s.lower():
    sys.exit("build_frontend: an Aurora reference is left in the page")
open(out, "w", encoding="utf-8").write(s)
print(f"build_frontend: wrote {out}")
