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
const GROUPS = ['Big Three', 'Other large managers', 'ESG families'];
const MEASURES = {
  for: { label: '% voted FOR', pct: true },
  with: { label: '% with management', pct: true },
  against: { label: '% against management', pct: true },
  count: { label: 'Votes', pct: false },
};
const FAMILY_ORDER = ['Vanguard', 'BlackRock', 'State Street', 'Fidelity', 'Capital Group', 'Parnassus', 'Calvert', 'Domini', 'Impax', 'Green Century'];
// One fixed color per family (index into the theme's 10 series colors), so a
// fund or family keeps its color in every chart and breakdown.
const FAMILY_COLOR = { 'Vanguard': 0, 'BlackRock': 1, 'Parnassus': 2, 'State Street': 3, 'Fidelity': 4, 'Calvert': 5, 'Capital Group': 6, 'Domini': 7, 'Impax': 8, 'Green Century': 9 };
const DASHES = [[], [7, 4], [2, 3], [8, 3, 2, 3]]; // told apart within a family
const MIN_POINT_N = 30;  // trend points built on fewer votes are hidden
const MAX_LINES = 12;    // most lines drawn in the trend chart

// Starting points: each sets a full filter state and is a shareable link.
const PRESETS = [
  { label: 'Pro-ESG support, by manager group', state: { types: ['pro-ESG'], measure: 'for', breakdown: 'group' } },
  { label: 'Pro-ESG support, fund by fund', state: { types: ['pro-ESG'], measure: 'for', breakdown: 'fund' } },
  { label: 'Do ESG-labeled funds vote differently?', state: { types: ['pro-ESG'], measure: 'for', breakdown: 'label' } },
  { label: 'Anti-ESG proposals', state: { types: ['anti-ESG'], measure: 'for', breakdown: 'group' } },
  { label: 'Governance proposals', state: { types: ['governance'], measure: 'for', breakdown: 'group' } },
  { label: 'Say-on-pay pushback', state: { types: ['management'], topics: ['SECTION 14A SAY-ON-PAY VOTES'], measure: 'against', breakdown: 'fund' } },
  { label: 'Director opposition', state: { types: ['management'], topics: ['DIRECTOR ELECTIONS'], measure: 'against', breakdown: 'fund' } },
];

let LAST_Q = 0;
const defaults = () => ({
  families: [], labels: [], styles: [], types: ['pro-ESG'], topics: [], companies: [], text: '',
  qFrom: 0, qTo: LAST_Q, measure: 'for', breakdown: 'group', time: 'season',
});
let state = defaults();
let sort = { col: 'date', dir: 'desc' };

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
// Votes behind a measure: what a point's reliability rests on.
const basisOf = (t, m = state.measure) => (m === 'count' ? t.n : m === 'for' ? t.cast : t.rec);
const round1 = x => (x == null ? null : Math.round(x * 10) / 10);
const fmtMeasure = (x, m = state.measure) => (x == null ? '–' : MEASURES[m].pct ? `${round1(x).toFixed(1)}%` : Math.round(x).toLocaleString());

// ---------------------------------------------------------------------------
// Filtering.
// ---------------------------------------------------------------------------
let textMatchQuery = null, textMatchSet = null; // proposal ids whose wording contains the query
function textMatches() {
  const q = state.text.trim().toLowerCase();
  if (!q) return null;
  if (q !== textMatchQuery) {
    textMatchQuery = q;
    textMatchSet = new Set();
    const words = q.split(/\s+/);
    D.lists.proposal.forEach((p, i) => { const t = p.toLowerCase(); if (words.every(w => t.includes(w))) textMatchSet.add(i); });
  }
  return textMatchSet;
}

