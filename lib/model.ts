// Token Launch Radar — the value model.
//
// One sealed DefiLlama snapshot in, one ranked board of pre-token protocols out. Every number on the
// board is computed from the snapshot's own figures at run time; no protocol is named or special-cased
// anywhere in this file, and the same code scores every row.
//
// A protocol records no token when all three of its token fields are empty (mcap_usd, gecko_id,
// symbol). Those are the radar's subjects. Protocols whose token already trades are never ranked:
// they form the peer set the model learns from, and the dashboard shows them apart, at the market's
// own values.
//
// THE MODEL
//   implied_value = TVL x peer_multiple x momentum x maturity x breadth        (whole dollars)
//
//   peer_multiple  The median market-cap / TVL ratio of the snapshot's own tokenised protocols in
//                  the same category (ratios first clamped to [0.01, 10] so one broken record cannot
//                  bend a median). A category needs at least 3 tokenised peers to speak for itself;
//                  below that, or for a protocol with no category, the global median of every
//                  tokenised protocol stands in. The multiple used is clamped to [0.02, 3].
//   momentum       1 + 0.004 x clamp(change_7d, -50, +100): a protocol whose TVL grew 100% in a
//                  week is worth 1.40x its static multiple; one that halved is worth 0.80x. An
//                  unreported change counts as no momentum (factor 1).
//   maturity       0.78 + 0.22 x min(years_listed, 5) / 5, years_listed from listed_at to the
//                  snapshot's as_of day. A protocol DefiLlama has tracked for five years with no
//                  token earns the full factor; a brand-new one starts at 0.78. An unreported
//                  listed_at counts as one year, and the row says so.
//   breadth        1 + 0.025 x min(chains - 1, 8): each extra chain a protocol runs on adds 2.5%,
//                  up to +20% at nine chains — a wider footprint is harder to walk away from.
//
// The board covers every watchlist slug (the house's floor, never a ceiling) and then the strongest
// early protocols below the floor by TVL, skipping the same ground the watchlist rule skips: an
// exchange itself, a versioned pool of another protocol, and wrapped / staked / bridged products of
// a token that already trades — none of those is a launch still to come.

/** One protocol record, exactly the ten fields the sealed snapshot carries. */
export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** The model's fixed constants, stated on the dashboard's method section as they are here. */
export const MODEL = {
  ratio_clamp_lo: 0.01,
  ratio_clamp_hi: 10,
  multiple_clamp_lo: 0.02,
  multiple_clamp_hi: 3,
  min_category_peers: 3,
  momentum_per_pct: 0.004,
  momentum_floor_pct: -50,
  momentum_cap_pct: 100,
  maturity_base: 0.78,
  maturity_span: 0.22,
  maturity_full_years: 5,
  unknown_age_years: 1,
  breadth_per_chain: 0.025,
  breadth_max_extra_chains: 8,
  /** Watchlist rows plus this many early rows below the floor. */
  early_rows: 200,
  /** Tokenised protocols the dashboard's peer view carries, by market cap. */
  peer_rows: 24,
} as const;

/** One scored protocol: the board row and the dashboard's row are two spellings of this. */
export interface Scored {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  age_known: boolean;
  on_watchlist: boolean;
  peer_multiple: number;
  peer_basis: string;
  peer_count: number;
  momentum: number;
  maturity: number;
  breadth: number;
  implied_value_usd: number;
}

/** A tokenised protocol, shown at the market's own value in the dashboard's peer view. */
export interface PeerRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
  change_7d: number | null;
  symbol: string | null;
}

const DAY_MS = 86_400_000;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The middle value of a non-empty list of numbers. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Records no token: every token field of the record is empty. */
export function recordsNoToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whole days from listed_at to the snapshot's as_of day; null when either date is missing or bad. */
export function listedAgeDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The peer multiples the model learns from this snapshot: a median per category, and the global one. */
export interface PeerMultiples {
  global: number;
  global_count: number;
  by_category: Map<string, { multiple: number; count: number }>;
}

/** Learn the multiples: clamp each tokenised protocol's mcap/TVL, then take medians. */
export function peerMultiples(snapshot: Snapshot): PeerMultiples {
  const groups = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = clamp(p.mcap_usd / p.tvl_usd, MODEL.ratio_clamp_lo, MODEL.ratio_clamp_hi);
    all.push(ratio);
    if (p.category !== null) {
      const g = groups.get(p.category);
      if (g === undefined) groups.set(p.category, [ratio]);
      else g.push(ratio);
    }
  }
  const by_category = new Map<string, { multiple: number; count: number }>();
  for (const [category, ratios] of groups) {
    by_category.set(category, { multiple: clamp(median(ratios), MODEL.multiple_clamp_lo, MODEL.multiple_clamp_hi), count: ratios.length });
  }
  return {
    global: clamp(median(all), MODEL.multiple_clamp_lo, MODEL.multiple_clamp_hi),
    global_count: all.length,
    by_category,
  };
}

