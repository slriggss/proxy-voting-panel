// Builds the report page's charts from data/findings.json. Every number comes
// from scripts/analyze.js; nothing here is typed in by hand.
//
// Charts are built from factories (build) rather than ready-made configs, so
// the same chart can be rebuilt with fresh theme colors when the reader flips
// the light/dark toggle -- no page reload, no intro animations replayed.
const chartRegistry = []; // { canvas, build, chart }

// Create each chart once its card opens (see whenCardOpens in charts-common.js).
function makeChart(canvasId, build) {
  const canvas = document.getElementById(canvasId);
  const entry = { canvas, build, chart: null };
  chartRegistry.push(entry);
  whenCardOpens(canvas.closest('.chart-card'), () => {
    const config = build();
    if (REDUCED_MOTION) {
      if (config.options && config.options.plugins) delete config.options.plugins.esgIntro;
      if (config.options) config.options.animation = false;
    }
    entry.chart = new Chart(canvas, config);
  });
}

ESG_ON_THEME_CHANGE(() => {
  chartRegistry.forEach((entry) => {
    if (!entry.chart) return; // not built yet: it will pick up the new colors when it opens
    entry.chart.destroy();
    const config = entry.build();
    config.options = config.options || {};
    config.options.animation = false;
    if (config.options.plugins) delete config.options.plugins.esgIntro;
    entry.chart = new Chart(entry.canvas, config);
  });
});

// Count a headline number up from 0; the final text is the exact value.
function countUp(el, target) {
  if (REDUCED_MOTION) { el.textContent = target.toLocaleString(); return; }
  const start = performance.now(), dur = 1400;
  function tick(now) {
    const t = Math.min(1, (now - start) / dur);
    el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3))).toLocaleString();
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function showLoadError(message) {
  const box = document.getElementById('load-error');
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
}

const SEASON_LABELS = { 2024: '2023–24', 2025: '2024–25', 2026: '2025–26' };
const SEASONS = ['2024', '2025', '2026'];
const SMALL_N = 30; // fewer votes than this: drawn hollow and flagged

// Short names for chart labels.
const SHORT = {
  'Vanguard 500 Index Fund': 'Vanguard 500 Index',
  'Vanguard ESG U.S. Stock ETF': 'Vanguard ESG U.S. Stock',
  'Vanguard FTSE Social Index Fund': 'Vanguard FTSE Social Index',
  'iShares Core S&P 500 ETF': 'iShares Core S&P 500',
  'iShares ESG Aware MSCI USA ETF': 'iShares ESG Aware USA',
  'iShares ESG Screened S&P 500 ETF': 'iShares ESG Screened S&P 500',
  'iShares Paris-Aligned Climate MSCI USA ETF': 'iShares Paris-Aligned Climate',
  'SPDR Portfolio S&P 500 ETF': 'SPDR Portfolio S&P 500',
  'SPDR S&P 500 ESG ETF': 'SPDR S&P 500 ESG',
  'SPDR MSCI USA Gender Diversity Index ETF': 'SPDR Gender Diversity',
  'Fidelity 500 Index Fund': 'Fidelity 500 Index',
  'Fidelity Contrafund': 'Fidelity Contrafund',
  'Fidelity U.S. Sustainability Index Fund': 'Fidelity U.S. Sustainability Index',
  'Fidelity Sustainable U.S. Equity Fund': 'Fidelity Sustainable U.S. Equity',
  'The Growth Fund of America': 'Growth Fund of America',
  'Washington Mutual Investors Fund': 'Washington Mutual Investors',
  'Parnassus Core Equity Fund': 'Parnassus Core Equity',
  'Calvert US Large-Cap Core Responsible Index Fund': 'Calvert Responsible Index',
  'Calvert Equity Fund': 'Calvert Equity',
  'Domini Impact Equity Fund': 'Domini Impact Equity',
  'Impax US Sustainable Economy Fund': 'Impax Sustainable Economy',
  'Green Century Equity Fund': 'Green Century Equity',
};
const short = f => SHORT[f] || f;

// "12.3% (n = 101, 95% interval 5.1–19.2%)"
const fmtShare = (s) => (s.pct == null ? 'no votes' : `${s.pct}% (n = ${s.n.toLocaleString()}, 95% interval ${s.lo}–${s.hi}%)`);