function filteredIndex() {
  const c = D.cols, F = D.funds, L = D.lists;
  const fam = new Set(state.families), lab = new Set(state.labels), sty = new Set(state.styles);
  const typ = new Set(state.types.map(t => L.stance.indexOf(t)));
  const top = new Set(state.topics.map(t => L.category.indexOf(t)));
  const com = new Set(state.companies);
  const txt = textMatches();
  const fundOk = F.map(f => (!fam.size || fam.has(f.family)) && (!lab.size || lab.has(f.label)) && (!sty.size || sty.has(f.style)));
  const out = [];
  for (let i = 0; i < D.n; i++) {
    if (!fundOk[c.f[i]]) continue;
    if (c.q[i] < state.qFrom || c.q[i] > state.qTo) continue;
    if (typ.size && !typ.has(c.st[i])) continue;
    if (top.size && !top.has(c.cat[i])) continue;
    if (com.size && !com.has(c.c[i])) continue;
    if (txt && !txt.has(c.p[i])) continue;
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
// Time: proxy season (July-June, as in the report) or calendar meeting quarter.
// ---------------------------------------------------------------------------
let SEASON_OF_Q = [], SEASONS = []; // quarter index -> season index; season labels
function buildSeasons() {
  SEASONS = []; SEASON_OF_Q = [];
  D.lists.quarter.forEach((q) => {
    const y = Number(q.slice(0, 4)), n = Number(q.slice(-1));
    const start = n >= 3 ? y : y - 1;
    const label = `${start}–${String((start + 1) % 100).padStart(2, '0')}`;
    let i = SEASONS.indexOf(label);
    if (i < 0) { SEASONS.push(label); i = SEASONS.length - 1; }
    SEASON_OF_Q.push(i);
  });
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

const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
function presetMatches(p) {
  const s = { ...defaults(), ...p.state };
  return ['families', 'labels', 'styles', 'types', 'topics', 'companies'].every(k => sameSet(state[k], s[k]))
    && state.measure === s.measure && state.breakdown === s.breakdown && state.text.trim() === ''
    && state.qFrom === 0 && state.qTo === LAST_Q;
}
function drawPresets() {
  const box = document.getElementById('preset-chips');
  box.innerHTML = '';
  PRESETS.forEach((p) => {
    const b = chip(p.label, presetMatches(p));
    b.addEventListener('click', () => {
      state = { ...defaults(), ...p.state, time: state.time };
      document.getElementById('f-text').value = '';
      drawAllFilters();
      render();
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
      ? matches.map(([i, n], k) => `<li role="option" id="cs-${i}" data-ci="${i}" aria-selected="${k === cursor}">${n.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</li>`).join('')
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

let TOPICS = [];
function drawAllFilters() {
  drawPresets();
  drawChipGroup('family-chips', FAMILY_ORDER, 'families');
  drawChipGroup('label-chips', ['Conventional', 'ESG'], 'labels', l => (l === 'ESG' ? 'ESG-labeled' : 'Conventional'));
  drawChipGroup('style-chips', ['Index', 'Active'], 'styles');
  drawChipGroup('type-chips', Object.keys(STANCE_LABEL), 'types', t => STANCE_LABEL[t]);
  drawChipGroup('topic-chips', TOPICS, 'topics', TOPIC_LABEL);
  syncSlider();
  drawCompanyChips();
  setSwitch('measure-switch', 'measure', state.measure);
  setSwitch('breakdown-switch', 'breakdown', state.breakdown);
  setSwitch('time-switch', 'time', state.time);
  document.getElementById('f-text').value = state.text;
}

function setSwitch(id, attr, value) {
  document.querySelectorAll(`#${id} button`).forEach(b => b.classList.toggle('active', b.dataset[attr] === value));
}

function setupControls() {
  setupSlider();
  setupCompanySearch();
  const wire = (id, attr, key) => document.querySelectorAll(`#${id} button`).forEach(btn => btn.addEventListener('click', () => {
    state[key] = btn.dataset[attr]; setSwitch(id, attr, state[key]); render();
  }));
  wire('measure-switch', 'measure', 'measure');
  wire('breakdown-switch', 'breakdown', 'breakdown');
  wire('time-switch', 'time', 'time');
  const text = document.getElementById('f-text');
  text.addEventListener('input', () => { state.text = text.value; queueRender(); });
  document.getElementById('btn-reset').addEventListener('click', () => {
    state = defaults();
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
  // Sortable table headers.
  document.querySelectorAll('#data-table th.sortable').forEach(th => {
    const go = () => {
      const col = th.dataset.sort;
      sort = sort.col === col ? { col, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: col === 'date' ? 'desc' : 'asc' };
      render();
    };
    th.addEventListener('click', go);
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

// Shareable links: multi-select filters repeat their parameter. Only values
// that differ from the defaults are written, and "all proposal types" (which
// is not the default) is written as type=all.
function applyStateFromURL() {
  const p = new URLSearchParams(location.search), L = D.lists;
  const d = defaults();
  const keep = (vals, ok) => vals.filter(ok);
  state = d;
  state.families = keep(p.getAll('family'), v => FAMILY_ORDER.includes(v));
  state.labels = keep(p.getAll('label'), v => ['Conventional', 'ESG'].includes(v));
  state.styles = keep(p.getAll('style'), v => ['Index', 'Active'].includes(v));
  if (p.has('type')) state.types = p.get('type') === 'all' ? [] : keep(p.getAll('type'), v => v in STANCE_LABEL);
  state.topics = keep(p.getAll('topic'), v => TOPICS.includes(v));
  state.companies = p.getAll('company').map(n => L.company.indexOf(n)).filter(i => i >= 0);
  const qi = v => L.quarter.indexOf(v);
  state.qFrom = p.has('from') && qi(p.get('from')) >= 0 ? qi(p.get('from')) : 0;
  state.qTo = p.has('to') && qi(p.get('to')) >= 0 ? qi(p.get('to')) : L.quarter.length - 1;
  if (state.qFrom > state.qTo) [state.qFrom, state.qTo] = [state.qTo, state.qFrom];
  if (p.get('measure') in MEASURES) state.measure = p.get('measure');
  if (['group', 'family', 'fund', 'label'].includes(p.get('breakdown'))) state.breakdown = p.get('breakdown');
  if (['season', 'quarter'].includes(p.get('time'))) state.time = p.get('time');
  state.text = p.get('q') || '';
}

function syncURL() {
  const p = new URLSearchParams(), L = D.lists, d = defaults();
  state.families.forEach(v => p.append('family', v));
  state.labels.forEach(v => p.append('label', v));
  state.styles.forEach(v => p.append('style', v));
  if (!sameSet(state.types, d.types)) { if (state.types.length) state.types.forEach(v => p.append('type', v)); else p.set('type', 'all'); }
  state.topics.forEach(v => p.append('topic', v));
  state.companies.forEach(i => p.append('company', L.company[i]));
  if (state.qFrom !== 0) p.set('from', L.quarter[state.qFrom]);
  if (state.qTo !== L.quarter.length - 1) p.set('to', L.quarter[state.qTo]);
  if (state.measure !== d.measure) p.set('measure', state.measure);
  if (state.breakdown !== d.breakdown) p.set('breakdown', state.breakdown);
  if (state.time !== d.time) p.set('time', state.time);
  if (state.text.trim()) p.set('q', state.text.trim());
  const qs = p.toString();
  history.replaceState(null, '', qs ? '?' + qs : location.pathname);
}

// ---------------------------------------------------------------------------
// Charts: built the first time each card scrolls into view (with an intro),
// then rebuilt instantly on every filter change (a full re-render is ~70 ms).
// ---------------------------------------------------------------------------
const cardOpened = {}, pendingConfig = {};
let redrawingForTheme = false; // true while charts are redrawn after a theme switch: no intro/animation
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
  if (isOpen && isOpen()) {
    if (redrawingForTheme) { config.options = config.options || {}; config.options.animation = false; }
    charts[id] = new Chart(canvas, config);
    return;
  }
  pendingConfig[id] = config;
  if (isOpen) return;
  cardOpened[id] = whenCardOpens(canvas.closest('.chart-card'), () => {
    const cfg = pendingConfig[id];
    delete pendingConfig[id];
    if (REDUCED_MOTION) { cfg.options = cfg.options || {}; cfg.options.animation = false; } else addIntro(id, cfg);
    charts[id] = new Chart(canvas, cfg);
  });
}

// Charts hold theme colors in their configs, so a theme switch rebuilds them all.
ESG_ON_THEME_CHANGE(() => {
  if (!D) return;
  Object.keys(charts).forEach(destroyChart);
  redrawingForTheme = true;
  try { render(); } finally { redrawingForTheme = false; }
});

// ---------------------------------------------------------------------------
// Table sorting: dictionaries are ranked once so sorting 300k rows compares integers.
// ---------------------------------------------------------------------------
let RANK = null;
function buildRanks() {
  const rankOf = (arr, cmp) => { const order = arr.map((_, i) => i).sort((a, b) => cmp(arr[a], arr[b])); const r = new Array(arr.length); order.forEach((idx, k) => { r[idx] = k; }); return r; };
  const L = D.lists;
  RANK = {
    date: rankOf(L.date, (a, b) => a.localeCompare(b)),
    company: rankOf(L.company, (a, b) => a.localeCompare(b)),
    fund: rankOf(D.funds.map(f => f.name), (a, b) => a.localeCompare(b)),
    type: rankOf(L.stance, (a, b) => STANCE_LABEL[a].localeCompare(STANCE_LABEL[b])),
    vote: rankOf(L.vote, (a, b) => a.localeCompare(b)),
  };
}
function sortKey(col, i) {
  const c = D.cols;
  if (col === 'date') return RANK.date[c.d[i]];
  if (col === 'company') return RANK.company[c.c[i]];
  if (col === 'fund') return RANK.fund[c.f[i]];
  if (col === 'type') return RANK.type[c.st[i]];
  return RANK.vote[c.v[i]];
}

function render() {
  syncURL();
  const C = window.ESG_COLORS, L = D.lists, c = D.cols;
  const idx = filteredIndex();
  const m = state.measure, M = MEASURES[m];
  drawPresets();

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

  // Colors: a fixed hue per group, per label, and per family (a fund uses its
  // family's hue). Funds in one family are told apart by line dash / bar order.
  const fundByName = new Map(D.funds.map(f => [f.name, f]));
  const colorFor = (key, i) => {
    if (state.breakdown === 'group') return C.series[GROUPS.indexOf(key)] ?? C.series[i % 8];
    if (state.breakdown === 'label') return key.startsWith('ESG') ? C.series[2] : C.series[0];
    if (state.breakdown === 'family') return C.series[FAMILY_COLOR[key] ?? (i % 10)];
    const f = fundByName.get(key);
    return C.series[f ? FAMILY_COLOR[f.family] : (i % 10)];
  };

  // --- Groups for the chosen breakdown (ordered by votes in view) ---
  const slotOfQ = q => (state.time === 'season' ? SEASON_OF_Q[q] : q);
  const groups = new Map();
  idx.forEach(i => {
    const k = breakdownKey(i);
    if (!groups.has(k)) groups.set(k, { total: tally(), bySlot: new Map() });
    const g = groups.get(k);
    add(g.total, i);
    const s = slotOfQ(c.q[i]);
    if (!g.bySlot.has(s)) g.bySlot.set(s, tally());
    add(g.bySlot.get(s), i);
  });
  let groupKeys = [...groups.keys()];
  if (state.breakdown === 'group') groupKeys.sort((a, b) => GROUPS.indexOf(a) - GROUPS.indexOf(b));
  else if (state.breakdown === 'family') groupKeys.sort((a, b) => FAMILY_ORDER.indexOf(a) - FAMILY_ORDER.indexOf(b));
  else groupKeys.sort((a, b) => groups.get(b).total.n - groups.get(a).total.n);

  // --- Chart 1: trend, by proxy season or meeting quarter ---
  {
    const slots = [];
    for (let q = state.qFrom; q <= state.qTo; q++) { const s = slotOfQ(q); if (!slots.includes(s)) slots.push(s); }
    const slotLabel = s => (state.time === 'season' ? SEASONS[s] : L.quarter[s]);
    document.getElementById('trend-title').textContent = state.time === 'season' ? 'By proxy season' : 'By meeting quarter';
    // Lines: the ones with the most votes in view, at most MAX_LINES.
    const byVotes = groupKeys.slice().sort((a, b) => groups.get(b).total.n - groups.get(a).total.n);
    const keys = groupKeys.filter(k => byVotes.indexOf(k) < MAX_LINES);
    let hidden = 0;
    const famSeen = {};
    const datasets = keys.map((k, i) => {
      const g = groups.get(k);
      const color = colorFor(k, i);
      const f = state.breakdown === 'fund' ? fundByName.get(k) : null;
      const dashIdx = f ? (famSeen[f.family] = (famSeen[f.family] ?? -1) + 1) : 0;
      const counts = [];
      const data = slots.map(s => {
        const t = g.bySlot.get(s);
        if (!t) { counts.push(0); return null; }
        counts.push(basisOf(t));
        if (m !== 'count' && basisOf(t) < MIN_POINT_N) { hidden++; return null; }
        return round1(measureOf(t));
      });
      return {
        label: k, data, counts,
        borderColor: color, backgroundColor: color + '1a',
        borderDash: DASHES[dashIdx % DASHES.length],
        borderWidth: 2.5, pointRadius: 3.5, pointHoverRadius: 6, tension: 0.2, spanGaps: false,
        pointBackgroundColor: color, pointBorderColor: C.surface, pointBorderWidth: 2,
      };
    });
    const notes = [];
    if (groupKeys.length > MAX_LINES) notes.push(`Showing the ${MAX_LINES} of ${groupKeys.length} with the most votes in view; filter to one family or group to see the rest.`);
    if (hidden) notes.push(`Points built on fewer than ${MIN_POINT_N} votes are hidden.`);
    document.getElementById('trend-note').textContent = notes.join(' ');
    mountChart('chart-trend', {
      type: 'line',
      data: { labels: slots.map(slotLabel), datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { display: keys.length > 1, position: 'bottom' },
          tooltip: { callbacks: { label: ctx => `${tip(ctx)} (${ctx.dataset.counts[ctx.dataIndex].toLocaleString()} votes)` } },
        },
        scales: { x: { grid: { display: false }, ticks: { color: C.muted } }, y: { ...valueAxis, title: { display: true, text: M.label, color: C.textSecondary, font: { size: 12 } } } },
      },
    });
  }

  // --- Chart 2: everything in view, by breakdown ---
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
          tooltip: { callbacks: { label: ctx => `${fmtMeasure(ctx.parsed[horizontal ? 'x' : 'y'])} (${basisOf(groups.get(groupKeys[ctx.dataIndex]).total).toLocaleString()} votes)` } },
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

  // --- Table (sorted over every matching vote, then capped) ---
  const CAP = 500;
  const dir = sort.dir === 'asc' ? 1 : -1;
  const shown = idx.slice().sort((a, b) =>
    dir * (sortKey(sort.col, a) - sortKey(sort.col, b))
    || (RANK.date[c.d[b]] - RANK.date[c.d[a]])
    || (RANK.company[c.c[a]] - RANK.company[c.c[b]])).slice(0, CAP);
  document.querySelectorAll('#data-table th.sortable').forEach(th => {
    if (th.dataset.sort === sort.col) th.setAttribute('aria-sort', sort.dir === 'asc' ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  });
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  document.getElementById('table-body').innerHTML = shown.map(i => {
    const f = D.funds[c.f[i]];
    const wm = c.wm[i];
    const st = L.stance[c.st[i]];
    const rule = L.rule[D.proposalRule[c.p[i]]];
    const typeText = STANCE_LABEL[st].replace('Shareholder: ', 'SH: ').replace(' proposals', '');
    return `<tr>
      <td>${L.date[c.d[i]]}</td><td>${esc(L.company[c.c[i]])}</td><td>${esc(f.name)}</td>
      <td class="proposal-cell">${esc(L.proposal[c.p[i]])}</td>
      <td>${typeText}${rule ? `<span class="rule-note">${esc(rule)}</span>` : ''}</td>
      <td class="${wm === 0 ? 'vote-against' : ''}">${L.vote[c.v[i]]}</td><td>${L.vsMgmt[c.mr[i]]}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="loading-note">No votes match these filters.</td></tr>';
  const sortName = { date: 'most recent', company: 'company A–Z', fund: 'fund A–Z', type: 'type', vote: 'vote' }[sort.col];
  document.getElementById('result-count').textContent = idx.length > CAP
    ? `Showing ${CAP.toLocaleString()} of ${idx.length.toLocaleString()} matching votes (sorted by ${sortName}). Narrow the filters to see others.`
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
  const cols = ['meeting_date', 'quarter', 'company', 'fund', 'family', 'group', 'label', 'style', 'proposal', 'type', 'label_rule', 'topic', 'vote', 'with_management'];
  const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [cols.join(',')];
  filteredIndex().forEach(i => {
    const f = D.funds[c.f[i]];
    lines.push([L.date[c.d[i]], L.quarter[c.q[i]], L.company[c.c[i]], f.name, f.family, f.group, f.label, f.style,
      L.proposal[c.p[i]], L.stance[c.st[i]], L.rule[D.proposalRule[c.p[i]]], L.category[c.cat[i]], L.vote[c.v[i]], c.wm[i] === 1 ? 'Y' : c.wm[i] === 0 ? 'N' : ''].map(cell).join(','));
  });
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'proxy-votes-filtered.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function showFatal(message) {
  document.getElementById('table-body').innerHTML = `<tr><td colspan="7" class="loading-note">${message}</td></tr>`;
  const box = document.getElementById('load-error');
  box.textContent = message;
  box.hidden = false;
}

if (!window.Chart) {
  showFatal('The charting library could not be loaded (check your connection or an ad/script blocker). Try reloading.');
} else {
  document.querySelector('main').classList.add('is-loading');
  fetch('data/site_votes.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(data => {
    D = data;
    IS_CAST = D.lists.vote.map(v => ['FOR', 'AGAINST', 'ABSTAIN', 'WITHHOLD'].includes(v));
    IS_FOR = D.lists.vote.map(v => v === 'FOR');
    TOPICS = [...D.lists.category].sort((a, b) => TOPIC_LABEL(a).localeCompare(TOPIC_LABEL(b)));
    LAST_Q = D.lists.quarter.length - 1;
    buildSeasons();
    buildRanks();
    setupControls();
    applyStateFromURL();
    drawAllFilters();
    document.querySelector('main').classList.remove('is-loading');
    render();
  }).catch(err => showFatal(`Could not load the votes (${err.message}). Try reloading.`));
}
