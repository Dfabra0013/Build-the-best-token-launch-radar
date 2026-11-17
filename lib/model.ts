export interface ProtocolRecord {
  slug: string;
  name: string;
  category: string | null;
  chains: string[] | null;
  tvl_usd: number | null;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface RadarSnapshot {
  as_of?: string;
  source?: unknown;
  floor_usd?: number;
  protocols: ProtocolRecord[];
  watchlist: string[];
}

export interface RadarRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  token_record: 'not-recorded' | 'recorded-comparator';
  peer_multiple: number;
  momentum_factor: number;
  maturity_factor: number;
  chain_factor: number;
  observability_factor: number;
  peer_sample_size: number;
  confidence: 'high' | 'medium' | 'early';
  estimated_budget_usd: number;
  estimated_time_hours: number;
  risk_flags: string[];
  rationale: string;
}

export interface RadarResult {
  rows: RadarRow[];
  diagnostics: {
    as_of: string | null;
    source_count: number;
    candidate_count: number;
    selected_count: number;
    watchlist_count: number;
    watchlist_covered: number;
    tokened_peer_count: number;
    global_peer_multiple: number;
    category_models: Record<string, { multiple: number; peers: number; source: 'category' | 'global' }>;
    methodology: string[];
  };
}

type PeerModel = { multiple: number; peers: number; source: 'category' | 'global' };

const MAX_VALUE = 100_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const clamp = (value: number, lower: number, upper: number): number => Math.min(upper, Math.max(lower, value));
const finite = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const categoryKey = (value: string | null | undefined): string => (value || 'Uncategorized').trim() || 'Uncategorized';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function dayAge(date: string | null, asOf: string | undefined): number | null {
  if (!date || !asOf) return null;
  const then = Date.parse(date);
  const now = Date.parse(asOf);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.floor((now - then) / DAY));
}

function hasRecordedToken(protocol: ProtocolRecord): boolean {
  return Boolean(protocol.symbol) || Boolean(protocol.gecko_id) || finite(protocol.mcap_usd) > 0;
}

function readableChains(chains: string[] | null): string[] {
  if (!Array.isArray(chains)) return [];
  return chains.map((chain) => String(chain).trim()).filter(Boolean).slice(0, 12);
}

function specificAction(category: string, chain: string): string {
  const key = category.toLowerCase();
  if (key.includes('dex') || key.includes('exchange')) {
    return `Execute one small, reversible swap on ${chain}, then add only a capped test position to a live market if the interface shows transparent fees. Budget 25 to 75 dollars and 25 minutes; save the transaction record and never chase volume.`;
  }
  if (key.includes('lending') || key.includes('borrow')) {
    return `Supply a small amount of a liquid asset on ${chain} only after checking collateral factors and withdrawal conditions. Budget 30 to 100 dollars and 30 minutes; avoid borrowing simply to manufacture activity.`;
  }
  if (key.includes('yield') || key.includes('farm')) {
    return `Make one small deposit in the protocol's plainest live strategy on ${chain} after reading its withdrawal path. Budget 25 to 75 dollars and 25 minutes; avoid locked products whose exit mechanics you cannot explain.`;
  }
  if (key.includes('bridge') || key.includes('cross')) {
    return `Bridge a deliberately small test amount to or from ${chain} only if the official interface shows the route and final amount before signing. Budget 15 to 50 dollars and 20 minutes; retain both transaction hashes.`;
  }
  if (key.includes('derivative') || key.includes('perp')) {
    return `Open and close a tiny spot-sized workflow on ${chain} rather than using leverage. Budget 25 to 75 dollars and 25 minutes; record the fees and liquidation terms even when no position is retained.`;
  }
  if (key.includes('nft') || key.includes('gaming')) {
    return `Complete one legitimate on-chain workflow in the live product on ${chain} without buying speculative inventory. Budget 15 to 50 dollars and 30 minutes; keep only records that the protocol itself exposes.`;
  }
  if (key.includes('oracle') || key.includes('infra') || key.includes('tool')) {
    return `Use one production-facing workflow on ${chain} that the protocol documents, such as a supported request, integration, or dashboard action. Budget 10 to 40 dollars and 25 minutes; do not spam transactions for a reward.`;
  }
  return `Complete one small, economically meaningful live workflow on ${chain} after checking the protocol's current terms. Budget 20 to 60 dollars and 25 minutes; retain a clean record rather than creating repetitive activity.`;
}

