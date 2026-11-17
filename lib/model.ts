// The token launch radar's engine (Node 22, standard library only, erasable TypeScript).
//
// One snapshot of the protocol universe goes in; one ranked board of the protocols that record no
// token comes out, each row priced by what its token would be worth if the protocol's record stayed
// as it is, with the steps to farm it. The method, stated in full so a reader can check it:
//
//   1. Comparables. Protocols in the snapshot carrying mcap_usd > 0 and category other than CEX are
//      the market's own pricing. For each, r = ln(mcap / TVL).
//   2. Shrinkage. A category's median r is pulled toward the global median with a prior of k=16
//      pseudo-observations:   r_hat = (n * median_cat + k * median_global) / (n + k)
//      Categories with fewer than 3 comparables price off the global prior. The prior's strength k
//      was chosen once, by leave-one-out cross-validation over the comparables, not tuned per row.
//   3. Interval. The p25–p75 range of the category's comparables (global quartiles when thin), taken
//      around r_hat, gives each row an honest 50% range instead of a single overconfident figure.
//   4. No growth or age multipliers. On this snapshot, change_7d correlates with ln(mcap/TVL) at
//      -0.08 (n=119) and age at -0.04 (n=87): both indistinguishable from zero, so a multiplier would
//      be noise dressed as signal. TVL times the comps multiple is what the record supports.
//
// Backtest (leave-one-out over the 119 ex-CEX comparables, the held-out row used for nothing):
// median absolute error 88.3%, 26.9% of predictions within 2x of the actual, and the 50% interval
// contains the held-out actual 41.2% of the time. The model is a pricing heuristic, not a promise;
// the dashboard says so, in those numbers.
//
// The watchlist is the floor, never a ceiling: every watchlist slug is on the board, and the early
// radar adds pre-token protocols below the floor under the house's exclusion rule as closely as the
// ten snapshot fields allow (CEX and bridge/staking product categories are excluded, names matching
// wrapped/staked/staking or an exchange's name are excluded, version-marker names are excluded).
// The board never sees protocol identity beyond those fields, and no row is special-cased.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One row of board.json. Superset of the house starter's row; ranked by implied_value_usd, descending. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  implied_value_low_usd: number;
  implied_value_high_usd: number;
  implied_multiple: number;
  comps_n: number;
  confidence: 'comp-backed' | 'thin comps' | 'global prior';
  caveats: string[];
  model: Record<string, string | number>;
  farm_steps: string[];
}

/** The live-token protocols beside the board: the market's own values, never mixed in. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** A category's comparables summary, for the methodology view. */
export interface CompCategory {
  category: string;
  n: number;
  raw_multiple: number;
  shrunk_multiple: number;
  q25: number;
  q75: number;
}

/** Everything the dashboard renders. Shipped as window.RADAR in data.js (a build artifact). */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  method: string;
  watchlist_size: number;
  watchlist_slugs: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  watchlist_tvl_usd: number;
  watchlist_implied_usd: number;
  board_implied_usd: number;
  median_implied_usd: number;
  comps: { n: number; global_multiple: number; q25_multiple: number; q75_multiple: number; k: number };
  backtest: { n: number; median_ape_pct: number; within2x_pct: number; coverage50_pct: number; mape_pct: number };
  buckets: { label: string; count: number }[];
  comp_categories: CompCategory[];
  rows: BoardRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this engine can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export const MODEL_VERSION = 'radar-3';
/** Prior strength for the empirical-Bayes category shrinkage (chosen once by LOO-CV; see header). */
export const SHRINK_K = 16;
/** Fewer comparables than this and the category prices off the global prior. */
export const MIN_COMPS = 3;
/** How many early finds below the floor the board carries, by TVL. */
export const EARLY_ROWS = 200;
/** How many live-token protocols the reference view carries, by market cap. */
export const LIVE_ROWS = 24;

const DAY_MS = 86_400_000;

const finite = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const bySlug = (a: { slug: string }, b: { slug: string }): number => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

/* ------------------------------------------------------------------ snapshot */

/** A whole day count from listed_at to as_of (UTC), clamped at zero; null when unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all in the snapshot. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a live-token protocol can anchor a comparables row: has mcap, not an exchange. */
export function isComp(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX';
}

/** The house's category exclusions for the early radar (mirrors the watchlist rule as the ten fields allow). */
const EARLY_EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_NAME = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

/** Whether an early find below the floor is one the board may rank. */
export function isRankableEarly(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EARLY_EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (VERSION_MARKER.test(p.name)) return false;
  if (EXCHANGE_NAME.test(p.name)) return false;
  return true;
}

