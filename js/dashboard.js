// Dashboard: loads data/site_votes.json (built by scripts/build_site_data.js)
// and recomputes every tile, chart, and the table from the raw votes in the
// browser whenever a filter changes.

let D = null;            // the loaded data set
let charts = {};         // canvasId -> Chart instance

const STANCE_LABEL = {
  'management': 'Management proposals',
  'pro-ESG': 'Shareholder: pro-ESG',
  'anti-ESG': 'Shareholder: anti-ESG',
  'unclear': 'Shareholder: unclear',
  'governance': 'Shareholder: governance & other',
};
const GROUPS = ['Big Three', 'Active managers', 'ESG families'];
const MEASURES = {
  for: { label: '% voted FOR', pct: true },
  with: { label: '% with management', pct: true },
  against: { label: '% against management', pct: true },
  count: { label: 'Votes', pct: false },
};

const state = {
  families: [], labels: [], styles: [], types: [], topics: [], companies: [],
  qFrom: 0, qTo: 0, measure: 'for', breakdown: 'group',
};

// ---------------------------------------------------------------------------
// Measures. Each works from running tallies so any grouping is one pass.
// ---------------------------------------------------------------------------
let IS_CAST = [], IS_FOR = [];
const tally = () => ({ n: 0, cast: 0, forV: 0, rec: 0, withM: 0 });
function add(t, i) {
  const c = D.cols;
  t.n++;
  if (IS_CAST[c.v[i]]) { t.cast++; if (IS_FOR[c.v[i]]) t.forV++; }
  if (c.wm[i] !== -1) { t.rec++; if (c.wm[i] === 1) t.withM++; }
}
function measureOf(t, m = state.measure) {
  if (m === 'count') return t.n;
  if (m === 'for') return t.cast ? 100 * t.forV / t.cast : null;
  if (m === 'with') return t.rec ? 100 * t.withM / t.rec : null;
  if (m === 'against') return t.rec ? 100 * (t.rec - t.withM) / t.rec : null;
}
const round1 = x => (x == null ? null : Math.round(x * 10) / 10);
const fmtMeasure = (x, m = state.measure) => (x == null ? '–' : MEASURES[m].pct ? `${round1(x).toFixed(1)}%` : Math.round(x).toLocaleString());

// ---------------------------------------------------------------------------
// Filtering.
// ---------------------------------------------------------------------------
function filteredIndex() {
  const c = D.cols, F = D.funds, L = D.lists;
  const fam = new Set(state.families), lab = new Set(state.labels), sty = new Set(state.styles);
  const typ = new Set(state.types.map(t => L.stance.indexOf(t)));
  const top = new Set(state.topics.map(t => L.category.indexOf(t)));
  const com = new Set(state.companies);
  const fundOk = F.map(f => (!fam.size || fam.has(f.family)) && (!lab.size || lab.has(f.label)) && (!sty.size || sty.has(f.style)));
  const out = [];
  for (let i = 0; i < D.n; i++) {
    if (!fundOk[c.f[i]]) continue;
    if (c.q[i] < state.qFrom || c.q[i] > state.qTo) continue;
    if (typ.size && !typ.has(c.st[i])) continue;
    if (top.size && !top.has(c.cat[i])) continue;
    if (com.size && !com.has(c.c[i])) continue;
    out.push(i);
  }
  return out;
}

function breakdownKey(i) {
  const f = D.funds[D.cols.f[i]];
  if (state.breakdown === 'group') return f.group;
  if (state.breakdown === 'family') return f.family;
  if (state.breakdown === 'label') return f.label === 'ESG' ? 'ESG-labeled funds' : 'Conventional funds';
  return f.name;
}

// ---------------------------------------------------------------------------
// Filter controls (chips, quarter slider, company type-ahead).
// ---------------------------------------------------------------------------
let renderQueued = false;
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

function chip(label, pressed, extraClass) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip' + (extraClass ? ' ' + extraClass : '');
  b.textContent = label;
  b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  return b;
}

function drawChipGroup(containerId, options, key, labelOf = x => x) {
  const box = document.getElementById(containerId);
  box.innerHTML = '';
  const selected = state[key];
  const all = chip('All', selected.length === 0, 'chip-all');
  all.addEventListener('click', () => { state[key] = []; drawChipGroup(containerId, options, key, labelOf); queueRender(); });
  box.appendChild(all);
  options.forEach(opt => {
    const b = chip(labelOf(opt), selected.includes(opt));
    b.addEventListener('click', () => {
      const next = selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt];
      state[key] = next.length === options.length ? [] : next; // everything = no filter
      drawChipGroup(containerId, options, key, labelOf);
      queueRender();
    });
    box.appendChild(b);
  });
}

