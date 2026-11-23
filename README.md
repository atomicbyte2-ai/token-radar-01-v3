# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/atomicbyte2-ai/token-radar-01-v3/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/atomicbyte2-ai/token-radar-01-v3/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A ranked board of DeFi protocols that record **no token** on DefiLlama, each with an implied value,
token odds, an honest range, and a costed farm plan — all fitted on one snapshot, offline.

## What it does

- `ledger()` puts every protocol of the snapshot in exactly one group: ranked (watchlist, early),
  token trades (priced peers), token recorded without a cap, or set aside (bridges, liquid staking,
  exchanges, versioned/wrapped listings) — counts always sum to the snapshot.
- `fitValue()` fits log market cap on log TVL over the priced peers. Each extra term (category,
  7-day growth, years listed, chain count) is kept only if it lowers the median held-out miss in
  **both** leave-one-out and walk-forward tests (fit on peers listed earlier, test on later ones).
- `fitOdds()` is a logistic regression of "records a token" on size, years listed, 7-day growth and
  category, fitted with a fixed-iteration Newton solver and L2; terms are kept only if ten-fold and
  walk-forward Brier scores both drop. Coefficients carry seeded bootstrap standard errors.
- Implied value = value if a token launches × token odds. P25–P75 / P10–P90 ranges come from
  held-out misses; `heldOut()` reports how often later peers really land inside them.
- `farmPlan()` turns each row into 8 dated steps with cost and time, then a verdict
  (FARM / MARGINAL / SKIP) from modelled drop − gas − bridge − forgone T-bill yield, per hour of work.

The same `dashboard/radar.js` runs in Node (to write `board.json`) and in the browser (to redraw the
page); the page checks that its own refit equals `board.json` row by row.

## Run

```sh
node main.ts                                  # reads /input/snapshot.json, writes /output
node main.ts --input snapshot.json            # another snapshot
MAKEFUN_OUTPUT_DIR=/tmp/out node main.ts --input snapshot.json
```

Node 22+, standard library only, no network, no clock, no unseeded randomness: two runs give
byte-identical output. `main.ts` asserts every output rule before it writes `dossier.json`.

Output: `board.json`, `data.js`, `dashboard/`, `screenshots/`, `dossier.json`.
Open `dashboard/index.html` in the output directory. Views: `#` board, `#p=<slug>` detail,
`#verdict=FARM` (or `tier=`, `cat=`, `chain=`, `sort=`, `dir=`) filtered.

## Assumptions shown on the page

Gas per transaction: Ethereum $1.50, Bitcoin $2.50, Solana $0.02, other chains $0.12; $3 per bridge
move; T-bill 4%. Drop share (default 7% of implied value to users), deposit and horizon are sliders.
Nothing here says a token will launch — only that the protocol records none on DefiLlama today.

## License

MIT — see `LICENSE`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=pnttjnyx&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