/** The snapshot out of a file's text, refused unless it is the shape this engine scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date (YYYY-MM-DD)');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source string');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no positive whole-dollar floor_usd');
  }
  if (!Array.isArray(o.protocols) || o.protocols.length === 0) {
    throw new SnapshotError('snapshot.json has no protocols array');
  }
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i): SnapshotProtocol => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`protocols[${i}] is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocols[${i}] lacks a slug, a name or a finite TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/* ------------------------------------------------------------------ pricing */

const logRatio = (p: SnapshotProtocol): number => Math.log((p.mcap_usd as number) / p.tvl_usd);

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const m = n >> 1;
  return n % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Linear-interpolated quantile of an unsorted sample (type 7, the common default). */
const quantile = (xs: number[], f: number): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * f;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo]!;
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
};

interface CompsIndex {
  globalSorted: number[];
  byCategory: Map<string, number[]>;
}

const indexComps = (protocols: SnapshotProtocol[]): CompsIndex => {
  const globalSorted: number[] = [];
  const byCategory = new Map<string, number[]>();
  for (const p of protocols) {
    if (!isComp(p)) continue;
    const r = logRatio(p);
    globalSorted.push(r);
    if (p.category !== null) {
      const bucket = byCategory.get(p.category);
      if (bucket) bucket.push(r);
      else byCategory.set(p.category, [r]);
    }
  }
  for (const bucket of byCategory.values()) bucket.sort((a, b) => a - b);
  globalSorted.sort((a, b) => a - b);
  return { globalSorted, byCategory };
};

interface PriceEstimate {
  /** Estimate of r = ln(mcap/tvl), shrunk toward the global prior. */
  rHat: number;
  /** The category's raw median (null when the category priced off the prior). */
  rawCat: number | null;
  /** Comparables in the row's category. */
  n: number;
  /** p25/p75 of the basis the interval is taken from (category when n >= 4, else global). */
  q1: number;
  q3: number;
}

const estimateFrom = (index: CompsIndex, category: string | null): PriceEstimate => {
  const g = index.globalSorted;
  const gMed = g.length ? median(g) : 0;
  const gQ1 = quantile(g, 0.25);
  const gQ3 = quantile(g, 0.75);
  const cat = category === null ? undefined : index.byCategory.get(category);
  if (cat === undefined || cat.length < MIN_COMPS) {
    return { rHat: gMed, rawCat: cat && cat.length ? median(cat) : null, n: cat?.length ?? 0, q1: gQ1, q3: gQ3 };
  }
  const n = cat.length;
  const cMed = median(cat);
  const rHat = (n * cMed + SHRINK_K * gMed) / (n + SHRINK_K);
  const q1 = cat.length >= 4 ? quantile(cat, 0.25) : gQ1;
  const q3 = cat.length >= 4 ? quantile(cat, 0.75) : gQ3;
  return { rHat, rawCat: cMed, n, q1, q3 };
};

interface Priced {
  implied: number;
  low: number;
  high: number;
  multiple: number;
  compsN: number;
  confidence: BoardRow['confidence'];
  estimate: PriceEstimate;
}

/** Price one protocol. Pure: the same record always yields the same figures. */
export function price(p: SnapshotProtocol, index: CompsIndex): Priced {
  const est = estimateFrom(index, p.category);
  const multiple = Math.exp(est.rHat);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple));
  let low = Math.max(1, Math.round(p.tvl_usd * Math.exp(est.q1)));
  let high = Math.max(1, Math.round(p.tvl_usd * Math.exp(est.q3)));
  if (low > implied) low = implied;
  if (high < implied) high = implied;
  if (low > high) low = high;
  const confidence: BoardRow['confidence'] = est.n >= 8 ? 'comp-backed' : est.n >= MIN_COMPS ? 'thin comps' : 'global prior';
  return { implied, low, high, multiple, compsN: est.n, confidence, estimate: est };
}

/** Leave-one-out cross-validation over the comparables: the honest out-of-sample check. */
export interface Backtest {
  n: number;
  median_ape_pct: number;
  mape_pct: number;
  within2x_pct: number;
  coverage50_pct: number;
}

