// Token Launch Radar — a make.fun token-radar-01 entry (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot, scores every pre-token protocol with the model in
// lib/model.ts, gives each a farm plan from lib/farm.ts, and writes the handover the bounty asks
// for: board.json (the ranked board), data.js (the dashboard's data, written beside dashboard/),
// a copy of dashboard/ and screenshots/, and dossier.json, written with the vendored library in
// vendor/makefun-board.ts exactly as the scorer rebuilds it.
//
// Run it the way the grader does, with /input and /output mounted; outside that container,
// MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard, buildPeers, parseSnapshot, peerMultiples, MODEL } from './lib/model.ts';
import type { Scored, Snapshot } from './lib/model.ts';
import { farmPlan } from './lib/farm.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The dossier caps the scorer rebuilds with: the text cap shapes the bytes, the rest only refuse. */
const DOSSIER_CAPS = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
};
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** A `--name value` or `--name=value` argument, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}
const outDir = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot: Snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const board = buildBoard(snapshot);
const peers = buildPeers(snapshot);
const multiples = peerMultiples(snapshot);

/** One board.json row: the gate's five fields, then the figures the dashboard shows. */
function boardRow(s: Scored, rank: number) {
  return {
    rank,
    slug: s.slug,
    name: s.name,
    implied_value_usd: s.implied_value_usd,
    farm_steps: farmPlan(s, s.age_days),
    category: s.category,
    chains: s.chains,
    tvl_usd: s.tvl_usd,
    change_7d: s.change_7d,
    listed_at: s.listed_at,
    on_watchlist: s.on_watchlist,
  };
}

const rows = board.map((s, i) => boardRow(s, i + 1));

/** The gate's shape, checked here so a bad board fails loudly instead of at the scorer. */
function boardProblem(): string | null {
  if (rows.length < 100 || rows.length > 4000) return `the board holds ${rows.length} rows, outside 100..4000`;
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice`;
    seen.add(r.slug);
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const step of r.farm_steps) {
      const n = step.trim().length;
      if (n < 20 || n > 600) return `${r.slug} has a farm step of ${n} characters`;
    }
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) return `rank ${i + 1} outvalues rank ${i}`;
  }
  if (rows.length >= 2 && rows[0]!.implied_value_usd === rows[rows.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  const missing = snapshot.watchlist.filter((slug) => !seen.has(slug));
  if (missing.length > 0) return `the board misses watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  return null;
}

const problem = boardProblem();
if (problem !== null) {
  process.stderr.write(`token radar: the board fails the gate's shape: ${problem}\n`);
  process.exit(1);
}

/** The dashboard's data: the same rows the board carries, the peer set, and the model stated whole. */
const data = {
  as_of: snapshot.as_of,
  source: snapshot.source,
  floor_usd: snapshot.floor_usd,
  protocol_count: snapshot.protocols.length,
  watchlist_size: snapshot.watchlist.length,
  board_size: rows.length,
  model: {
    momentum_per_pct: MODEL.momentum_per_pct,
    momentum_floor_pct: MODEL.momentum_floor_pct,
    momentum_cap_pct: MODEL.momentum_cap_pct,
    maturity_base: MODEL.maturity_base,
    maturity_span: MODEL.maturity_span,
    maturity_full_years: MODEL.maturity_full_years,
    breadth_per_chain: MODEL.breadth_per_chain,
    min_category_peers: MODEL.min_category_peers,
    global_multiple: multiples.global,
    global_peer_count: multiples.global_count,
    category_multiples: [...multiples.by_category.entries()]
      .map(([category, v]) => ({ category, multiple: v.multiple, peers: v.count }))
      .sort((a, b) => (a.category < b.category ? -1 : 1)),
  },
  rows: board.map((s, i) => ({
    rank: i + 1,
    slug: s.slug,
    name: s.name,
    category: s.category,
    chains: s.chains,
    tvl_usd: s.tvl_usd,
    change_7d: s.change_7d,
    listed_at: s.listed_at,
    age_days: s.age_days,
    age_known: s.age_known,
    on_watchlist: s.on_watchlist,
    peer_multiple: s.peer_multiple,
    peer_basis: s.peer_basis,
    momentum: s.momentum,
    maturity: s.maturity,
    breadth: s.breadth,
    implied_value_usd: s.implied_value_usd,
    farm_steps: rows[i]!.farm_steps,
  })),
  peers,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows })}\n`);
writeFileSync(join(outDir, 'data.js'), `window.RADAR=${JSON.stringify(data)};\n`);

/** Copy a directory's regular files across, skipping dot-names; returns the names copied. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

copyDir(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyDir(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} images: hand in 3 or 4 — the board, a detail view, a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, DOSSIER_CAPS));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols scanned, ${snapshot.watchlist.length} watchlist, ${rows.length} rows ranked, ${peers.length} tokenised peers shown apart\n` +
    `token radar: wrote board.json, data.js, dashboard/, screenshots/ (${shots.length} images) and dossier.json to ${outDir}\n`,
);
