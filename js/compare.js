// Head-to-head comparison of two funds, from data/site_votes.json.
//
// Two funds' votes are paired when they are on the same proposal at the same
// company meeting. Filers word the same proposal slightly differently, so
// scripts/build_site_data.js gives such rows a shared match id (column `m`);
// this page joins on it. Proposals that only one fund voted on, or whose
// wording differs too much to match, are left out and counted in the note
// under the table.

let D = null;
let chart = null;

const FAMILY_ORDER = ['Vanguard', 'BlackRock', 'State Street', 'Fidelity', 'Capital Group', 'Parnassus', 'Calvert', 'Domini', 'Impax', 'Green Century'];
const STANCE_LABEL = {
  'management': 'Management proposals',
  'pro-ESG': 'Shareholder: pro-ESG',
  'anti-ESG': 'Shareholder: anti-ESG',
  'unclear': 'Shareholder: unclear',
  'governance': 'Shareholder: governance & other',
};
// What to compare on: a set of stances (matching the labels in the dashboard).
const TYPES = [
  { id: 'shareholder', label: 'Shareholder proposals', stances: ['pro-ESG', 'anti-ESG', 'unclear', 'governance'] },
  { id: 'pro-ESG', label: 'Pro-ESG proposals', stances: ['pro-ESG'] },
  { id: 'anti-ESG', label: 'Anti-ESG proposals', stances: ['anti-ESG'] },
  { id: 'governance', label: 'Governance & other', stances: ['governance'] },
  { id: 'management', label: 'Management proposals', stances: ['management'] },
  { id: 'all', label: 'All votes', stances: ['pro-ESG', 'anti-ESG', 'unclear', 'governance', 'management'] },
];
const DEFAULT = { a: 'Vanguard 500 Index Fund', b: 'Calvert US Large-Cap Core Responsible Index Fund', t: 'shareholder' };
let state = { ...DEFAULT };

let IS_CAST = [], IS_FOR = [];
let rowsByFund = []; // fund index -> row indexes
let last = null;      // last computed result (for export)

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const pct = (k, n) => (n ? (Math.round(1000 * k / n) / 10).toFixed(1) + '%' : '–');

function chip(label, pressed) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = label;
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', pressed ? 'true' : 'false');
  b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  return b;
}

function drawPickers() {
  const fundsSorted = D.funds.map(f => f.name).sort((a, b) => {
    const fa = D.funds.find(x => x.name === a), fb = D.funds.find(x => x.name === b);
    return FAMILY_ORDER.indexOf(fa.family) - FAMILY_ORDER.indexOf(fb.family) || a.localeCompare(b);
  });
  for (const which of ['a', 'b']) {
    const box = document.getElementById('pick-' + which);
    box.innerHTML = '';
    fundsSorted.forEach(name => {
      const b = chip(name, state[which] === name);
      b.addEventListener('click', () => { state[which] = name; drawPickers(); render(); });
      box.appendChild(b);
    });
  }
  const box = document.getElementById('type-chips');
  box.innerHTML = '';
  TYPES.forEach(t => {
    const b = chip(t.label, state.t === t.id);
    b.addEventListener('click', () => { state.t = t.id; drawPickers(); render(); });
    box.appendChild(b);
  });
}

function applyStateFromURL() {
  const p = new URLSearchParams(location.search);
  const names = D.funds.map(f => f.name);
  state = { ...DEFAULT };
  if (names.includes(p.get('a'))) state.a = p.get('a');
  if (names.includes(p.get('b'))) state.b = p.get('b');
  if (TYPES.some(t => t.id === p.get('t'))) state.t = p.get('t');
}
function syncURL() {
  const p = new URLSearchParams();
  if (state.a !== DEFAULT.a) p.set('a', state.a);
  if (state.b !== DEFAULT.b) p.set('b', state.b);
  if (state.t !== DEFAULT.t) p.set('t', state.t);
  const qs = p.toString();
  history.replaceState(null, '', qs ? '?' + qs : location.pathname);
}

