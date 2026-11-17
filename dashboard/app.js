/* Token Launch Radar — the page's behaviour.
   Reads window.RADAR (written by the build from the sealed snapshot) and renders the board,
   the live-token reference view, the detail drawer and the methodology modal. No network,
   no framework, no dependencies. Every figure on screen derives from RADAR alone. */

'use strict';

const R = window.RADAR;
if (!R) {
  document.body.innerHTML = '<p style="padding:40px;font-family:monospace;color:#ff6b57">data.js did not load — run the entry: node main.ts</p>';
  throw new Error('missing window.RADAR');
}

/* ---------------- formatting ---------------- */

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmtUsd = (n) => {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};
const fmtUsdFull = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const fmtPct = (n) => (n === null || n === undefined ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`);
const fmtMult = (n) => `${n.toFixed(3)}×`;
const ageLabel = (days) => {
  if (days === null || days === undefined) return 'unknown';
  if (days < 90) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30.4)}mo`;
  return `${(days / 365.25).toFixed(1)}y`;
};
const changeClass = (n) => (n === null || n === undefined ? 'flat' : n > 0.05 ? 'up' : n < -0.05 ? 'down' : 'flat');
const changeArrow = (n) => (n === null || n === undefined ? '·' : n > 0.05 ? '▲' : n < -0.05 ? '▼' : '·');

/* strip any scheme:// host out of the snapshot's source string before it reaches the DOM,
   so the rendered page never carries a raw address */
const cleanSource = (s) => String(s ?? '').replace(/\s*https?:\/\/\S+/g, ' ').replace(/\s{2,}/g, ' ').trim();

/* ---------------- board state ---------------- */

const watchlist = new Set(R.watchlist_slugs);
const rows = R.rows.map((r) => ({ ...r, isWatchlist: watchlist.has(r.slug) }));
const live = R.live;

const state = {
  view: 'board',
  query: '',
  subset: 'all', // all | watchlist | early
  category: 'all',
  minTvl: 0,
  sort: 'rank',
  expanded: null, // slug of the row open in the drawer
};

const els = {
  snapshotChip: document.getElementById('snapshot-chip'),
  kpiWatchlist: document.getElementById('kpi-watchlist'),
  kpiBoard: document.getElementById('kpi-board'),
  kpiBoardSub: document.getElementById('kpi-board-sub'),
  kpiWlImplied: document.getElementById('kpi-wl-implied'),
  kpiMedian: document.getElementById('kpi-median'),
  kpiComps: document.getElementById('kpi-comps'),
  kpiCompsSub: document.getElementById('kpi-comps-sub'),
  search: document.getElementById('search'),
  segAll: document.getElementById('seg-all'),
  segWatchlist: document.getElementById('seg-watchlist'),
  segEarly: document.getElementById('seg-early'),
  sort: document.getElementById('sort'),
  minTvl: document.getElementById('min-tvl'),
  resultCount: document.getElementById('result-count'),
  categoryRail: document.getElementById('category-rail'),
  boardBody: document.getElementById('board-body'),
  emptyState: document.getElementById('empty-state'),
  liveBody: document.getElementById('live-body'),
  tabBoard: document.getElementById('tab-board'),
  tabLive: document.getElementById('tab-live'),
  boardPanel: document.getElementById('board-panel'),
  livePanel: document.getElementById('live-panel'),
  drawer: document.getElementById('drawer'),
  drawerBackdrop: document.getElementById('drawer-backdrop'),
  footerSource: document.getElementById('footer-source'),
  footerAsof: document.getElementById('footer-asof'),
};

/* global whisker scale: log-position across the board's own [min low, max high] */
const log2 = (v) => Math.log(Math.max(1, v)) / Math.LN2;
const LO = Math.min(...rows.map((r) => r.implied_value_low_usd));
const HI = Math.max(...rows.map((r) => r.implied_value_high_usd));
const span = log2(HI) - log2(LO) || 1;
const pos = (v) => ((log2(v) - log2(LO)) / span) * 100;

const whiskerHtml = (r) => `
  <div class="whisker" role="img" aria-label="50% interval from ${fmtUsd(r.implied_value_low_usd)} to ${fmtUsd(r.implied_value_high_usd)}, implied ${fmtUsd(r.implied_value_usd)}">
    <div class="rail"></div>
    <div class="span" style="left:${pos(r.implied_value_low_usd).toFixed(2)}%;width:${Math.max(1.2, pos(r.implied_value_high_usd) - pos(r.implied_value_low_usd)).toFixed(2)}%"></div>
    <div class="dot" style="left:${pos(r.implied_value_usd).toFixed(2)}%"></div>
  </div>`;