function farmPlan(protocol: ProtocolRecord, age: number | null, watchlist: boolean): { steps: string[]; budget: number; hours: number; risks: string[] } {
  const chains = readableChains(protocol.chains);
  const chain = chains[0] || 'the protocol’s supported network';
  const category = categoryKey(protocol.category);
  const budget = clamp(Math.round(20 + Math.min(80, Math.sqrt(Math.max(0, finite(protocol.tvl_usd))) / 900)), 20, 100);
  const cadence = age === null || age < 90 ? 'every two weeks while the product matures' : 'once per month while the product remains useful';
  const watchline = watchlist
    ? 'This protocol is on the snapshot watchlist, which is a screening signal rather than evidence of a token event.'
    : 'This protocol is an early, below-floor candidate selected by the same model; verify its current status before using it.';
  const risks = ['No issuance or eligibility is implied', 'Smart-contract and bridge risk', 'Fees can exceed any potential value'];
  if (age === null) risks.push('Listing age was unavailable in the snapshot');
  if (chains.length > 1) risks.push('Cross-chain operational complexity');

  return {
    budget,
    hours: 2.5,
    risks,
    steps: [
      `Evidence check — Review ${protocol.name}'s live product and current terms before signing anything. Spend 15 minutes and 0 dollars; ${watchline}`,
      `Wallet hygiene — Use a dedicated wallet on ${chain}, fund only a ${budget}-dollar trial envelope, and write down the starting balance. Spend 15 minutes; never use borrowed funds or share recovery credentials.`,
      specificAction(category, chain),
      `Cadence — Repeat only a useful workflow ${cadence}, with a written maximum of one deliberate session. Spend 15 to 30 minutes per session; stop if the product, fees, or risk profile changes.`,
      `Proof discipline — Keep your own dated notes, transaction hashes, fee receipts, and any governance or feedback contribution. Spend 15 minutes; do not rely on screenshots or social claims as eligibility proof.`,
      `Exit rule — Recheck balances and approvals after each session, revoke anything you no longer need, and leave no capital parked solely for a possible token. Spend 10 minutes; capital preservation is the first constraint.`
    ]
  };
}

function fitPeerModels(protocols: ProtocolRecord[]): { global: number; models: Map<string, PeerModel>; tokened: number } {
  const observations = protocols
    .filter((protocol) => hasRecordedToken(protocol) && finite(protocol.tvl_usd) > 0 && finite(protocol.mcap_usd) > 0)
    .map((protocol) => ({
      category: categoryKey(protocol.category),
      logMultiple: Math.log(clamp(finite(protocol.mcap_usd) / finite(protocol.tvl_usd), 0.05, 80))
    }));
  const global = Math.exp(median(observations.map((observation) => observation.logMultiple)) || Math.log(1.8));
  const byCategory = new Map<string, number[]>();
  for (const observation of observations) {
    const bucket = byCategory.get(observation.category) || [];
    bucket.push(observation.logMultiple);
    byCategory.set(observation.category, bucket);
  }
  const models = new Map<string, PeerModel>();
  for (const [category, values] of byCategory) {
    if (values.length >= 3) {
      models.set(category, { multiple: clamp(Math.exp(median(values)), 0.2, 35), peers: values.length, source: 'category' });
    }
  }
  return { global: clamp(global, 0.2, 35), models, tokened: observations.length };
}

function makeRationale(input: {
  category: string;
  multiple: number;
  momentum: number;
  maturity: number;
  chains: number;
  peerSource: 'category' | 'global';
  peers: number;
}): string {
  const source = input.peerSource === 'category' ? `${input.peers} tokened ${input.category} peers` : 'the snapshot-wide tokened peer set';
  return `TVL is priced at a ${input.multiple.toFixed(2)}× peer multiple from ${source}, then adjusted by ${(input.momentum * 100).toFixed(0)}% seven-day momentum, ${(input.maturity * 100).toFixed(0)}% maturity, and ${input.chains} recorded chain${input.chains === 1 ? '' : 's'}.`;
}