export function backtest(protocols: SnapshotProtocol[]): Backtest {
  const comps = protocols.filter(isComp);
  const all = comps.map(logRatio).sort((a, b) => a - b);
  const gQ1 = quantile(all, 0.25);
  const gQ3 = quantile(all, 0.75);
  let apeSum = 0;
  let within2x = 0;
  let coverage = 0;
  const apes: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const held = comps[i]!;
    const rest = comps.filter((_, j) => j !== i);
    const restLogs = rest.map(logRatio).sort((a, b) => a - b);
    const gMed = median(restLogs);
    const same = rest.filter((q) => q.category === held.category).map(logRatio).sort((a, b) => a - b);
    let rHat: number;
    let q1 = gQ1;
    let q3 = gQ3;
    if (same.length >= MIN_COMPS) {
      const n = same.length;
      rHat = (n * median(same) + SHRINK_K * gMed) / (n + SHRINK_K);
      if (same.length >= 4) {
        q1 = quantile(same, 0.25);
        q3 = quantile(same, 0.75);
      }
    } else {
      rHat = gMed;
    }
    const predicted = Math.exp(rHat) * held.tvl_usd;
    const actual = held.mcap_usd as number;
    const ape = Math.abs(predicted - actual) / actual;
    apes.push(ape);
    apeSum += ape;
    if (Math.max(predicted, actual) / Math.min(predicted, actual) <= 2) within2x += 1;
    const lo = predicted * Math.exp(q1 - rHat);
    const hi = predicted * Math.exp(q3 - rHat);
    if (actual >= lo && actual <= hi) coverage += 1;
  }
  const n = comps.length;
  const apeMedian = median(apes);
  const apeMean = apeSum / Math.max(n, 1);
  const oneDecimal = (x: number): number => Math.round(x * 10) / 10;
  return {
    n,
    median_ape_pct: oneDecimal(apeMedian * 100),
    mape_pct: oneDecimal(apeMean * 100),
    within2x_pct: oneDecimal((within2x / Math.max(n, 1)) * 100),
    coverage50_pct: oneDecimal((coverage / Math.max(n, 1)) * 100),
  };
}

/* ------------------------------------------------------------------ farm plans */

/** The first chain a protocol names, or a neutral phrase. */
const chainOf = (p: SnapshotProtocol): string => (p.chains.length > 0 ? p.chains[0]! : 'its main chain');

/** Suggested position size and gas budget, from the protocol's own TVL tier. */
const capitalFor = (p: SnapshotProtocol): { capital: number; gas: number } => {
  if (p.tvl_usd >= 1_000_000_000) return { capital: 150, gas: 8 };
  if (p.tvl_usd >= 100_000_000) return { capital: 100, gas: 6 };
  if (p.tvl_usd >= 10_000_000) return { capital: 75, gas: 4 };
  return { capital: 50, gas: 3 };
};

const actionFor = (p: SnapshotProtocol, capital: number, chain: string): string => {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${n}'s main market on ${chain} (deposit collateral if it is a CDP) and leave it supplied — a standing position, not a visit`;
  }
  if (c.includes('liquid stak') || c.includes('restak') || c.includes('staking pool') || c === 'staking') {
    return `Route $${capital} of the chain's staking asset through ${n} on ${chain} and hold the receipt token in the same wallet — the position must persist, not round-trip`;
  }
  if (c.includes('dex') || c.includes('derivative') || c.includes('option') || c.includes('prediction') || c.includes('leveraged farm')) {
    return `Deposit $${capital} into ${n}'s deepest liquidity pool on ${chain} and keep the LP (or margin) position open — sustained liquidity beats one swap`;
  }
  if (c.includes('yield') || c.includes('basis trading') || c.includes('governance incentive')) {
    return `Deposit $${capital} into ${n}'s highest-TVL strategy on ${chain} and keep the strategy shares — that footprint is what recurring snapshots see`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('liquidity manager') || c.includes('indexes')) {
    return `Deposit $${capital} into a ${n} vault on ${chain} and hold the vault shares — curator allocations go to wallets that stay`;
  }
  if (c.includes('rwa') || c.includes('anchor btc') || c.includes('real world')) {
    return `Mint $${capital} of ${n}'s yield asset on ${chain} and hold it — RWA programs tend to reward duration and size, not churn`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${n} on ${chain} and keep the policy active — an active policy is the qualifying action, not a quote`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC to ${chain} through ${n} and use the bridged funds inside its app — a lone transfer earns nothing; sustained use does`;
  }
  if (c.includes('stablecoin') || c.includes('dual-token') || c.includes('algorithmic stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain} and hold it — the stable footprint is the qualifying footprint`;
  }
  return `Put $${capital} into ${n}'s flagship product on ${chain} — deposit, stake, mint or lock, whatever its docs name as core — and keep the position open week over week`;
};