/** The multiple one protocol is scored with, and where it came from. */
function multipleFor(p: Protocol, peers: PeerMultiples): { multiple: number; basis: string; count: number } {
  if (p.category !== null) {
    const own = peers.by_category.get(p.category);
    if (own !== undefined && own.count >= MODEL.min_category_peers) {
      return { multiple: own.multiple, basis: `median of ${own.count} tokenised ${p.category} peers`, count: own.count };
    }
  }
  return { multiple: peers.global, basis: `global median of ${peers.global_count} tokenised protocols`, count: peers.global_count };
}

/** The three adjustment factors of one protocol, exactly as the dashboard's method section states them. */
export function factorsOf(p: Protocol, asOf: string): { momentum: number; maturity: number; breadth: number; ageDays: number | null; ageKnown: boolean } {
  const growth = p.change_7d === null ? 0 : clamp(p.change_7d, MODEL.momentum_floor_pct, MODEL.momentum_cap_pct);
  const momentum = 1 + MODEL.momentum_per_pct * growth;
  const ageDays = listedAgeDays(asOf, p.listed_at);
  const years = ageDays === null ? MODEL.unknown_age_years : ageDays / 365.25;
  const maturity = MODEL.maturity_base + MODEL.maturity_span * (Math.min(years, MODEL.maturity_full_years) / MODEL.maturity_full_years);
  const breadth = 1 + MODEL.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), MODEL.breadth_max_extra_chains);
  return { momentum, maturity, breadth, ageDays, ageKnown: ageDays !== null };
}

/** Score one pre-token protocol under the model. */
export function score(p: Protocol, snapshot: Snapshot, peers: PeerMultiples, onWatchlist: boolean): Scored {
  const m = multipleFor(p, peers);
  const f = factorsOf(p, snapshot.as_of);
  // The four components are rounded to four places first, and the implied value is computed from
  // those rounded components: the dashboard shows the same four numbers and recomputes the same
  // dollar from them, so the page's arithmetic and the board's figure agree exactly.
  const multiple = round4(m.multiple);
  const momentum = round4(f.momentum);
  const maturity = round4(f.maturity);
  const breadth = round4(f.breadth);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * momentum * maturity * breadth));
  return {
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: f.ageDays,
    age_known: f.ageKnown,
    on_watchlist: onWatchlist,
    peer_multiple: multiple,
    peer_basis: m.basis,
    peer_count: m.count,
    momentum,
    maturity,
    breadth,
    implied_value_usd: implied,
  };
}

const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * May the radar rank this protocol below the floor? Only a launch still to come: it records no
 * token, and it is not an exchange, a versioned pool, or a wrapped / staked / bridged product of a
 * token that already trades — the same ground the house's watchlist rule skips.
 */
export function rankableBelowFloor(p: Protocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name) || WRAPPED_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The board's subjects: every watchlist protocol, then the strongest early ones below the floor. */
export function boardSubjects(snapshot: Snapshot): { chosen: Protocol[]; onWatchlist: Set<string> } {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const onWatchlist = new Set(snapshot.watchlist);
  const chosen = new Map<string, Protocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && p.tvl_usd < snapshot.floor_usd && rankableBelowFloor(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, MODEL.early_rows);
  for (const p of early) chosen.set(p.slug, p);
  return { chosen: [...chosen.values()], onWatchlist };
}

/** Score and rank the board: implied value descending, then TVL, then slug — ranks 1..N. */
export function buildBoard(snapshot: Snapshot): Scored[] {
  const peers = peerMultiples(snapshot);
  const { chosen, onWatchlist } = boardSubjects(snapshot);
  const scored = chosen.map((p) => score(p, snapshot, peers, onWatchlist.has(p.slug)));
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  return scored;
}

/** The tokenised peer set for the dashboard: the largest by market cap, at the market's own values. */
export function buildPeers(snapshot: Snapshot): PeerRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, MODEL.peer_rows)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: round4(p.tvl_usd > 0 ? p.mcap_usd! / p.tvl_usd : 0),
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

/** The snapshot out of a file's text, refused unless it carries the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('snapshot.json is not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new Error('snapshot.json has no as_of date');
  if (typeof o.source !== 'string' || o.source.length === 0) throw new Error('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new Error('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new Error('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new Error('snapshot.json has no watchlist');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new Error(`protocol ${i} lacks a slug, a name or a TVL`);
    }
    const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}
