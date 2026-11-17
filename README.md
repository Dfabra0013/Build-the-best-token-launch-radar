# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)

**Pre-token protocols in a sealed [DefiLlama](https://defillama.com) snapshot, ranked by implied launch value — each with the steps to farm it.** An entry for make.fun's *Build the best token launch radar* bounty (`token-radar-01`, $1,325 in USDC).

> **Implied value is this entry's model claim — not a prediction, not investment advice, and not a statement that any protocol will launch a token.** DefiLlama's record says "no token carried", never "no token". Farm plans are worked examples of the economics; airdrops are never guaranteed.

## Run it

Needs **Node.js 22.18 or later** (it runs the TypeScript directly, like the bounty's runtime). Nothing is installed for the build itself — no dependencies, standard library only.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

(`--input` also accepts a directory holding `snapshot.json`; without `MAKEFUN_OUTPUT_DIR` or `--output`, the program writes to `/output`. Outside the grader, point it at the kit's `input/snapshot.json`.)

The program reads the sealed snapshot, prices every pre-token protocol it may rank, and writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory. **Two runs from the same snapshot write the same bytes** — nothing reads the clock, the network or your environment.

Try it without the sealed snapshot — the repository carries a small **synthetic** fixture and a smoke test that checks the invariants the bounty's gate cares about:

```sh
node scripts/smoke.mjs
```

## What the board says about this snapshot

| Figure | Value |
| --- | --- |
| Protocols in the sealed record | 758 (≥ $5M TVL) |
| House watchlist (all priced) | 40 / 40 |
| Early finds below the $50M floor | 138 |
| **Board rows** | **178** |
| Watchlist implied launch value (sum) | ≈ $3.19B |
| Board implied launch value (sum) | ≈ $3.79B |
| Median row implied | ≈ $4.9M |

## The model — `radar-3`, stated in full

1. **Comparables.** Protocols carrying `mcap_usd > 0` and category other than `CEX` — 119 of them — are the market's own pricing. For each, `r = ln(mcap / TVL)`.
2. **Empirical-Bayes shrinkage.** A category's median `r` is pulled toward the global median with a prior of `k = 16` pseudo-observations: `r̂ = (n·median_cat + k·median_global) / (n + k)`. Categories with fewer than 3 comparables (Risk Curators, Onchain Capital Allocator, Collateral Markets…) price off the global prior, openly labelled `global prior` in the board's confidence column. The prior strength was chosen once by leave-one-out cross-validation — not tuned per row.
3. **An interval, not a number.** Each row carries the p25–p75 band of its comps (global quartiles when thin): the board shows a whisker, not just a point.
4. **No growth or age multiplier — measured, not assumed away.** On this snapshot, 7d TVL change correlates with `ln(mcap/TVL)` at **−0.08** (n=119) and age at **−0.04** (n=87): indistinguishable from zero. A multiplier would be noise dressed as signal, so the model prices TVL times the comps multiple and says why.
5. **The watchlist is a floor, never a ceiling.** Every watchlist slug is on the board. The early radar mirrors the house rule as the ten snapshot fields allow: CEX and the bridge/staking-product categories are excluded, names matching *wrapped/staked/staking* or an exchange's name are excluded, version-marker names are excluded.

**The honest backtest (leave-one-out over the 119 comparables):** median absolute error **88.3%**, mean **2,240.5%** (the fattest misses dominate), **26.9%** of predictions land within 2× of the actual, and the 50% interval contains the held-out actual **41.2%** of the time. The market's own pricing of tokens is that dispersed; this radar's job is ordering, coverage and honesty — not false precision. The same figures are shown inside the dashboard, in the Methodology & backtest panel.

## The farm plans

Every row carries an eight-step plan derived from its own record (category, chains, TVL, age) — verify the project, a clean wallet, position sizing (≤ 2–5% of the farming roll), the category's core qualifying action, a weekly pulse, points tracking, claim-week discipline, and exit paperwork — each step 20–600 characters, with cost and time. Not one plan is hand-written per protocol.

## Repository layout

| Path | What it is |
| --- | --- |
| `main.ts` | The entrypoint: snapshot in → `board.json`, `data.js`, `dashboard/`, `screenshots/`, `dossier.json` out. Node 22, standard library only. |
| `lib/model.ts` | The engine: snapshot parsing, the comps index, pricing, the backtest, farm plans, the board builder, the gate self-check. |
| `vendor/makefun-board.ts` | make.fun's dossier library, copied **byte for byte** from the bounty kit (sha256 `9ca51b6e5cd84fe46cb0efa61e2ea99365a1fb0e21f2b75e6007f977f0dc326e`). |
| `dashboard/` | The static page (`index.html`, `app.css`, `app.js`). No network, no framework, no external assets — renders from `data.js`. |
| `screenshots/` | The board, a protocol's detail view and a filtered view (regenerate with `node scripts/screenshot.mjs`, Linux x64). |
| `test/fixture-snapshot.json` | A synthetic snapshot for the smoke test. The sealed snapshot is **not** redistributed here. |
| `scripts/` | `smoke.mjs` (CI check), `screenshot.mjs` (dev-only screenshot regeneration). |

## Provenance & license

Built for make.fun's *Build the best token launch radar* (`token-radar-01`). MIT — see [LICENSE](LICENSE). The snapshot bytes, the vendored library and the kit are the bounty's; everything else in this repository is this entry's own work.