const confidenceHtml = (c) => `<span class="conf conf-${escapeHtml(c.replace(/\s+/g, '-'))}"><span class="conf-dot"></span>${escapeHtml(c)}</span>`;

/* ---------------- filtering & sorting ---------------- */

const matches = (r) => {
  if (state.subset === 'watchlist' && !r.isWatchlist) return false;
  if (state.subset === 'early' && r.isWatchlist) return false;
  if (r.tvl_usd < state.minTvl) return false;
  if (state.category !== 'all' && (r.category ?? '—') !== state.category) return false;
  if (state.query) {
    const hay = `${r.name} ${r.slug} ${r.chains.join(' ')} ${r.category ?? ''}`.toLowerCase();
    if (!state.query.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
};

const SORTS = {
  rank: (a, b) => a.rank - b.rank,
  tvl: (a, b) => b.tvl_usd - a.tvl_usd,
  change: (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity),
  age: (a, b) => (a.age_days ?? Infinity) - (b.age_days ?? Infinity),
  name: (a, b) => a.name.localeCompare(b.name),
  category: (a, b) => String(a.category ?? '').localeCompare(String(b.category ?? '')) || a.rank - b.rank,
};

const visibleRows = () => rows.filter(matches).sort(SORTS[state.sort] ?? SORTS.rank);

/* ---------------- rendering ---------------- */

function renderHeader() {
  els.snapshotChip.innerHTML = `<strong>Snapshot ${escapeHtml(R.as_of)}</strong><br>${escapeHtml(cleanSource(R.source))}<br>${rows.length} pre-token rows · floor ${fmtUsd(R.floor_usd).replace('.0', '')}`;
  els.kpiWatchlist.textContent = `${R.watchlist_size}/${R.watchlist_size}`;
  els.kpiBoard.textContent = String(R.board_size);
  els.kpiBoardSub.textContent = `${R.watchlist_size} watchlist + ${R.early_size} early finds`;
  els.kpiWlImplied.textContent = fmtUsd(R.watchlist_implied_usd);
  els.kpiMedian.textContent = fmtUsd(R.median_implied_usd);
  els.kpiComps.textContent = String(R.comps.n);
  els.kpiCompsSub.textContent = `ex-CEX token-carrying · shrinkage k=${R.comps.k}`;
  els.footerSource.textContent = cleanSource(R.source);
  els.footerAsof.textContent = R.as_of;
}

function renderCategoryRail() {
  const counts = new Map();
  for (const r of rows) counts.set(r.category ?? 'Uncategorised', (counts.get(r.category ?? 'Uncategorised') ?? 0) + 1);
  const cats = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const chip = (label, value, count) =>
    `<button class="cat-chip" data-category="${escapeHtml(value)}" aria-pressed="${String(state.category === value)}">${escapeHtml(label)}${count === null ? '' : ` <span style="opacity:.65">${count}</span>`}</button>`;
  els.categoryRail.innerHTML =
    chip(`All categories · ${rows.length}`, 'all', null) + cats.map(([c, n]) => chip(c, c, n)).join('');
}

function rowHtml(r) {
  const chg = fmtPct(r.change_7d);
  const range = `${fmtUsd(r.implied_value_low_usd)}–${fmtUsd(r.implied_value_high_usd)}`;
  return `<tr tabindex="0" data-slug="${escapeHtml(r.slug)}" class="${r.isWatchlist ? 'watchlist-row' : ''}" aria-label="${escapeHtml(r.name)}, implied ${fmtUsd(r.implied_value_usd)}, ${r.farm_steps.length} farm steps">
    <td class="rank ${r.rank <= 3 ? 'top' : ''}">${r.rank}</td>
    <td><span class="proto"><span class="name">${escapeHtml(r.name)}${r.isWatchlist ? '<span class="wl-badge">WATCHLIST</span>' : ''}</span><span class="chains">${escapeHtml(r.chains.slice(0, 4).join(' · ') || 'chain unrecorded')}</span></span></td>
    <td><span class="cat-tag">${escapeHtml(r.category ?? '—')}</span></td>
    <td class="num">${fmtUsd(r.tvl_usd)}</td>
    <td class="num ${changeClass(r.change_7d)}">${changeArrow(r.change_7d)} ${chg}</td>
    <td class="implied"><div class="value">${fmtUsd(r.implied_value_usd)}</div><div class="range">${range}</div></td>
    <td>${whiskerHtml(r)}</td>
    <td>${confidenceHtml(r.confidence)}</td>
    <td class="row-cta">Farm plan →</td>
  </tr>`;
}

function renderBoard() {
  const visible = visibleRows();
  els.boardBody.innerHTML = visible.map(rowHtml).join('');
  els.emptyState.hidden = visible.length !== 0;
  els.resultCount.innerHTML = `<b>${visible.length}</b> of ${rows.length} rows`;
  for (const th of document.querySelectorAll('#board-table thead th[data-sort]')) {
    th.querySelector('.sort-mark').textContent = th.dataset.sort === state.sort ? (state.sort === 'name' || state.sort === 'category' ? ' ↑' : ' ↓') : '';
  }
}

function renderLive() {
  els.liveBody.innerHTML = live
    .map((p, i) => {
      const ratio = p.mcap_usd ? (p.mcap_usd / p.tvl_usd) : null;
      const chg = p.change_7d;
      return `<tr>
        <td class="rank">${i + 1}</td>
        <td><span class="proto"><span class="name">${escapeHtml(p.name)}</span><span class="chains">${escapeHtml(p.chains.slice(0, 4).join(' · '))}</span></span></td>
        <td><span class="cat-tag">${escapeHtml(p.category ?? '—')}</span></td>
        <td class="num">${fmtUsd(p.tvl_usd)}</td>
        <td class="num">${fmtUsd(p.mcap_usd ?? 0)}</td>
        <td class="num ${ratio === null ? 'flat' : ratio >= 1 ? 'up' : 'flat'}">${ratio === null ? '—' : fmtMult(ratio)}</td>
        <td class="num ${changeClass(chg)}">${changeArrow(chg)} ${fmtPct(chg)}</td>
      </tr>`;
    })
    .join('');
}

/* ---------------- farm plan (checklist, persisted locally) ---------------- */

const planKey = (slug) => `radar.farm.${slug}`;
const loadChecked = (slug) => {
  try {
    const raw = window.localStorage.getItem(planKey(slug));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
};
const saveChecked = (slug, set) => {
  try {
    window.localStorage.setItem(planKey(slug), JSON.stringify([...set]));
  } catch {
    /* localStorage unavailable (private mode, file://) — the checklist still works in memory */
  }
};

function renderFarm(r) {
  const container = document.getElementById('drawer-farm');
  const checked = loadChecked(r.slug);
  container.innerHTML = r.farm_steps
    .map((step, i) => {
      const id = `step-${i}`;
      const done = checked.has(i);
      return `<label class="farm-step ${done ? 'done' : ''}" for="${id}">
        <input type="checkbox" id="${id}" data-step="${i}" ${done ? 'checked' : ''}>
        <span class="step-n">${String(i + 1).padStart(2, '0')}</span>
        <span class="step-text">${escapeHtml(step)}</span>
      </label>`;
    })
    .join('');
  const fill = document.getElementById('farm-fill');
  const count = document.getElementById('farm-count');
  const paint = () => {
    const n = container.querySelectorAll('input[type="checkbox"]:checked').length;
    fill.style.width = `${(n / r.farm_steps.length) * 100}%`;
    count.textContent = `${n}/${r.farm_steps.length}`;
  };
  paint();
  container.addEventListener('change', (event) => {
    const box = event.target.closest('input[data-step]');
    if (!box) return;
    const current = loadChecked(r.slug);
    const step = Number(box.dataset.step);
    if (box.checked) current.add(step);
    else current.delete(step);
    saveChecked(r.slug, current);
    box.closest('.farm-step').classList.toggle('done', box.checked);
    paint();
  });
}

const copyPlan = (r) => {
  const lines = [
    `${r.name} — farm plan from the Token Launch Radar (board rank #${r.rank}, implied FDV ${fmtUsdFull(r.implied_value_usd)})`,
    ...r.farm_steps.map((s, i) => `${i + 1}. ${s}`),
    'Not investment advice; airdrops are never guaranteed. Size only what you can lose.',
  ];
  const text = lines.join('\n');
  const done = () => {
    const btn = document.getElementById('copy-plan');
    btn.textContent = 'Copied ✓';
    window.setTimeout(() => (btn.textContent = 'Copy plan as text'), 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, done);
  } else {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); } catch { /* clipboard unavailable */ }
    area.remove();
    done();
  }
};

/* ---------------- detail drawer ---------------- */

const statHtml = (k, v, small) =>
  `<div class="stat"><div class="k">${escapeHtml(k)}</div><div class="v">${v}${small ? ` <small>${escapeHtml(small)}</small>` : ''}</div></div>`;

function openDrawer(slug) {
  const r = rows.find((row) => row.slug === slug);
  if (!r) return;
  state.expanded = slug;

  document.getElementById('drawer-title').textContent = r.name;
  document.getElementById('drawer-slug').textContent = `${r.slug} · rank #${r.rank}`;
  const chips = [
    r.category ? `<span class="cat-tag">${escapeHtml(r.category)}</span>` : '',
    r.isWatchlist ? '<span class="wl-badge" style="font-size:9.5px">WATCHLIST</span>' : '<span class="cat-tag" style="color:var(--mint);border-color:rgba(53,224,161,.4)">early find</span>',
    ...r.chains.slice(0, 5).map((c) => `<span class="cat-tag">${escapeHtml(c)}</span>`),
  ].filter(Boolean);
  document.getElementById('drawer-chips').innerHTML = chips.join('');

  document.getElementById('drawer-stats').innerHTML =
    statHtml('Implied FDV', fmtUsd(r.implied_value_usd), `p25–p75 ${fmtUsd(r.implied_value_low_usd)}–${fmtUsd(r.implied_value_high_usd)}`) +
    statHtml('TVL', fmtUsd(r.tvl_usd), r.change_7d === null ? '7d Δ unreported' : `7d ${fmtPct(r.change_7d)}`) +
    statHtml('vs TVL', fmtMult(r.implied_multiple), `${r.comps_n} comps · ${r.confidence}`) +
    statHtml('Age', ageLabel(r.age_days), r.listed_at ? `listed ${r.listed_at}` : 'listed unrecorded') +
    statHtml('Rank', `#${r.rank}`, `of ${R.board_size} rows`) +
    statHtml('Token status', 'pre-token', 'no token carried');

  const est = r.model;
  const wfRows = [
    { k: 'TVL (DefiLlama record)', v: fmtUsdFull(r.tvl_usd), note: 'the only fundamental the snapshot carries' },
    { k: `Category comps · raw median`, v: est.raw_multiple === 'prior' ? 'n < 3 → prior' : fmtMult(Number(est.raw_multiple)), note: `category: ${r.category ?? 'uncategorised'} · n=${est.comp_n}` },
    { k: `Shrunk estimate (k=${est.shrinkage_k})`, v: fmtMult(Number(est.shrunk_multiple)), note: 'empirical-Bayes toward the global comps median' },
    { k: '× TVL → implied FDV', v: fmtUsdFull(r.implied_value_usd), note: 'rounded to whole dollars; never below $1' },
  ];
  document.getElementById('drawer-waterfall').innerHTML = wfRows
    .map((w) => `<div class="wf-row"><span>${escapeHtml(w.k)}<br><span class="note">${escapeHtml(w.note)}</span></span><span class="eq">${escapeHtml(w.v)}</span></div>`)
    .join('');
  document.getElementById('drawer-backtest').innerHTML =
    `leave-one-out over the ${R.backtest.n} comps: <b>median error ${R.backtest.median_ape_pct}%</b> · within 2× for <b>${R.backtest.within2x_pct}%</b> · 50% interval covered <b>${R.backtest.coverage50_pct}%</b> of the time`;

  document.getElementById('drawer-caveats').innerHTML = (r.caveats || [])
    .map((c) => `<div class="caveat"><svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1 13 12H1L7 1Z" fill="none" stroke="#f2c14e" stroke-width="1.3" stroke-linejoin="round"/><path d="M7 5.4v3.2" stroke="#f2c14e" stroke-width="1.4" stroke-linecap="round"/></svg><span>${escapeHtml(c)}</span></div>`)
    .join('');

  renderFarm(r);
  document.getElementById('copy-plan').onclick = () => copyPlan(r);

  els.drawer.classList.add('open');
  els.drawerBackdrop.classList.add('open');
  els.drawer.setAttribute('aria-hidden', 'false');
  els.drawerBackdrop.setAttribute('aria-hidden', 'false');
}

function closeDrawer() {
  state.expanded = null;
  els.drawer.classList.remove('open');
  els.drawerBackdrop.classList.remove('open');
  els.drawer.setAttribute('aria-hidden', 'true');
  els.drawerBackdrop.setAttribute('aria-hidden', 'true');
}

/* ---------------- methodology modal ---------------- */

function openMethodology() {
  document.getElementById('m-comp-n').textContent = String(R.comps.n);
  document.getElementById('m-global-mult').textContent = fmtMult(R.comps.global_multiple);
  document.getElementById('m-q25').textContent = fmtMult(R.comps.q25_multiple);
  document.getElementById('m-q75').textContent = fmtMult(R.comps.q75_multiple);
  document.getElementById('m-backtest').textContent =
    `leave-one-out over ${R.backtest.n} comparables, held-out row used for nothing\n` +
    `  median absolute error   ${R.backtest.median_ape_pct}%\n` +
    `  mean absolute error     ${R.backtest.mape_pct}%   (dominated by the fattest misses)\n` +
    `  within 2x of the actual ${R.backtest.within2x_pct}%\n` +
    `  50% interval covered    ${R.backtest.coverage50_pct}% of the time`;
  document.querySelector('#m-categories tbody').innerHTML = R.comp_categories
    .slice(0, 16)
    .map((c) => `<tr><td>${escapeHtml(c.category)}</td><td>${c.n}</td><td>${fmtMult(c.raw_multiple)}</td><td>${fmtMult(c.shrunk_multiple)}</td><td>${fmtMult(c.q25)}</td><td>${fmtMult(c.q75)}</td></tr>`)
    .join('');
  const max = Math.max(...R.buckets.map((b) => b.count), 1);
  document.getElementById('m-buckets').innerHTML = R.buckets
    .map((b) => `<div class="bucket-row"><span>${escapeHtml(b.label)}</span><div class="bucket-track"><div class="bucket-fill" style="width:${((b.count / max) * 100).toFixed(1)}%"></div></div><span class="mono">${b.count}</span></div>`)
    .join('');
  const modal = document.getElementById('methodology');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeMethodology() {
  const modal = document.getElementById('methodology');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

/* ---------------- events ---------------- */

els.search.addEventListener('input', (e) => { state.query = e.target.value.trim().toLowerCase(); renderBoard(); });
els.sort.addEventListener('change', (e) => { state.sort = e.target.value; renderBoard(); });
els.minTvl.addEventListener('change', (e) => { state.minTvl = Number(e.target.value) || 0; renderBoard(); });

const setSubset = (subset) => {
  state.subset = subset;
  for (const [id, name] of [['segAll', 'all'], ['segWatchlist', 'watchlist'], ['segEarly', 'early']]) {
    els[id].setAttribute('aria-pressed', String(name === subset));
  }
  renderBoard();
};
els.segAll.addEventListener('click', () => setSubset('all'));
els.segWatchlist.addEventListener('click', () => setSubset('watchlist'));
els.segEarly.addEventListener('click', () => setSubset('early'));

els.categoryRail.addEventListener('click', (e) => {
  const chip = e.target.closest('.cat-chip[data-category]');
  if (!chip) return;
  state.category = chip.dataset.category;
  renderCategoryRail();
  renderBoard();
});

document.getElementById('board-table').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (th) {
    state.sort = th.dataset.sort;
    if ([...els.sort.options].some((o) => o.value === state.sort)) els.sort.value = state.sort;
    renderBoard();
    return;
  }
  const tr = e.target.closest('tr[data-slug]');
  if (tr) openDrawer(tr.dataset.slug);
});
document.getElementById('board-table').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const tr = e.target.closest('tr[data-slug]');
  if (tr) { e.preventDefault(); openDrawer(tr.dataset.slug); }
});

const setView = (view) => {
  state.view = view;
  els.tabBoard.setAttribute('aria-selected', String(view === 'board'));
  els.tabLive.setAttribute('aria-selected', String(view === 'live'));
  els.boardPanel.hidden = view !== 'board';
  els.livePanel.hidden = view !== 'live';
};
els.tabBoard.addEventListener('click', () => setView('board'));
els.tabLive.addEventListener('click', () => setView('live'));

document.getElementById('drawer-close').addEventListener('click', closeDrawer);
els.drawerBackdrop.addEventListener('click', closeDrawer);
document.getElementById('methodology-open').addEventListener('click', openMethodology);
document.getElementById('methodology-close').addEventListener('click', closeMethodology);
document.getElementById('methodology').addEventListener('click', (e) => { if (e.target.id === 'methodology') closeMethodology(); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeDrawer(); closeMethodology(); return; }
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
    e.preventDefault();
    els.search.focus();
  }
});

/* ---------------- boot ---------------- */

renderHeader();
renderCategoryRail();
renderBoard();
renderLive();