function syncSlider() {
  const Q = D.lists.quarter, last = Q.length - 1;
  document.getElementById('f-q-from').value = state.qFrom;
  document.getElementById('f-q-to').value = state.qTo;
  const a = state.qFrom / last * 100, b = state.qTo / last * 100;
  const fill = document.querySelector('#q-slider .range-fill');
  fill.style.left = a + '%';
  fill.style.width = (b - a) + '%';
  document.getElementById('q-readout').textContent =
    state.qFrom === state.qTo ? Q[state.qFrom] : `${Q[state.qFrom]} – ${Q[state.qTo]}`;
}

function setupSlider() {
  const from = document.getElementById('f-q-from'), to = document.getElementById('f-q-to');
  const last = D.lists.quarter.length - 1;
  [from, to].forEach(el => { el.min = 0; el.max = last; el.step = 1; });
  from.setAttribute('aria-label', 'From quarter');
  to.setAttribute('aria-label', 'To quarter');
  from.addEventListener('input', () => { state.qFrom = Math.min(Number(from.value), state.qTo); syncSlider(); queueRender(); });
  to.addEventListener('input', () => { state.qTo = Math.max(Number(to.value), state.qFrom); syncSlider(); queueRender(); });
  document.getElementById('q-min').textContent = D.lists.quarter[0];
  document.getElementById('q-max').textContent = D.lists.quarter[last];
}

function drawCompanyChips() {
  const box = document.getElementById('company-chips');
  box.innerHTML = '';
  state.companies.forEach(ci => {
    const name = D.lists.company[ci];
    const b = chip(name, true, 'chip-removable');
    b.setAttribute('aria-label', `Remove ${name}`);
    b.addEventListener('click', () => { state.companies = state.companies.filter(x => x !== ci); drawCompanyChips(); queueRender(); });
    box.appendChild(b);
  });
  document.getElementById('f-company-search').placeholder =
    state.companies.length ? 'Add another company…' : 'All companies — type to search…';
}

function setupCompanySearch() {
  const input = document.getElementById('f-company-search');
  const list = document.getElementById('company-suggest');
  const names = D.lists.company.map((name, i) => [i, name]).sort((a, b) => a[1].localeCompare(b[1]));
  let matches = [], cursor = -1;
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); cursor = -1; };
  function pick(ci) {
    if (!state.companies.includes(ci)) state.companies = [...state.companies, ci];
    input.value = ''; close(); drawCompanyChips(); queueRender(); input.focus();
  }
  function show() {
    const q = input.value.trim().toLowerCase();
    if (!q) { close(); return; }
    const pool = names.filter(([i]) => !state.companies.includes(i));
    const starts = pool.filter(([, n]) => n.toLowerCase().startsWith(q));
    const contains = pool.filter(([, n]) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q));
    matches = [...starts, ...contains].slice(0, 8);
    cursor = matches.length ? 0 : -1;
    list.innerHTML = matches.length
      ? matches.map(([i, n], k) => `<li role="option" id="cs-${i}" data-ci="${i}" aria-selected="${k === cursor}">${n.replace(/</g, '&lt;')}</li>`).join('')
      : '<li class="empty">No matching company</li>';
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  function move(d) {
    if (!matches.length) return;
    cursor = (cursor + d + matches.length) % matches.length;
    [...list.children].forEach((li, k) => li.setAttribute('aria-selected', k === cursor ? 'true' : 'false'));
    input.setAttribute('aria-activedescendant', `cs-${matches[cursor][0]}`);
  }
  input.addEventListener('input', show);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) show(); else move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { if (cursor >= 0 && matches[cursor]) { e.preventDefault(); pick(matches[cursor][0]); } }
    else if (e.key === 'Escape') close();
    else if (e.key === 'Backspace' && !input.value && state.companies.length) {
      state.companies = state.companies.slice(0, -1); drawCompanyChips(); queueRender();
    }
  });
  // mousedown (not click) so the pick lands before the input's blur closes the list
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-ci]');
    if (li) { e.preventDefault(); pick(Number(li.dataset.ci)); }
  });
  input.addEventListener('blur', () => setTimeout(close, 100));
}