function compute() {
  const c = D.cols, L = D.lists;
  const fa = D.funds.findIndex(f => f.name === state.a), fb = D.funds.findIndex(f => f.name === state.b);
  const type = TYPES.find(t => t.id === state.t);
  const okStance = new Set(type.stances.map(s => L.stance.indexOf(s)));
  const eligible = i => okStance.has(c.st[i]) && IS_CAST[c.v[i]];
  const meetingOf = i => c.c[i] * 100000 + c.d[i];

  const mapA = new Map(), meetingsA = new Set();
  for (const i of rowsByFund[fa]) { if (!eligible(i)) continue; if (!mapA.has(c.m[i])) mapA.set(c.m[i], i); meetingsA.add(meetingOf(i)); }
  const pairs = [];
  let bAtSharedMeetings = 0;
  for (const j of rowsByFund[fb]) {
    if (!eligible(j) || !meetingsA.has(meetingOf(j))) continue;
    bAtSharedMeetings++;
    const i = mapA.get(c.m[j]);
    if (i !== undefined) pairs.push([i, j]);
  }
  return { fa, fb, type, pairs, bAtSharedMeetings };
}

function render() {
  syncURL();
  const C = window.ESG_COLORS, L = D.lists, c = D.cols;
  const sameFund = state.a === state.b;
  const r = compute();
  last = r;
  const n = r.pairs.length;
  const differ = r.pairs.filter(([i, j]) => c.v[i] !== c.v[j]);
  const forA = r.pairs.filter(([i]) => IS_FOR[c.v[i]]).length, forB = r.pairs.filter(([, j]) => IS_FOR[c.v[j]]).length;
  const A = state.a, B = state.b;

  document.getElementById('stat-a-label').textContent = `${A} voted FOR`;
  document.getElementById('stat-b-label').textContent = `${B} voted FOR`;
  document.getElementById('th-a').textContent = A;
  document.getElementById('th-b').textContent = B;
  document.getElementById('stat-pairs').textContent = n.toLocaleString();
  document.getElementById('stat-differ').textContent = n ? `${pct(differ.length, n)}` : '–';
  document.getElementById('stat-a').textContent = pct(forA, n);
  document.getElementById('stat-b').textContent = pct(forB, n);

  const noun = r.type.label.toLowerCase();
  document.getElementById('summary').textContent = sameFund
    ? 'Pick two different funds to compare.'
    : n
      ? `On the ${n.toLocaleString()} matched ${noun} both funds voted, ${A} and ${B} cast different votes ${pct(differ.length, n)} of the time (${differ.length.toLocaleString()} proposal${differ.length === 1 ? "" : "s"}).`
      : `No ${noun} matched between these two funds: they may hold different companies, or one may not vote on this type.`;

  // Chart: share voted FOR by stance, on the matched pairs.
  {
    const stances = ['pro-ESG', 'anti-ESG', 'governance', 'unclear', 'management'].filter(s => r.type.stances.includes(s));
    const rows = stances.map(s => {
      const si = L.stance.indexOf(s);
      const P = r.pairs.filter(([i]) => c.st[i] === si);
      return { s, n: P.length, a: P.filter(([i]) => IS_FOR[c.v[i]]).length, b: P.filter(([, j]) => IS_FOR[c.v[j]]).length, d: P.filter(([i, j]) => c.v[i] !== c.v[j]).length };
    }).filter(x => x.n > 0);
    const val = (k, x) => Math.round(1000 * x[k] / x.n) / 10;
    if (chart) { chart.destroy(); chart = null; }
    if (rows.length && !sameFund) {
      chart = new Chart(document.getElementById('chart-types'), {
        type: 'bar',
        data: {
          labels: rows.map(x => STANCE_LABEL[x.s].replace('Shareholder: ', 'SH: ')),
          datasets: [
            { label: A, data: rows.map(x => val('a', x)), backgroundColor: C.series[0], borderRadius: 4, maxBarThickness: 40, key: 'a' },
            { label: B, data: rows.map(x => val('b', x)), backgroundColor: C.series[1], borderRadius: 4, maxBarThickness: 40, key: 'b' },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          animation: window.REDUCED_MOTION || redrawing ? false : undefined,
          layout: { padding: { top: 26 } },
          plugins: {
            legend: { position: 'bottom' },
            tooltip: { callbacks: {
              label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}% FOR`,
              afterBody: items => { const x = rows[items[0].dataIndex]; return [`${x.n.toLocaleString()} matched proposals; the funds differ on ${pct(x.d, x.n)}`]; },
            } },
            esgAnnotate: { valueLabels: { suffix: '%', decimals: 1 } },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: C.textSecondary } },
            y: { min: 0, max: 100, grid: { color: C.grid }, ticks: { color: C.muted, callback: v => v + '%' } },
          },
        },
      });
    }
  }

  // Table: the disagreements, most recent meetings first.
  const CAP = 300;
  const sorted = differ.slice().sort((p, q) => L.date[c.d[q[0]]].localeCompare(L.date[c.d[p[0]]]) || L.company[c.c[p[0]]].localeCompare(L.company[c.c[q[0]]]));
  const shown = sorted.slice(0, CAP);
  document.getElementById('table-body').innerHTML = shown.map(([i, j]) => {
    const typeText = STANCE_LABEL[L.stance[c.st[i]]].replace('Shareholder: ', 'SH: ').replace(' proposals', '');
    return `<tr><td>${L.date[c.d[i]]}</td><td>${esc(L.company[c.c[i]])}</td><td class="proposal-cell">${esc(L.proposal[c.p[i]])}</td><td>${typeText}</td>
      <td class="vote-cell-a">${L.vote[c.v[i]]}</td><td class="vote-cell-b">${L.vote[c.v[j]]}</td></tr>`;
  }).join('') || `<tr><td colspan="6" class="loading-note">${sameFund ? 'Pick two different funds.' : n ? 'These funds voted the same way on every matched proposal.' : 'No matched proposals.'}</td></tr>`;
  document.getElementById('result-count').textContent = differ.length > CAP
    ? `Showing the ${CAP} most recent of ${differ.length.toLocaleString()} proposals where the funds voted differently.`
    : `${differ.length.toLocaleString()} proposal${differ.length === 1 ? '' : 's'} where the funds voted differently.`;
  document.getElementById('coverage-note').textContent = r.bAtSharedMeetings
    ? `Matching: ${n.toLocaleString()} of the ${r.bAtSharedMeetings.toLocaleString()} ${noun} that ${B} voted at meetings ${A} also voted at were matched to a proposal ${A} voted on (${pct(n, r.bAtSharedMeetings)}). Unmatched ones were voted by only one fund or worded too differently to pair; filers in different families word the same proposal differently, so cross-family pairs match less often than pairs within a family. The report matches on exact wording instead, so its counts can differ from these by a few proposals.`
    : '';
}

function exportCSV() {
  if (!last) return;
  const L = D.lists, c = D.cols;
  const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [['meeting_date', 'company', 'proposal_type', 'proposal_a', 'proposal_b', 'fund_a', 'vote_a', 'fund_b', 'vote_b', 'same_vote'].join(',')];
  last.pairs.forEach(([i, j]) => lines.push([L.date[c.d[i]], L.company[c.c[i]], L.stance[c.st[i]], L.proposal[c.p[i]], L.proposal[c.p[j]], state.a, L.vote[c.v[i]], state.b, L.vote[c.v[j]], c.v[i] === c.v[j] ? 'Y' : 'N'].map(cell).join(',')));
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'proxy-fund-comparison.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

let redrawing = false;
ESG_ON_THEME_CHANGE(() => {
  if (!D) return;
  redrawing = true;
  try { render(); } finally { redrawing = false; }
});

function showFatal(message) {
  document.getElementById('summary').textContent = '';
  document.getElementById('table-body').innerHTML = `<tr><td colspan="6" class="loading-note">${message}</td></tr>`;
  const box = document.getElementById('load-error');
  box.textContent = message;
  box.hidden = false;
}

if (!window.Chart) {
  showFatal('The charting library could not be loaded (check your connection or an ad/script blocker). Try reloading.');
} else {
  fetch('data/site_votes.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(data => {
    D = data;
    IS_CAST = D.lists.vote.map(v => ['FOR', 'AGAINST', 'ABSTAIN', 'WITHHOLD'].includes(v));
    IS_FOR = D.lists.vote.map(v => v === 'FOR');
    rowsByFund = D.funds.map(() => []);
    for (let i = 0; i < D.n; i++) rowsByFund[D.cols.f[i]].push(i);
    applyStateFromURL();
    drawPickers();
    document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
    document.getElementById('btn-share').addEventListener('click', () => {
      const btn = document.getElementById('btn-share'), original = btn.textContent;
      navigator.clipboard.writeText(location.href).then(() => {
        btn.textContent = 'Link copied!'; setTimeout(() => { btn.textContent = original; }, 1500);
      }).catch(() => {
        btn.textContent = 'Could not copy — copy the URL bar'; setTimeout(() => { btn.textContent = original; }, 2000);
      });
    });
    document.querySelectorAll('[data-download]').forEach(btn => btn.addEventListener('click', () => {
      if (!chart) return;
      const a = document.createElement('a');
      a.href = chart.toBase64Image(); a.download = 'fund-comparison.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }));
    render();
  }).catch(err => showFatal(`Could not load the votes (${err.message}). Try reloading.`));
}
