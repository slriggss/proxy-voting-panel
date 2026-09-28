// Builds the report page's charts from data/findings.json. Every number comes
// from scripts/analyze.js; nothing here is typed in by hand.

// Create each chart once its card opens (see whenCardOpens in charts-common.js).
function makeChart(canvasId, config) {
  const canvas = document.getElementById(canvasId);
  whenCardOpens(canvas.closest('.chart-card'), () => {
    if (REDUCED_MOTION) {
      if (config.options && config.options.plugins) delete config.options.plugins.esgIntro;
      if (config.options) config.options.animation = false;
    }
    new Chart(canvas, config);
  });
}

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

const SEASON_LABELS = { 2024: '2023–24', 2025: '2024–25', 2026: '2025–26' };
const SEASONS = ['2024', '2025', '2026'];

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

async function main() {
  const F = await fetch('data/findings.json').then(r => r.json());
  const C = window.ESG_COLORS;
  const GROUP_COLOR = { 'Big Three': C.series[0], 'Active managers': C.series[1], 'ESG families': C.series[2] };

  countUp(document.getElementById('stat-votes'), F.headline.votes);
  countUp(document.getElementById('stat-funds'), F.headline.funds);
  countUp(document.getElementById('stat-companies'), F.headline.companies);
  countUp(document.getElementById('stat-quarters'), F.headline.quarters);

  const pctAxis = (title, max, stepSize) => ({
    min: 0, max, grid: { color: C.grid }, ticks: { color: C.muted, stepSize, callback: v => v + '%' },
    title: title ? { display: true, text: title, color: C.textSecondary, font: { size: 12 } } : undefined,
  });
  const labelAxis = { grid: { display: false, drawTicks: false }, ticks: { color: C.textSecondary, autoSkip: false } };

  function hbar(id, labels, datasets, xTitle, xMax, extra = {}) {
    const step = 60;
    makeChart(id, {
      type: 'bar',
      data: { labels, datasets: datasets.map(d => ({ borderRadius: 4, maxBarThickness: 18, ...d })) },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        animation: staggered(step, 800),
        layout: { padding: { right: 44 } },
        plugins: {
          legend: { display: datasets.length > 1, position: 'bottom' },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${ctx.parsed.x}%` } },
          esgAnnotate: { valueLabels: { suffix: '%', decimals: 1, size: 11 } },
          esgIntro: { mode: 'fade', after: 800 + step * labels.length },
          ...extra.plugins,
        },
        scales: { x: pctAxis(xTitle, xMax), y: labelAxis },
      },
    });
  }

  function vbar(id, labels, datasets, yTitle, yMax, extra = {}) {
    const step = 180;
    makeChart(id, {
      type: 'bar',
      data: { labels, datasets: datasets.map(d => ({ borderRadius: 4, maxBarThickness: 56, ...d })) },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: staggered(step, 850),
        layout: { padding: { top: 26 } },
        plugins: {
          legend: { display: datasets.length > 1, position: 'bottom' },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}${extra.unit === '' ? '' : '%'}` } },
          esgAnnotate: extra.annotate || { valueLabels: { suffix: '%', decimals: 1 } },
          esgIntro: { mode: 'fade', after: 850 + step * labels.length },
        },
        scales: {
          x: { stacked: !!extra.stacked, grid: { display: false }, ticks: { color: C.textSecondary } },
          y: extra.stacked
            ? { stacked: true, grid: { color: C.grid }, ticks: { color: C.muted }, title: { display: true, text: yTitle, color: C.textSecondary, font: { size: 12 } } }
            : pctAxis(yTitle, yMax),
        },
      },
    });
  }

  function lines(id, series, yTitle, yMax, stepSize) {
    const narrow = document.getElementById(id).parentElement.clientWidth < 560;
    makeChart(id, {
      type: 'line',
      data: {
        labels: SEASONS.map(s => SEASON_LABELS[s]),
        datasets: series.map((s, i) => ({
          label: s.label, data: s.data,
          borderColor: s.color || C.series[i], backgroundColor: (s.color || C.series[i]) + '1a',
          borderWidth: 2.5, pointRadius: 4, pointHoverRadius: 6,
          pointBackgroundColor: s.color || C.series[i], pointBorderColor: C.surface, pointBorderWidth: 2, tension: 0.2,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 0 },
        layout: { padding: { right: narrow ? 0 : 200, top: 12 } },
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { display: narrow, position: 'bottom' },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}%` } },
          esgAnnotate: narrow ? undefined : { endLabels: { suffix: '%', decimals: 1 } },
          esgIntro: { mode: 'sequence', gap: 500 },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: C.textSecondary } },
          y: pctAxis(yTitle, yMax, stepSize),
        },
      },
    });
  }

  // 1. ESG siblings vs flagships.
  {
    const pairs = F.siblings.pairs;
    const ref = F.siblings.reference;
    // Drop the family name from the sibling so labels fit: 'iShares Core S&P 500 → ESG Aware USA'.
    const sib = (a, b) => `${short(a)} → ${short(b).replace(/^(Vanguard|iShares|SPDR|Fidelity) /, '')}`;
    const labels = pairs.map(p => sib(p.a, p.b)).concat([`${short(ref.a)} → Calvert (other manager)`]);
    hbar('chart-siblings', labels, [{
      data: pairs.map(p => p.shDifferPct).concat([ref.shDifferPct]),
      backgroundColor: pairs.map(() => C.series[0]).concat([C.series[7]]),
    }], 'Shareholder proposals with a different vote (%)', 70);
  }

  // 2. Pro-ESG support by fund, sorted.
  {
    const funds = [...F.proEsgByFund].sort((a, b) => b.all.pct - a.all.pct);
    hbar('chart-divide', funds.map(f => short(f.fund)), [{
      data: funds.map(f => f.all.pct),
      backgroundColor: funds.map(f => GROUP_COLOR[f.group]),
    }], 'Support for pro-ESG shareholder proposals (%)', 100);
  }

  // 3. Big Three (and Fidelity) flagships by season.
  {
    const pick = ['SPDR Portfolio S&P 500 ETF', 'Fidelity 500 Index Fund', 'iShares Core S&P 500 ETF', 'Vanguard 500 Index Fund'];
    lines('chart-bigthree', pick.map((f, i) => {
      const row = F.proEsgByFund.find(x => x.fund === f);
      return { label: short(f), data: SEASONS.map(s => row.bySeason[s].pct), color: [C.series[3], C.series[1], C.series[0], C.series[7]][i] };
    }), 'Support for pro-ESG proposals (%)', 15, 5);
  }

  // 4. What's on the ballot.
  {
    const b = F.ballot;
    vbar('chart-ballot', b.map(x => SEASON_LABELS[x.season]), [
      { label: 'Pro-ESG', data: b.map(x => x.pro), backgroundColor: C.series[2] },
      { label: 'Anti-ESG', data: b.map(x => x.anti), backgroundColor: C.series[7] },
      { label: 'Unclear', data: b.map(x => x.unclear), backgroundColor: C.series[3] },
      { label: 'Governance & other', data: b.map(x => x.governance), backgroundColor: C.series[6] },
    ], 'Shareholder proposals voted per flagship', null, {
      stacked: true, unit: '',
      annotate: { note: `Anti-ESG share of E&S proposals: ${b[0].antiShareOfES}% → ${b[b.length - 1].antiShareOfES}%`, notePos: 'tr' },
    });
  }

  // 5. Anti-ESG vs pro-ESG support by group.
  vbar('chart-anti', F.antiEsg.map(g => g.group), [
    { label: 'Pro-ESG proposals', data: F.antiEsg.map(g => g.proSupport.pct), backgroundColor: C.series[2] },
    { label: 'Anti-ESG proposals', data: F.antiEsg.map(g => g.antiSupport.pct), backgroundColor: C.series[7] },
  ], 'Support (%)', 100);

  // 6. ESG specialists by season.
  lines('chart-specialists', F.esgSpecialists.map((s, i) => ({
    label: short(s.fund), data: SEASONS.map(y => s.bySeason[y].pct), color: C.series[[2, 0, 4, 6, 7, 3][i]],
  })), 'Support for pro-ESG proposals (%)', 100);

  // 7. Pay and board opposition by fund.
  {
    const funds = [...F.payAndBoards].sort((a, b) => b.sayOnPay.pct - a.sayOnPay.pct);
    hbar('chart-pay', funds.map(f => short(f.fund)), [
      { label: 'Against say-on-pay', data: funds.map(f => f.sayOnPay.pct), backgroundColor: C.series[4], maxBarThickness: 12 },
      { label: 'Against or withhold on directors', data: funds.map(f => f.directors.pct), backgroundColor: C.series[6], maxBarThickness: 12 },
    ], 'Share of votes not FOR (%)', 100);
  }

  // 8. Governance vs pro-ESG support by group.
  vbar('chart-governance', F.governanceVsEsg.map(g => g.group), [
    { label: 'Pro-ESG proposals', data: F.governanceVsEsg.map(g => g.proEsg.pct), backgroundColor: C.series[2] },
    { label: 'All governance proposals', data: F.governanceVsEsg.map(g => g.governance.pct), backgroundColor: C.series[6] },
    { label: 'Shareholder rights & defenses', data: F.governanceVsEsg.map(g => g.shareholderRights.pct), backgroundColor: C.series[0] },
  ], 'Support (%)', 100);

  // 9. Capital Group's governance shift.
  vbar('chart-capital', SEASONS.map(s => SEASON_LABELS[s]), F.capitalGroup.map((c, i) => ({
    label: short(c.fund), data: SEASONS.map(s => c.governance[s].pct), backgroundColor: [C.series[1], C.series[3]][i],
  })), 'Support for governance proposals (%)', 100);
}

main();
