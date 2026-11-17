# Signal Atlas — presentation runbook

## The 60-second story

> **Signal Atlas turns a noisy question — “what might launch next?” — into an inspectable research queue.** It starts with the sealed snapshot, finds protocols that record no token, calibrates their implied value from tokened peers in that same data, then gives every candidate a capped, useful path to investigate without pretending a launch or reward is guaranteed.

## Demo sequence

1. **Open the ranked board**
   - Point out the four snapshot-grounded headline metrics: candidates, watchlist coverage, tokened peer evidence, and the peer multiple.
   - State the equation: **TVL × peer multiple × momentum × maturity × chain breadth × data completeness**.
   - Emphasize that the peer multiple is fitted from the snapshot’s tokened protocols, not a hardcoded list of favorite names.

2. **Open a protocol detail**
   - Click **View plan** on a high-confidence candidate.
   - Walk through the valuation waterfall: implied scenario, snapshot TVL, peer multiple, seven-day signal, maturity, and chain breadth.
   - Contrast the model’s confidence label with certainty: confidence measures evidence quality, not whether a token will launch.

3. **Show the research path**
   - Highlight the capped trial budget, time estimate, proof discipline, and exit rule.
   - The strongest line to say aloud: **“Every action should remain useful even if no token ever exists.”**

4. **Prove it is a usable radar**
   - Toggle **Watchlist only** and **Positive momentum**.
   - Search a protocol or filter by a chain/sector.
   - Sort by TVL, value, or seven-day signal to show that this is a decision surface, not a static poster.

## Presenter guardrails

- Call the output an **implied launch-value scenario**, never a price target or launch prediction.
- Say that “no token” means **no token record in the sealed snapshot**; it is not proof that a protocol has never issued one.
- Do not describe the research paths as eligibility strategies. They are intentionally small, reversible product-research workflows.
- Do not claim a guaranteed contest result. The build is designed to maximize clarity, auditability, and judge-visible craftsmanship; a 100% judge win rate cannot be honestly guaranteed.

## Final artifact rehearsal

Use the competition’s sealed snapshot when it is available:

```sh
rm -rf out
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/input/snapshot.json
npm run check
npm run preview
```

Then capture the final three browser states from `out/dashboard/`:

1. Ranked board — no filters.
2. A protocol detail drawer — show the valuation waterfall and first farm steps.
3. Filtered board — **Watchlist only** plus **Positive momentum**.

The included `screenshots/` folder already follows that narrative. Regenerate it from the sealed input before a final bounty submission so that its labels exactly match the generated board.