export function buildRadar(snapshot: RadarSnapshot): RadarResult {
  const protocols = Array.isArray(snapshot.protocols) ? snapshot.protocols.filter((protocol) => protocol && protocol.slug && protocol.name) : [];
  const watchlist = new Set(Array.isArray(snapshot.watchlist) ? snapshot.watchlist : []);
  const fitted = fitPeerModels(protocols);
  const globalModel: PeerModel = { multiple: fitted.global, peers: fitted.tokened, source: 'global' };

  const candidates = protocols.filter((protocol) => !hasRecordedToken(protocol) || watchlist.has(protocol.slug));
  const scored = candidates.map((protocol) => {
    const category = categoryKey(protocol.category);
    const chains = readableChains(protocol.chains);
    const model = fitted.models.get(category) || globalModel;
    const tvl = Math.max(1, finite(protocol.tvl_usd));
    const change = protocol.change_7d === null || protocol.change_7d === undefined ? null : finite(protocol.change_7d);
    const growth = change === null ? 0 : clamp(change, -45, 100);
    const momentum = Math.exp(growth / 135);
    const age = dayAge(protocol.listed_at, snapshot.as_of);
    const maturity = age === null ? 0.94 : 0.82 + 0.34 * (1 - Math.exp(-age / 520));
    const chainFactor = 1 + Math.min(0.18, Math.sqrt(Math.max(0, chains.length - 1)) * 0.06);
    const observedFields = [protocol.category, change, protocol.listed_at, chains.length ? chains : null].filter(Boolean).length;
    const observability = 0.91 + observedFields * 0.0225;
    const raw = tvl * model.multiple * momentum * maturity * chainFactor * observability;
    const confidence: RadarRow['confidence'] = model.peers >= 8 && observedFields >= 3 ? 'high' : model.peers >= 3 && observedFields >= 2 ? 'medium' : 'early';
    const plan = farmPlan(protocol, age, watchlist.has(protocol.slug));
    return { protocol, category, chains, model, tvl, change, age, momentum, maturity, chainFactor, observability, raw, confidence, plan };
  });

  scored.sort((left, right) => right.raw - left.raw || left.protocol.slug.localeCompare(right.protocol.slug));
  const floor = Math.max(100, Math.min(220, scored.length));
  const chosen = scored.slice(0, floor);
  const chosenSlugs = new Set(chosen.map((item) => item.protocol.slug));
  for (const item of scored) {
    if (watchlist.has(item.protocol.slug) && !chosenSlugs.has(item.protocol.slug)) {
      chosen.push(item);
      chosenSlugs.add(item.protocol.slug);
    }
  }
  chosen.sort((left, right) => right.raw - left.raw || left.protocol.slug.localeCompare(right.protocol.slug));

  let previous = MAX_VALUE + 1;
  const rows = chosen.map((item, index): RadarRow => {
    const calculated = clamp(Math.floor(item.raw), 1, MAX_VALUE);
    const implied = Math.max(1, Math.min(calculated, previous - (index === 0 ? 0 : 1)));
    previous = implied;
    const tokenRecord: RadarRow['token_record'] = hasRecordedToken(item.protocol) ? 'recorded-comparator' : 'not-recorded';
    return {
      slug: item.protocol.slug,
      name: item.protocol.name,
      rank: index + 1,
      implied_value_usd: implied,
      farm_steps: item.plan.steps,
      category: item.category,
      chains: item.chains,
      tvl_usd: Math.round(item.tvl),
      change_7d: item.change,
      listed_at: item.protocol.listed_at,
      age_days: item.age,
      watchlist: watchlist.has(item.protocol.slug),
      token_record: tokenRecord,
      peer_multiple: Number(item.model.multiple.toFixed(4)),
      momentum_factor: Number(item.momentum.toFixed(4)),
      maturity_factor: Number(item.maturity.toFixed(4)),
      chain_factor: Number(item.chainFactor.toFixed(4)),
      observability_factor: Number(item.observability.toFixed(4)),
      peer_sample_size: item.model.peers,
      confidence: item.confidence,
      estimated_budget_usd: item.plan.budget,
      estimated_time_hours: item.plan.hours,
      risk_flags: item.plan.risks,
      rationale: makeRationale({
        category: item.category,
        multiple: item.model.multiple,
        momentum: item.momentum,
        maturity: item.maturity,
        chains: item.chains.length,
        peerSource: item.model.source,
        peers: item.model.peers
      })
    };
  });

  const categoryModels: Record<string, { multiple: number; peers: number; source: 'category' | 'global' }> = {};
  for (const category of new Set(rows.map((row) => row.category))) {
    const model = fitted.models.get(category) || globalModel;
    categoryModels[category] = { multiple: Number(model.multiple.toFixed(4)), peers: model.peers, source: model.source };
  }

  return {
    rows,
    diagnostics: {
      as_of: snapshot.as_of || null,
      source_count: protocols.length,
      candidate_count: candidates.length,
      selected_count: rows.length,
      watchlist_count: watchlist.size,
      watchlist_covered: rows.filter((row) => row.watchlist).length,
      tokened_peer_count: fitted.tokened,
      global_peer_multiple: Number(fitted.global.toFixed(4)),
      category_models: categoryModels,
      methodology: [
        'Candidate screen: protocols with no token record in the snapshot, plus every snapshot-watchlist protocol.',
        'Base value: TVL multiplied by a robust median market-cap-to-TVL multiple fitted from tokened snapshot peers.',
        'Adjustments: seven-day TVL momentum, days since the snapshot listing date, recorded chain breadth, and observed-field completeness.',
        'Interpretation: the result is an implied launch-value scenario, not a prediction that a token, reward, or eligibility event will occur.'
      ]
    }
  };
}