/**
 * A protocol's farm plan: eight steps derived from its own record (category, chains, TVL, age), never
 * from a hand-written list of names. Each step is a single line of at most 600 characters.
 */
export function farmPlan(p: SnapshotProtocol): string[] {
  const chain = chainOf(p);
  const { capital, gas } = capitalFor(p);
  const core = actionFor(p, capital, chain);
  const steps = [
    `Verify ${p.name} before any money moves: read its official docs, the auditor's report and its DefiLlama project page; confirm the contract addresses on ${chain}; check who the team and backers are. Never act on a link from a reply, a DM or an ad. Cost: free. Time: 10 minutes.`,
    `Set up a clean wallet: a fresh wallet or hardware signer used only for farming, holding nothing you could not afford to lose. Write the seed phrase offline, never into a chat or a site, and grant only the token approvals the app asks for — nothing more. Cost: under $3 of gas. Time: 5 minutes.`,
    `Size the position like it can go to zero: deposit no more than 2-5% of your farming roll, which is $${capital} here. This board's implied value is a model, not a promise; airdrops are never guaranteed; capital you expect to return is capital you cannot afford to farm with. Cost: nothing but discipline. Time: 2 minutes.`,
    `${core}. Cost: $${capital} of capital plus about $${gas} of gas. Time: 15 minutes.`,
    `Keep a weekly pulse: one small qualifying action every week, on the same weekday — a swap, a borrow, a top-up or a vote — so your activity spans several snapshots instead of one. Set a recurring reminder and log each action. Cost: about $2-4 of gas a week. Time: 10 minutes a week.`,
    `Track points, not prices: use only the official points or rewards page, logged into the farming wallet; note your balance and rank in a plain log each week; watch the official channels for snapshot dates; ignore third-party point trackers that ask for signatures. Cost: free. Time: 5 minutes a week.`,
    `Farm the claim week safely: when the token launches, claim only through the link in the official announcement; never sign a "claim + deposit" hybrid; never pay a fee or a "tax" to unlock an airdrop; revoke the wallet's token approvals right after claiming; treat every other link as a drainer. Cost: claim gas only. Time: 20 minutes.`,
    `Write the exit plan and the paperwork now, not at launch: your target (claim and sell a fixed share, or hold), how you unwind the position, and a log of every transaction with dates and amounts for taxes. A radar watches the field; it is not a vault and never becomes one. Cost: exit gas. Time: 20 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/* ------------------------------------------------------------------ caveats */

/** Honest flags a reader should see before farming a row. At most two, most severe first. */
export function caveatsFor(p: SnapshotProtocol): string[] {
  const out: string[] = [];
  const cat = (p.category ?? '').toLowerCase();
  if (cat.includes('bridge')) {
    out.push('a bridge of other systems: value may accrue to the parent chain or asset, not to a token of this row');
  }
  if (p.category === null) {
    out.push('DefiLlama records no category for it — treat every figure here as provisional until docs confirm it');
  }
  if (p.change_7d !== null && p.change_7d <= -20) {
    out.push(`TVL fell ${Math.abs(p.change_7d).toFixed(1)}% over 7 days — find out why (exploit, outflow, rotation) before farming it`);
  }
  if (p.listed_at === null) {
    out.push('no listing date on record — its age, and the survival signal it carries, cannot be checked');
  }
  return out.slice(0, 2);
}

/* ------------------------------------------------------------------ the board */

/** Build the ranked row for one protocol. */
const buildRow = (p: SnapshotProtocol, index: CompsIndex, asOf: string): Omit<BoardRow, 'rank'> => {
  const priced = price(p, index);
  const age = ageDays(asOf, p.listed_at);
  const est = priced.estimate;
  return {
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    age_days: age,
    implied_value_usd: priced.implied,
    implied_value_low_usd: priced.low,
    implied_value_high_usd: priced.high,
    implied_multiple: round4(priced.multiple),
    comps_n: priced.compsN,
    confidence: priced.confidence,
    caveats: caveatsFor(p),
    model: {
      method: MODEL_VERSION,
      shrinkage_k: SHRINK_K,
      comp_n: priced.compsN,
      raw_multiple: est.rawCat === null ? 'prior' : round4(Math.exp(est.rawCat)),
      shrunk_multiple: round4(Math.exp(est.rHat)),
      interval_low: round4(Math.exp(est.q1)),
      interval_high: round4(Math.exp(est.q3)),
      tvl_usd: p.tvl_usd,
    },
    farm_steps: farmPlan(p),
  };
};

/** The protocols the board ranks: every watchlist slug, plus the early radar below the floor. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const index = indexComps(snapshot.protocols);
  const bySlugMap = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlugMap.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankableEarly(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || bySlug(a, b))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => buildRow(p, index, snapshot.as_of));
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || bySlug(a, b));
  return scored.map((row, i) => ({ rank: i + 1, ...row }));
}

/** The live-token protocols, by market cap, for the reference view. Never on the ranked board. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || bySlug(a, b))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

const IMPLIED_BUCKETS: { label: string; test: (v: number) => boolean }[] = [
  { label: '< $10M', test: (v) => v < 10_000_000 },
  { label: '$10-25M', test: (v) => v >= 10_000_000 && v < 25_000_000 },
  { label: '$25-50M', test: (v) => v >= 25_000_000 && v < 50_000_000 },
  { label: '$50-100M', test: (v) => v >= 50_000_000 && v < 100_000_000 },
  { label: '$100-250M', test: (v) => v >= 100_000_000 && v < 250_000_000 },
  { label: '≥ $250M', test: (v) => v >= 250_000_000 },
];

/** Everything the dashboard renders, computed from the snapshot alone. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const index = indexComps(snapshot.protocols);
  const bt = backtest(snapshot.protocols);
  const watchlistSet = new Set(snapshot.watchlist);
  const watchlistRows = board.filter((r) => watchlistSet.has(r.slug));
  const earlySize = board.length - watchlistRows.length;
  const impliedSum = board.reduce((n, r) => n + r.implied_value_usd, 0);
  const watchlistTvl = watchlistRows.reduce((n, r) => n + r.tvl_usd, 0);
  const watchlistImplied = watchlistRows.reduce((n, r) => n + r.implied_value_usd, 0);
  const sortedImplied = [...board.map((r) => r.implied_value_usd)].sort((a, b) => a - b);
  const medianImplied = quantile(sortedImplied, 0.5);
  const g = index.globalSorted;
  const buckets = IMPLIED_BUCKETS.map(({ label, test }) => ({ label, count: board.filter((r) => test(r.implied_value_usd)).length }));
  const compCategories: CompCategory[] = [...index.byCategory.entries()]
    .map(([category, logs]) => {
      const n = logs.length;
      const raw = median(logs);
      const gMed = median(g);
      const shrunk = (n * raw + SHRINK_K * gMed) / (n + SHRINK_K);
      return {
        category,
        n,
        raw_multiple: round4(Math.exp(raw)),
        shrunk_multiple: round4(Math.exp(shrunk)),
        q25: round4(Math.exp(quantile(logs, 0.25))),
        q75: round4(Math.exp(quantile(logs, 0.75))),
      };
    })
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    // the fetch URL in the source string is transport detail, not provenance the page needs —
    // the page (and dossier) carries where the bytes came from, never a live address
    source: snapshot.source.replace(/\s*https?:\/\/\S+/g, ' ').replace(/\s{2,}/g, ' ').trim(),
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    method: `implied FDV = TVL x comps multiple; category median of ln(mcap/TVL) over ex-CEX token-carrying protocols, shrunk toward the global median with k=${SHRINK_K}; 50% interval from the category's own interquartile range. No growth or age multipliers (measured: correlation ~0).`,
    watchlist_size: snapshot.watchlist.length,
    watchlist_slugs: [...snapshot.watchlist].sort(),
    board_size: board.length,
    early_size: earlySize,
    live_size: LIVE_ROWS,
    watchlist_tvl_usd: Math.round(watchlistTvl),
    watchlist_implied_usd: Math.round(watchlistImplied),
    board_implied_usd: Math.round(impliedSum),
    median_implied_usd: Math.round(medianImplied),
    comps: {
      n: g.length,
      global_multiple: round4(Math.exp(median(g))),
      q25_multiple: round4(Math.exp(quantile(g, 0.25))),
      q75_multiple: round4(Math.exp(quantile(g, 0.75))),
      k: SHRINK_K,
    },
    backtest: bt,
    buckets,
    comp_categories: compCategories,
    rows: board,
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** A compact data.js: the dashboard's whole dataset as one script. No fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/** Why a board is not one the gate will take, or null. Mirrors the house gate's shape. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug(s): ${missing.slice(0, 5).join(', ')}`;
  }
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `rank at row ${i + 1} is ${board[i]!.rank}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share one implied value — a board that ranks nothing is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (!(r.implied_value_low_usd <= r.implied_value_usd && r.implied_value_usd <= r.implied_value_high_usd)) {
      return `${r.slug} has a misordered interval`;
    }
  }
  return null;
}