async function main() {
  if (!window.Chart) {
    showLoadError('The charting library could not be loaded (check your connection or an ad/script blocker), so the charts are not shown. The written findings below are unaffected.');
    return;
  }
  let F;
  try {
    const res = await fetch('data/findings.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    F = await res.json();
  } catch (err) {
    showLoadError(`The data behind the charts could not be loaded (${err.message}). Try reloading the page. The written findings below are unaffected.`);
    return;
  }
  const C = window.ESG_COLORS;
  const groupColor = (g) => ({ 'Big Three': C.series[0], 'Other large managers': C.series[1], 'ESG families': C.series[2] }[g]);

  countUp(document.getElementById('stat-votes'), F.headline.votes);
  countUp(document.getElementById('stat-funds'), F.headline.funds);
  countUp(document.getElementById('stat-companies'), F.headline.companies);
  countUp(document.getElementById('stat-quarters'), F.headline.quarters);

  const pctAxis = (title, max, stepSize) => ({
    min: 0, max, grid: { color: C.grid }, ticks: { color: C.muted, stepSize, callback: v => v + '%' },
    title: title ? { display: true, text: title, color: C.textSecondary, font: { size: 12 } } : undefined,
  });
  const labelAxis = () => ({ grid: { display: false, drawTicks: false }, ticks: { color: C.textSecondary, autoSkip: false } });

  // Datasets are passed as functions so colors are read from the active theme
  // each time a chart is (re)built.

  // Horizontal bars. `tip(ctx)` returns the tooltip lines for a bar.
  function hbar(id, labels, makeDatasets, xTitle, xMax, tip) {
    const step = 60;
    makeChart(id, () => {
      const datasets = makeDatasets();
      return {
        type: 'bar',
        data: { labels, datasets: datasets.map(d => ({ borderRadius: 4, maxBarThickness: 18, ...d })) },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          animation: staggered(step, 800),
          layout: { padding: { right: 44 } },
          plugins: {
            legend: { display: datasets.length > 1, position: 'bottom' },
            tooltip: { callbacks: { label: tip } },
            esgAnnotate: { valueLabels: { suffix: '%', decimals: 1, size: 11 } },
            esgIntro: { mode: 'fade', after: 800 + step * labels.length },
          },
          scales: { x: pctAxis(xTitle, xMax), y: labelAxis() },
        },
      };
    });
  }

  function vbar(id, labels, makeDatasets, yTitle, yMax, opts = {}) {
    const step = 180;
    makeChart(id, () => {
      const datasets = makeDatasets();
      return {
        type: 'bar',
        data: { labels, datasets: datasets.map(d => ({ borderRadius: 4, maxBarThickness: 56, ...d })) },
        options: {
          responsive: true, maintainAspectRatio: false,
          animation: staggered(step, 850),
          layout: { padding: { top: 26 } },
          plugins: {
            legend: { display: datasets.length > 1, position: 'bottom' },
            tooltip: { callbacks: { label: opts.tip || (ctx => `${ctx.dataset.label}: ${ctx.parsed.y}%`) } },
            esgAnnotate: opts.annotate || { valueLabels: { suffix: '%', decimals: 1 } },
            esgIntro: { mode: 'fade', after: 850 + step * labels.length },
          },
          scales: {
            x: { stacked: !!opts.stacked, grid: { display: false }, ticks: { color: C.textSecondary } },
            y: opts.stacked
              ? { stacked: true, grid: { color: C.grid }, ticks: { color: C.muted }, title: { display: true, text: yTitle, color: C.textSecondary, font: { size: 12 } } }
              : pctAxis(yTitle, yMax),
          },
        },
      };
    });
  }

  // Lines by reporting year. Each series carries its per-year share objects
  // (pts), so points built on fewer than SMALL_N votes are drawn hollow.
  // `ci` is an index into the theme's series colors.
  function lines(id, series, yTitle, yMax, stepSize) {
    makeChart(id, () => {
      const narrow = document.getElementById(id).parentElement.clientWidth < 560;
      return {
        type: 'line',
        data: {
          labels: SEASONS.map(s => SEASON_LABELS[s]),
          datasets: series.map((s) => {
            const color = C.series[s.ci];
            return {
              label: s.label, data: s.pts.map(p => p.pct), pts: s.pts,
              borderColor: color, backgroundColor: color + '1a',
              borderWidth: 2.5, pointRadius: 4.5, pointHoverRadius: 6.5, pointBorderWidth: 2, tension: 0.2,
              pointBackgroundColor: s.pts.map(p => (p.n < SMALL_N ? C.surface : color)),
              pointBorderColor: s.pts.map(() => color),
            };
          }),
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          animation: { duration: 0 },
          layout: { padding: { right: narrow ? 0 : 240, top: 12 } },
          interaction: { mode: 'nearest', intersect: false },
          plugins: {
            legend: { display: narrow, position: 'bottom' },
            tooltip: { callbacks: { label: ctx => { const pt = ctx.dataset.pts[ctx.dataIndex]; return `${ctx.dataset.label}: ${fmtShare(pt)}${pt.n < SMALL_N ? ' — too few votes to read' : ''}`; } } },
            esgAnnotate: narrow ? undefined : { endLabels: { suffix: '%', decimals: 1 } },
            esgIntro: { mode: 'sequence', gap: 500 },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: C.textSecondary } },
            y: pctAxis(yTitle, yMax, stepSize),
          },
        },
      };
    });
  }

  // 1. ESG siblings vs flagships.
  {
    const pairs = F.siblings.pairs, ref = F.siblings.reference;
    const sib = (a, b) => `${short(a)} → ${short(b).replace(/^(Vanguard|iShares|SPDR|Fidelity) /, '')}`;
    const all = pairs.concat([ref]);
    hbar('chart-siblings', pairs.map(p => sib(p.a, p.b)).concat([`${short(ref.a)} → Calvert (other manager)`]), () => [{
      data: all.map(p => p.shDifferPct),
      backgroundColor: pairs.map(() => C.series[0]).concat([C.series[7]]),
    }], 'Shareholder proposals with a different vote (%)', 75,
    ctx => { const p = all[ctx.dataIndex]; return `${p.shDifferPct}% of ${p.shShared.toLocaleString()} proposals (95% interval ${p.shLo}–${p.shHi}%)`; });
  }

  // 2. Pro-ESG support by fund, sorted.
  {
    const funds = [...F.proEsgByFund].sort((a, b) => b.all.pct - a.all.pct);
    hbar('chart-divide', funds.map(f => short(f.fund)), () => [{
      data: funds.map(f => f.all.pct),
      backgroundColor: funds.map(f => groupColor(f.group)),
    }], 'Support for pro-ESG shareholder proposals (%)', 100,
    ctx => { const f = funds[ctx.dataIndex]; return [fmtShare(f.all), `At S&P 500 meetings only: ${f.matched.pct}% (n = ${f.matched.n.toLocaleString()})`]; });
  }

  // 3. Big Three (and Fidelity) flagships by season.
  {
    const pick = ['SPDR Portfolio S&P 500 ETF', 'Fidelity 500 Index Fund', 'iShares Core S&P 500 ETF', 'Vanguard 500 Index Fund'];
    const colorIdx = [3, 1, 0, 7];
    lines('chart-bigthree', pick.map((f, i) => {
      const row = F.proEsgByFund.find(x => x.fund === f);
      return { label: short(f), pts: SEASONS.map(s => row.bySeason[s]), ci: colorIdx[i] };
    }), 'Support for pro-ESG proposals (%)', 15, 5);
  }

  // 4. What's on the ballot.
  {
    const b = F.ballot;
    vbar('chart-ballot', b.map(x => SEASON_LABELS[x.season]), () => [
      { label: 'Pro-ESG', data: b.map(x => x.pro), backgroundColor: C.series[2] },
      { label: 'Anti-ESG', data: b.map(x => x.anti), backgroundColor: C.series[7] },
      { label: 'Unclear', data: b.map(x => x.unclear), backgroundColor: C.series[3] },
      { label: 'Governance & other', data: b.map(x => x.governance), backgroundColor: C.series[6] },
    ], 'Shareholder proposals voted per flagship', null, {
      stacked: true,
      tip: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}`,
      annotate: { note: `Anti-ESG share of E&S proposals: ${b[0].antiShareOfES}% → ${b[b.length - 1].antiShareOfES}%`, notePos: 'tr' },
    });
  }

  // 5. Anti-ESG vs pro-ESG support by group.
  vbar('chart-anti', F.antiEsg.map(g => g.group), () => [
    { label: 'Pro-ESG proposals', data: F.antiEsg.map(g => g.proSupport.pct), backgroundColor: C.series[2], shares: F.antiEsg.map(g => g.proSupport) },
    { label: 'Anti-ESG proposals', data: F.antiEsg.map(g => g.antiSupport.pct), backgroundColor: C.series[7], shares: F.antiEsg.map(g => g.antiSupport) },
  ], 'Support (%)', 100, { tip: ctx => `${ctx.dataset.label}: ${fmtShare(ctx.dataset.shares[ctx.dataIndex])}` });

  // 6. ESG specialists by season.
  {
    const colorIdx = [2, 0, 4, 6, 7, 3];
    lines('chart-specialists', F.esgSpecialists.map((s, i) => ({
      label: short(s.fund), pts: SEASONS.map(y => s.bySeason[y]), ci: colorIdx[i],
    })), 'Support for pro-ESG proposals (%)', 100);
  }

  // 7. Pay and board opposition by fund.
  {
    const funds = [...F.payAndBoards].sort((a, b) => b.sayOnPay.pct - a.sayOnPay.pct);
    hbar('chart-pay', funds.map(f => short(f.fund)), () => [
      { label: 'Against say-on-pay', data: funds.map(f => f.sayOnPay.pct), backgroundColor: C.series[4], maxBarThickness: 12, key: 'sayOnPay', mkey: 'sayOnPayMatched' },
      { label: 'Against or withhold on directors', data: funds.map(f => f.directors.pct), backgroundColor: C.series[6], maxBarThickness: 12, key: 'directors', mkey: 'directorsMatched' },
    ], 'Share of votes not FOR (%)', 100,
    ctx => { const f = funds[ctx.dataIndex], d = ctx.dataset; return [`${d.label}: ${fmtShare(f[d.key])}`, `At S&P 500 meetings only: ${f[d.mkey].pct}% (n = ${f[d.mkey].n.toLocaleString()})`]; });
  }

  // 8. Governance vs pro-ESG support by group.
  vbar('chart-governance', F.governanceVsEsg.map(g => g.group), () => [
    { label: 'Pro-ESG proposals', data: F.governanceVsEsg.map(g => g.proEsg.pct), backgroundColor: C.series[2], shares: F.governanceVsEsg.map(g => g.proEsg) },
    { label: 'All governance proposals', data: F.governanceVsEsg.map(g => g.governance.pct), backgroundColor: C.series[6], shares: F.governanceVsEsg.map(g => g.governance) },
    { label: 'Shareholder rights & defenses', data: F.governanceVsEsg.map(g => g.shareholderRights.pct), backgroundColor: C.series[0], shares: F.governanceVsEsg.map(g => g.shareholderRights) },
  ], 'Support (%)', 100, { tip: ctx => `${ctx.dataset.label}: ${fmtShare(ctx.dataset.shares[ctx.dataIndex])}` });

  // 9. Capital Group's governance shift.
  {
    const cg = F.capitalGroup;
    vbar('chart-capital', SEASONS.map(s => SEASON_LABELS[s]), () => cg.map((c, i) => ({
      label: short(c.fund), data: SEASONS.map(s => c.governance[s].pct), backgroundColor: [C.series[1], C.series[3]][i], fund: c,
    })), 'Support for governance proposals (%)', 100, {
      tip: ctx => {
        const c = ctx.dataset.fund, s = SEASONS[ctx.dataIndex];
        return [`${ctx.dataset.label}: ${fmtShare(c.governance[s])}`, `Rule-identified governance only: ${c.governanceRuled[s].pct}% (n = ${c.governanceRuled[s].n})`];
      },
    });
  }
}

main().catch((err) => {
  console.error(err);
  showLoadError(`Something went wrong while drawing the charts (${err.message}). Try reloading the page.`);
});
