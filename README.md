# Token Radar — pre-token protocols ranked by implied value

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/arisasmara/ai-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/arisasmara/ai-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

An entry for [token-radar-01](https://make.fun/bounty/token-radar-01) on make.fun:
a dashboard that finds protocols whose token does not exist yet, ranks them by
an implied value, and shows a reader how to farm each one.

## The board

`main.ts` (Node 22, standard library only) reads the sealed snapshot
(`/input/snapshot.json`: 758 DefiLlama protocols as of 2026-11-14, 40 on the
watchlist) and writes the ranked board to `/output/board.json`, the
dashboard's data to `/output/data.js`, and the dossier to
`/output/dossier.json`. It runs twice; both runs write identical bytes.

- **178 rows**: all 40 watchlist protocols plus 138 pre-token protocols below
  the $50M watchlist floor, by TVL.
- **24 live-token protocols** are set aside with their market caps shown —
  the market's own values, never mixed into the ranking.

## The model (radar-2)

Every row is scored by one function of the snapshot's own figures. No
protocol name is special-cased, and no row is hand-picked.

```
implied = round(tvl_usd
  x category_multiple
  x (1 + clamp(change_7d, -60, 150) / 100 x 0.6)
  x (0.5 + min(age_days, 1095) / 1095 x 0.5)
  x (1 + 0.02 x min(chains - 1, 10)))
```

- **category_multiple**: the median market-cap/TVL ratio of the live-token
  protocols in the same category, computed at runtime from the snapshot
  itself (at least 5 live protocols per category, otherwise the overall live
  median, 0.1689), clamped to [0.02, 1.0]. A lending protocol and a DEX are
  worth different multiples of their TVL, because the market says so.
- **growth**: the TVL change over seven days, clamped to [-60, 150]%.
- **maturity**: how long the protocol has run with no token, from the day
  DefiLlama first listed it (unknown age counts as 365 days).
- **breadth**: how many chains the protocol runs on, up to +20%.

A protocol is rankable when it records no token and is not a wrapped, staked
or bridged product, not an exchange, and not a versioned pool — the same rule
that builds the watchlist, applied to the early rows too.

## Farm plans

Each row carries a 7-step farm plan derived from the protocol's own record
(category, chains, TVL, age): a fresh wallet, the category's action with
sized capital ($50–$250 by TVL), a weekly qualifying action, a hold of
30–60 days, a points/leaderboard check, a safe claim, and a farm log. Every
step states its cost and its time.

## The dashboard

`dashboard/` is a static page with no network: a sortable, filterable board
(search, category, chain, watchlist-only), a live-token tab, a per-protocol
detail view with the model's full breakdown and the farm plan, and a model
sandbox that recomputes the displayed values live as you move the sliders.
The page recomputes every row from the snapshot figures and says whether the
number matches `board.json`.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to>/snapshot.json
```

## License

MIT. See [LICENSE](LICENSE).
