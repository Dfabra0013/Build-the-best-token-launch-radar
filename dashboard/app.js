(() => {
  const data = window.RADAR_DATA;
  const $ = (selector) => document.querySelector(selector);
  const boardRows = $('#boardRows');
  const pageSize = 12;
  const state = { query: '', category: 'all', chain: 'all', watchlist: false, momentum: false, sort: 'rank', direction: 1, page: 0 };

  if (!data || !Array.isArray(data.rows)) {
    boardRows.innerHTML = '<tr class="empty-row"><td colspan="7">The radar data file is unavailable.</td></tr>';
    return;
  }

  const formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const escape = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const money = (value) => `$${compact.format(Number(value || 0))}`;
  const preciseMoney = (value) => `$${formatter.format(Math.round(Number(value || 0)))}`;
  const signed = (value) => value === null || value === undefined ? 'Unreported' : `${value > 0 ? '+' : ''}${Number(value).toFixed(1)}%`;

  function fillSelect(select, values, label) {
    const options = ['<option value="all">All ' + label + '</option>']
      .concat(values.map((value) => `<option value="${escape(value)}">${escape(value)}</option>`));
    select.innerHTML = options.join('');
  }

  function populateSummary() {
    const diagnostics = data.diagnostics || {};
    $('#asOf').textContent = diagnostics.as_of ? `As of ${diagnostics.as_of}` : 'Sealed snapshot';
    $('#candidateCount').textContent = formatter.format(diagnostics.selected_count || data.rows.length);
    $('#watchlistCount').textContent = `${formatter.format(diagnostics.watchlist_covered || 0)}/${formatter.format(diagnostics.watchlist_count || 0)}`;
    $('#peerCount').textContent = formatter.format(diagnostics.tokened_peer_count || 0);
    $('#medianMultiple').textContent = `${Number(diagnostics.global_peer_multiple || 0).toFixed(2)}×`;
    $('#coverageBadge').textContent = `${diagnostics.watchlist_covered || 0}/${diagnostics.watchlist_count || 0} covered`;
    $('#watchlistFilterCount').textContent = String(data.rows.filter((row) => row.watchlist).length);
    fillSelect($('#categoryFilter'), [...new Set(data.rows.map((row) => row.category))].sort(), 'sectors');
    fillSelect($('#chainFilter'), [...new Set(data.rows.flatMap((row) => row.chains || []))].sort(), 'chains');

    const methods = Array.isArray(data.methodology) ? data.methodology : [];
    $('#methodSteps').innerHTML = methods.map((method, index) => `<article class="method-step"><span>0${index + 1}</span><div><strong>${['Candidate screen', 'Peer calibration', 'Observable adjustments', 'Decision discipline'][index] || 'Model note'}</strong><p>${escape(method)}</p></div></article>`).join('');
  }

  function filteredRows() {
    const needle = state.query.trim().toLowerCase();
    const rows = data.rows.filter((row) => {
      const haystack = [row.name, row.slug, row.category, ...(row.chains || [])].join(' ').toLowerCase();
      return (!needle || haystack.includes(needle))
        && (state.category === 'all' || row.category === state.category)
        && (state.chain === 'all' || (row.chains || []).includes(state.chain))
        && (!state.watchlist || row.watchlist)
        && (!state.momentum || Number(row.change_7d || 0) > 0);
    });
    const compare = (left, right) => {
      const a = left[state.sort];
      const b = right[state.sort];
      if (typeof a === 'string' || typeof b === 'string') return String(a || '').localeCompare(String(b || '')) * state.direction;
      return (Number(a ?? -Infinity) - Number(b ?? -Infinity)) * state.direction;
    };
    return rows.sort(compare);
  }

  function confidenceDot(confidence) {
    return confidence === 'high' ? 'high' : confidence === 'medium' ? 'medium' : 'early';
  }

  function rowMarkup(row) {
    const momentumClass = row.change_7d === null || row.change_7d === undefined ? 'flat' : Number(row.change_7d) > 0 ? 'up' : '';
    const chainText = (row.chains || []).slice(0, 2).join(' · ') || 'Chain unreported';
    return `<tr data-slug="${escape(row.slug)}" tabindex="0" aria-label="Open ${escape(row.name)} detail">
      <td class="rank-cell">${String(row.rank).padStart(2, '0')}</td>
      <td class="name-cell"><strong>${escape(row.name)}</strong><small>${row.watchlist ? '<i class="watch-indicator"></i> Watchlist · ' : ''}${escape(row.category)} · ${escape(chainText)}</small></td>
      <td class="value-cell">${money(row.implied_value_usd)}<span class="subvalue">${row.confidence} confidence</span></td>
      <td class="value-cell">${money(row.tvl_usd)}<span class="subvalue">snapshot TVL</span></td>
      <td><span class="signal ${momentumClass}"><i></i>${signed(row.change_7d)}</span></td>
      <td class="peer-fit">${Number(row.peer_multiple).toFixed(2)}×<span class="subvalue">${row.peer_sample_size} peers</span></td>
      <td class="path-cell"><button class="path-button" data-open="${escape(row.slug)}">View plan <span>→</span></button></td>
    </tr>`;
  }

  function render() {
    const rows = filteredRows();
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * pageSize;
    const shown = rows.slice(start, start + pageSize);
    boardRows.innerHTML = shown.length ? shown.map(rowMarkup).join('') : '<tr class="empty-row"><td colspan="7">No protocols match this lens. Clear a filter to widen the radar.</td></tr>';
    $('#resultSummary').textContent = `${formatter.format(rows.length)} of ${formatter.format(data.rows.length)} candidates shown`;
    $('#pageStatus').textContent = shown.length ? `Showing ${start + 1}–${Math.min(start + pageSize, rows.length)} by ${state.sort === 'rank' ? 'model rank' : state.sort.replaceAll('_', ' ')}` : 'No candidates';
    $('#pageLabel').textContent = `${state.page + 1} / ${pages}`;
    $('#previousPage').disabled = state.page === 0;
    $('#nextPage').disabled = state.page >= pages - 1;
  }

  function factor(label, value, hint) {
    return `<div><span>${escape(label)}</span><strong>${escape(value)}</strong><small>${escape(hint)}</small></div>`;
  }

  function openDetail(slug) {
    const row = data.rows.find((candidate) => candidate.slug === slug);
    if (!row) return;
    const drawer = $('#detailDrawer');
    const primaryChain = (row.chains || [])[0] || 'Not reported';
    $('#detailRank').textContent = `SIGNAL #${String(row.rank).padStart(2, '0')}`;
    $('#detailContent').innerHTML = `
      <section class="detail-heading"><span class="tag">${row.watchlist ? 'SEALED WATCHLIST' : 'EARLY DISCOVERY'}</span><h2 id="detailName">${escape(row.name)}</h2><p>${escape(row.category)} · ${escape((row.chains || []).join(' · ') || 'Chain unreported')} · ${row.age_days === null ? 'listing age unavailable' : `${row.age_days} days observed`}</p></section>
      <section class="waterfall">
        ${factor('Implied scenario', preciseMoney(row.implied_value_usd), 'not a launch prediction')}
        ${factor('Snapshot TVL', preciseMoney(row.tvl_usd), 'value anchor')}
        ${factor('Peer multiple', `${Number(row.peer_multiple).toFixed(2)}×`, `${row.peer_sample_size} tokened peers`) }
        ${factor('7d momentum', signed(row.change_7d), `${Number(row.momentum_factor).toFixed(2)}× factor`) }
        ${factor('Maturity', `${Number(row.maturity_factor).toFixed(2)}×`, row.age_days === null ? 'age unreported' : `${row.age_days} days`) }
        ${factor('Chain breadth', `${Number(row.chain_factor).toFixed(2)}×`, primaryChain) }
      </section>
      <section class="detail-section"><h3>Why this is ranked here</h3><p>${escape(row.rationale)}</p></section>
      <section class="detail-section"><h3>A conservative research path</h3><p>Estimated maximum trial budget: <strong>${preciseMoney(row.estimated_budget_usd)}</strong> across about <strong>${row.estimated_time_hours} hours</strong>. Follow only steps that remain useful without a token.</p><ol class="plan">${row.farm_steps.map((step) => `<li>${escape(step)}</li>`).join('')}</ol></section>
      <section class="detail-section"><h3>Risk constraints</h3><ul class="risk-list">${row.risk_flags.map((risk) => `<li>${escape(risk)}</li>`).join('')}</ul></section>`;
    drawer.setAttribute('aria-hidden', 'false');
    $('#scrim').classList.add('visible');
    document.body.style.overflow = 'hidden';
    $('#closeDrawer').focus();
  }

  function closeDetail() {
    $('#detailDrawer').setAttribute('aria-hidden', 'true');
    $('#scrim').classList.remove('visible');
    document.body.style.overflow = '';
  }

  function resetFilters() {
    state.query = ''; state.category = 'all'; state.chain = 'all'; state.watchlist = false; state.momentum = false; state.page = 0;
    $('#searchInput').value = ''; $('#categoryFilter').value = 'all'; $('#chainFilter').value = 'all';
    $('#watchlistFilter').setAttribute('aria-pressed', 'false'); $('#momentumFilter').setAttribute('aria-pressed', 'false'); render();
  }

  $('#searchInput').addEventListener('input', (event) => { state.query = event.target.value; state.page = 0; render(); });
  $('#categoryFilter').addEventListener('change', (event) => { state.category = event.target.value; state.page = 0; render(); });
  $('#chainFilter').addEventListener('change', (event) => { state.chain = event.target.value; state.page = 0; render(); });
  $('#watchlistFilter').addEventListener('click', (event) => { state.watchlist = !state.watchlist; event.currentTarget.setAttribute('aria-pressed', String(state.watchlist)); state.page = 0; render(); });
  $('#momentumFilter').addEventListener('click', (event) => { state.momentum = !state.momentum; event.currentTarget.setAttribute('aria-pressed', String(state.momentum)); state.page = 0; render(); });
  $('#clearFilters').addEventListener('click', resetFilters);
  $('#previousPage').addEventListener('click', () => { state.page--; render(); });
  $('#nextPage').addEventListener('click', () => { state.page++; render(); });
  document.querySelectorAll('[data-sort]').forEach((button) => button.addEventListener('click', () => { const sort = button.dataset.sort; if (!sort) return; state.direction = state.sort === sort ? state.direction * -1 : sort === 'name' ? 1 : -1; state.sort = sort; state.page = 0; render(); }));
  boardRows.addEventListener('click', (event) => { const button = event.target.closest('[data-open]'); const row = event.target.closest('tr[data-slug]'); openDetail((button || row)?.dataset.open || row?.dataset.slug); });
  boardRows.addEventListener('keydown', (event) => { if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('tr[data-slug]')) { event.preventDefault(); openDetail(event.target.dataset.slug); } });
  $('#closeDrawer').addEventListener('click', closeDetail); $('#scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDetail(); });
  $('#jumpToBoard').addEventListener('click', () => $('#board').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  $('#openMethod').addEventListener('click', () => $('#method').scrollIntoView({ behavior: 'smooth', block: 'start' }));

  populateSummary();
  render();
})();
