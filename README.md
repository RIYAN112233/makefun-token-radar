# Token Launch Radar

An entry for the [make.fun](https://make.fun/bounty/token-radar-01) bounty
[token-radar-01 — Build the best token launch radar](https://make.fun/bounty/token-radar-01).

[![make.fun bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/RIYAN112233/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/RIYAN112233/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

## What it does

The program (`main.ts`, Node 22, standard library only) reads the bounty's sealed DefiLlama
snapshot and builds a radar of the protocols that record no token yet:

- **board.json** — every protocol on the snapshot's watchlist, plus the strongest early protocols
  below the watchlist floor, ranked 1..N by implied launch value, each with a concrete farm plan.
- **dashboard/** — a static page (no network, no framework) with the ranked board, search,
  category and chain filters, a watchlist-only toggle, five sort orders, a detail view per
  protocol showing the model's own arithmetic for that row, the tokenised peer set, and the
  method stated whole.
- **screenshots/** — the board, one protocol's detail view, and a filtered view.
- **dossier.json** — written with the vendored `buildDossier` library, byte for byte as the
  scorer rebuilds it.

## The value model

Every figure is computed from the snapshot's own numbers at run time; no protocol is named in
the code.

```
implied value = TVL x peer multiple x momentum x maturity x breadth
```

- **Peer multiple** — the median market-cap / TVL of the snapshot's tokenised protocols in the
  same category (ratios clamped to [0.01, 10] first). A category needs at least 3 tokenised
  peers to speak for itself; otherwise the global median stands in. The multiple used is
  clamped to [0.02, 3].
- **Momentum** — 1 + 0.004 x the 7-day TVL change in per cent, clamped to [-50, +100]; an
  unreported change scores 1.
- **Maturity** — 0.78 + 0.22 x years tracked (up to 5) / 5, from the day DefiLlama began
  tracking the protocol; an unreported date counts as one year.
- **Breadth** — 1 + 0.025 x each chain past the first, up to eight.

Protocols whose token already trades are never ranked: they are the peer set the multiples are
learned from, and the dashboard shows them apart at the market's own values.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to>/snapshot.json
```