const FAMILY_ORDER = ['Vanguard', 'BlackRock', 'State Street', 'Fidelity', 'Capital Group', 'Parnassus', 'Calvert', 'Domini', 'Impax', 'Green Century'];
let TOPICS = [];
function drawAllFilters() {
  drawChipGroup('family-chips', FAMILY_ORDER, 'families');
  drawChipGroup('label-chips', ['Conventional', 'ESG'], 'labels', l => (l === 'ESG' ? 'ESG-labeled' : 'Conventional'));
  drawChipGroup('style-chips', ['Index', 'Active'], 'styles');
  drawChipGroup('type-chips', Object.keys(STANCE_LABEL), 'types', t => STANCE_LABEL[t]);
  drawChipGroup('topic-chips', TOPICS, 'topics', TOPIC_LABEL);
  syncSlider();
  drawCompanyChips();
}

function setSwitch(id, attr, value) {
  document.querySelectorAll(`#${id} button`).forEach(b => b.classList.toggle('active', b.dataset[attr] === value));
}

function setupControls() {
  setupSlider();
  setupCompanySearch();
  document.querySelectorAll('#measure-switch button').forEach(btn => btn.addEventListener('click', () => {
    state.measure = btn.dataset.measure; setSwitch('measure-switch', 'measure', state.measure); render();
  }));
  document.querySelectorAll('#breakdown-switch button').forEach(btn => btn.addEventListener('click', () => {
    state.breakdown = btn.dataset.breakdown; setSwitch('breakdown-switch', 'breakdown', state.breakdown); render();
  }));
  document.getElementById('btn-reset').addEventListener('click', () => {
    Object.assign(state, { families: [], labels: [], styles: [], types: [], topics: [], companies: [],
      qFrom: 0, qTo: D.lists.quarter.length - 1, measure: 'for', breakdown: 'group' });
    setSwitch('measure-switch', 'measure', 'for');
    setSwitch('breakdown-switch', 'breakdown', 'group');
    document.getElementById('f-company-search').value = '';
    drawAllFilters();
    render();
  });
  document.getElementById('btn-share').addEventListener('click', () => {
    const btn = document.getElementById('btn-share'), original = btn.textContent;
    navigator.clipboard.writeText(location.href).then(() => {
      btn.textContent = 'Link copied!'; setTimeout(() => { btn.textContent = original; }, 1500);
    }).catch(() => {
      btn.textContent = 'Could not copy — copy the URL bar'; setTimeout(() => { btn.textContent = original; }, 2000);
    });
  });
  document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
  document.querySelectorAll('[data-download]').forEach(btn => btn.addEventListener('click', () => {
    const chart = charts[btn.dataset.download];
    if (!chart) return;
    const a = document.createElement('a');
    a.href = chart.toBase64Image();
    a.download = `${btn.dataset.download}.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }));
}

// Shareable links: multi-select filters repeat their parameter.
function applyStateFromURL() {
  const p = new URLSearchParams(location.search), L = D.lists;
  const keep = (vals, ok) => vals.filter(ok);
  state.families = keep(p.getAll('family'), v => FAMILY_ORDER.includes(v));
  state.labels = keep(p.getAll('label'), v => ['Conventional', 'ESG'].includes(v));
  state.styles = keep(p.getAll('style'), v => ['Index', 'Active'].includes(v));
  state.types = keep(p.getAll('type'), v => v in STANCE_LABEL);
  state.topics = keep(p.getAll('topic'), v => TOPICS.includes(v));
  state.companies = p.getAll('company').map(n => L.company.indexOf(n)).filter(i => i >= 0);
  const qi = v => L.quarter.indexOf(v);
  state.qFrom = p.has('from') && qi(p.get('from')) >= 0 ? qi(p.get('from')) : 0;
  state.qTo = p.has('to') && qi(p.get('to')) >= 0 ? qi(p.get('to')) : L.quarter.length - 1;
  if (state.qFrom > state.qTo) [state.qFrom, state.qTo] = [state.qTo, state.qFrom];
  if (p.get('measure') in MEASURES) state.measure = p.get('measure');
  if (['group', 'family', 'fund', 'label'].includes(p.get('breakdown'))) state.breakdown = p.get('breakdown');
  setSwitch('measure-switch', 'measure', state.measure);
  setSwitch('breakdown-switch', 'breakdown', state.breakdown);
}

function syncURL() {
  const p = new URLSearchParams(), L = D.lists;
  state.families.forEach(v => p.append('family', v));
  state.labels.forEach(v => p.append('label', v));
  state.styles.forEach(v => p.append('style', v));
  state.types.forEach(v => p.append('type', v));
  state.topics.forEach(v => p.append('topic', v));
  state.companies.forEach(i => p.append('company', L.company[i]));
  if (state.qFrom !== 0) p.set('from', L.quarter[state.qFrom]);
  if (state.qTo !== L.quarter.length - 1) p.set('to', L.quarter[state.qTo]);
  if (state.measure !== 'for') p.set('measure', state.measure);
  if (state.breakdown !== 'group') p.set('breakdown', state.breakdown);
  const qs = p.toString();
  history.replaceState(null, '', qs ? '?' + qs : location.pathname);
}

// ---------------------------------------------------------------------------
// Charts: built the first time each card scrolls into view (with an intro),
// then rebuilt instantly on every filter change.
// ---------------------------------------------------------------------------
const cardOpened = {}, pendingConfig = {};
function destroyChart(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }
function addIntro(id, cfg) {
  const o = cfg.options = cfg.options || {};
  o.plugins = o.plugins || {};
  if (id === 'chart-trend') {
    const n = cfg.data.datasets.length;
    o.animation = { duration: 0 };
    o.plugins.esgIntro = n > 1 ? { mode: 'sequence', gap: Math.max(220, 1800 / n) } : { mode: 'sweep' };
  } else {
    const bars = cfg.data.labels.length;
    o.animation = staggered(bars > 12 ? 50 : 110, 800);
    o.plugins.esgIntro = { mode: 'fade', after: 800 + (bars > 12 ? 50 : 110) * bars };
  }
}
function mountChart(id, config) {
  destroyChart(id);
  const canvas = document.getElementById(id);
  const isOpen = cardOpened[id];
  if (isOpen && isOpen()) { charts[id] = new Chart(canvas, config); return; }
  pendingConfig[id] = config;
  if (isOpen) return;
  cardOpened[id] = whenCardOpens(canvas.closest('.chart-card'), () => {
    const cfg = pendingConfig[id];
    delete pendingConfig[id];
    if (REDUCED_MOTION) { cfg.options = cfg.options || {}; cfg.options.animation = false; } else addIntro(id, cfg);
    charts[id] = new Chart(canvas, cfg);
  });
}

function render() {
  syncURL();
  const C = window.ESG_COLORS, L = D.lists, c = D.cols;
  const idx = filteredIndex();
  const m = state.measure, M = MEASURES[m];

  // --- Summary tiles ---
  const all = tally();
  const companies = new Set();
  idx.forEach(i => { add(all, i); companies.add(c.c[i]); });
  document.getElementById('stat-votes').textContent = all.n.toLocaleString();
  document.getElementById('stat-companies').textContent = companies.size.toLocaleString();
  document.getElementById('stat-for').textContent = fmtMeasure(measureOf(all, 'for'), 'for');
  document.getElementById('stat-against').textContent = fmtMeasure(measureOf(all, 'against'), 'against');

  const valueAxis = { beginAtZero: true, grid: { color: C.grid }, ticks: { color: C.muted, callback: v => (M.pct ? v + '%' : Number(v).toLocaleString()) } };
  if (M.pct) { valueAxis.min = 0; valueAxis.max = 100; }
  const tip = ctx => `${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${fmtMeasure(ctx.parsed[ctx.chart.options.indexAxis === 'y' ? 'x' : 'y'])}`;
  const colorFor = (key, i) => {
    if (state.breakdown === 'group') return C.series[GROUPS.indexOf(key)] || C.series[i % 8];
    if (state.breakdown === 'label') return key.startsWith('ESG') ? C.series[2] : C.series[0];
    return C.series[i % 8];
  };

  // --- Groups for the chosen breakdown (ordered by votes in view) ---
  const groups = new Map();
  idx.forEach(i => { const k = breakdownKey(i); if (!groups.has(k)) groups.set(k, { total: tally(), byQ: new Map() }); const g = groups.get(k); add(g.total, i); if (!g.byQ.has(c.q[i])) g.byQ.set(c.q[i], tally()); add(g.byQ.get(c.q[i]), i); });
  let groupKeys = [...groups.keys()];
  if (state.breakdown === 'group') groupKeys.sort((a, b) => GROUPS.indexOf(a) - GROUPS.indexOf(b));
  else if (state.breakdown === 'family') groupKeys.sort((a, b) => FAMILY_ORDER.indexOf(a) - FAMILY_ORDER.indexOf(b));
  else groupKeys.sort((a, b) => groups.get(b).total.n - groups.get(a).total.n);

  // --- Chart 1: by meeting quarter (up to 8 lines) ---
  {
    const qs = []; for (let q = state.qFrom; q <= state.qTo; q++) qs.push(q);
    const keys = groupKeys.slice(0, 8);
    mountChart('chart-trend', {
      type: 'line',
      data: {
        labels: qs.map(q => L.quarter[q]),
        datasets: keys.map((k, i) => ({
          label: k,
          data: qs.map(q => { const t = groups.get(k).byQ.get(q); return t ? round1(measureOf(t)) : null; }),
          borderColor: colorFor(k, i), backgroundColor: colorFor(k, i) + '1a',
          borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 6, tension: 0.2, spanGaps: true,
          pointBackgroundColor: colorFor(k, i), pointBorderColor: C.surface, pointBorderWidth: 2,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { display: keys.length > 1, position: 'bottom' },
          tooltip: { callbacks: { label: tip } },
        },
        scales: { x: { grid: { display: false }, ticks: { color: C.muted } }, y: { ...valueAxis, title: { display: true, text: M.label, color: C.textSecondary, font: { size: 12 } } } },
      },
    });
  }

  // --- Chart 2: all quarters in view, by breakdown ---
  {
    const horizontal = groupKeys.length > 4;
    document.getElementById('groups-holder').style.height = horizontal ? `${Math.max(280, 34 * groupKeys.length + 70)}px` : '300px';
    document.getElementById('groups-title').textContent = `All quarters in view, ${state.breakdown === 'label' ? 'ESG-labeled vs. conventional' : 'by ' + state.breakdown}`;
    const vals = groupKeys.map(k => round1(measureOf(groups.get(k).total)));
    mountChart('chart-groups', {
      type: 'bar',
      data: { labels: groupKeys, datasets: [{ data: vals, backgroundColor: groupKeys.map(colorFor), borderRadius: 4, maxBarThickness: horizontal ? 20 : 64 }] },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        responsive: true, maintainAspectRatio: false,
        layout: { padding: horizontal ? { right: 50 } : { top: 26 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: tip } },
          esgAnnotate: { valueLabels: M.pct ? { suffix: '%', decimals: 1 } : { decimals: 0 } },
        },
        scales: horizontal
          ? { x: valueAxis, y: { grid: { display: false, drawTicks: false }, ticks: { color: C.textSecondary, autoSkip: false } } }
          : { x: { grid: { display: false }, ticks: { color: C.textSecondary } }, y: valueAxis },
      },
    });
  }

  // --- Chart 3: by topic ---
  {
    const byTopic = new Map();
    idx.forEach(i => { const k = c.cat[i]; if (!byTopic.has(k)) byTopic.set(k, tally()); add(byTopic.get(k), i); });
    // Topics with only a handful of votes swing to 0% or 100%; leave them out.
    const MIN_VOTES = 20;
    const rows = [...byTopic].map(([k, t]) => ({ label: TOPIC_LABEL(L.category[k]), v: round1(measureOf(t)), n: t.n }))
      .filter(r => r.v != null && r.n >= MIN_VOTES).sort((a, b) => b.v - a.v);
    mountChart('chart-topics', {
      type: 'bar',
      data: { labels: rows.map(r => r.label), datasets: [{ data: rows.map(r => r.v), backgroundColor: C.series[6], borderRadius: 4, maxBarThickness: 20 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: 50 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${fmtMeasure(ctx.parsed.x)} (${rows[ctx.dataIndex].n.toLocaleString()} votes)` } },
          esgAnnotate: { valueLabels: M.pct ? { suffix: '%', decimals: 1 } : { decimals: 0 } },
        },
        scales: { x: valueAxis, y: { grid: { display: false, drawTicks: false }, ticks: { color: C.textSecondary, autoSkip: false } } },
      },
    });
  }

  // --- Chart 4: companies with the most votes against management ---
  {
    const against = new Map();
    idx.forEach(i => { if (c.wm[i] === 0) against.set(c.c[i], (against.get(c.c[i]) || 0) + 1); });
    const top = [...against].sort((a, b) => b[1] - a[1]).slice(0, 12);
    const trunc = s => (s.length > 28 ? s.slice(0, 27) + '…' : s);
    mountChart('chart-companies', {
      type: 'bar',
      data: { labels: top.map(([ci]) => trunc(L.company[ci])), datasets: [{ data: top.map(([, n]) => n), backgroundColor: C.series[7], borderRadius: 4, maxBarThickness: 20 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: 44 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: items => L.company[top[items[0].dataIndex][0]], label: ctx => `${ctx.parsed.x.toLocaleString()} votes against management` } },
          esgAnnotate: { valueLabels: { decimals: 0 } },
        },
        scales: {
          x: { beginAtZero: true, grid: { color: C.grid }, ticks: { color: C.muted }, title: { display: true, text: 'Fund votes against management', color: C.textSecondary, font: { size: 12 } } },
          y: { grid: { display: false, drawTicks: false }, ticks: { color: C.textSecondary, autoSkip: false } },
        },
      },
    });
  }

  // --- Table ---
  const CAP = 500;
  // Most recent meetings first (dates are stored in first-seen order, so compare the strings).
  const shown = idx.slice()
    .sort((a, b) => L.date[c.d[b]].localeCompare(L.date[c.d[a]]) || L.company[c.c[a]].localeCompare(L.company[c.c[b]]))
    .slice(0, CAP);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  document.getElementById('table-body').innerHTML = shown.map(i => {
    const f = D.funds[c.f[i]];
    const wm = c.wm[i];
    return `<tr>
      <td>${L.date[c.d[i]]}</td><td>${esc(L.company[c.c[i]])}</td><td>${esc(f.name)}</td>
      <td class="proposal-cell">${esc(L.proposal[c.p[i]])}</td><td>${STANCE_LABEL[L.stance[c.st[i]]].replace('Shareholder: ', 'SH: ').replace(' proposals', '')}</td>
      <td class="${wm === 0 ? 'vote-against' : ''}">${L.vote[c.v[i]]}</td><td>${L.vsMgmt[c.mr[i]]}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="loading-note">No votes match these filters.</td></tr>';
  document.getElementById('result-count').textContent = idx.length > CAP
    ? `Showing the ${CAP.toLocaleString()} most recent of ${idx.length.toLocaleString()} matching votes. Narrow the filters to see others.`
    : `${idx.length.toLocaleString()} matching vote${idx.length === 1 ? '' : 's'}.`;
}

function TOPIC_LABEL(t) {
  const map = {
    'SECTION 14A SAY-ON-PAY VOTES': 'Say-on-pay (Section 14A)',
    'HUMAN RIGHTS OR HUMAN CAPITAL/WORKFORCE': 'Human rights / workforce',
    'DIVERSITY, EQUITY, AND INCLUSION': 'Diversity, equity & inclusion',
    'ENVIRONMENT OR CLIMATE': 'Environment or climate',
    'SHAREHOLDER RIGHTS AND DEFENSES': 'Shareholder rights & defenses',
  };
  return map[t] || t.charAt(0) + t.slice(1).toLowerCase();
}

function exportCSV() {
  const L = D.lists, c = D.cols;
  const cols = ['meeting_date', 'quarter', 'company', 'fund', 'family', 'group', 'label', 'style', 'proposal', 'type', 'topic', 'vote', 'with_management'];
  const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [cols.join(',')];
  filteredIndex().forEach(i => {
    const f = D.funds[c.f[i]];
    lines.push([L.date[c.d[i]], L.quarter[c.q[i]], L.company[c.c[i]], f.name, f.family, f.group, f.label, f.style,
      L.proposal[c.p[i]], L.stance[c.st[i]], L.category[c.cat[i]], L.vote[c.v[i]], c.wm[i] === 1 ? 'Y' : c.wm[i] === 0 ? 'N' : ''].map(cell).join(','));
  });
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'proxy-votes-filtered.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

fetch('data/site_votes.json').then(r => r.json()).then(data => {
  D = data;
  IS_CAST = D.lists.vote.map(v => ['FOR', 'AGAINST', 'ABSTAIN', 'WITHHOLD'].includes(v));
  IS_FOR = D.lists.vote.map(v => v === 'FOR');
  TOPICS = [...D.lists.category].sort((a, b) => TOPIC_LABEL(a).localeCompare(TOPIC_LABEL(b)));
  state.qTo = D.lists.quarter.length - 1;
  setupControls();
  applyStateFromURL();
  drawAllFilters();
  render();
}).catch(err => {
  document.getElementById('table-body').innerHTML =
    `<tr><td colspan="7" class="loading-note">Could not load the data (${err.message}). Try reloading.</td></tr>`;
});
