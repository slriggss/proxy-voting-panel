// Computes every number on the report page from data/votes.csv and writes
// data/findings.json.
//
//   node scripts/analyze.js
//
// Definitions used throughout:
//   support       share of a fund's votes cast FOR, out of FOR + AGAINST +
//                 ABSTAIN + WITHHOLD ("take no action" is not a vote cast).
//                 Every support figure carries n (votes) and a 95% Wilson
//                 interval (lo, hi) so small samples are visible.
//   opposition    for management items (say-on-pay, director elections): the
//                 share of votes cast that were not FOR
//   stance        pro-ESG / anti-ESG / unclear / governance, from
//                 scripts/stance_rules.js (shareholder proposals only)
//   same proposal same company (CUSIP), meeting date and proposal text; used
//                 when comparing two funds' votes head to head
//   S&P 500 meeting  a company meeting at which at least 3 of the 4 S&P 500
//                 index flagships voted. Restricting a fund to these meetings
//                 puts every fund on (nearly) the same ballot; the report
//                 uses it to check that differences between funds are not just
//                 differences in which companies they hold.
// Rates are pooled over fund-level votes: a proposal voted by three funds
// counts three times in a pooled rate.

const fs = require('fs');
const path = require('path');
const { loadVotes, companyNames, ROOT } = require('./load_votes');

const rows = loadVotes();
const SEASONS = ['2024', '2025', '2026'];
const POSITIONS = new Set(['FOR', 'AGAINST', 'ABSTAIN', 'WITHHOLD']);
const BIG3 = 'Big Three', OTHER = 'Other large managers', ESGF = 'ESG families';
const GROUPS = [BIG3, OTHER, ESGF];
const r1 = x => (x == null ? null : Math.round(x * 10) / 10);
const rate = (hits, n) => (n ? r1(100 * hits / n) : null);

// 95% Wilson score interval for a share, in percent.
function wilson(hits, n) {
  if (!n) return { lo: null, hi: null };
  const z = 1.96, p = hits / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d;
  const h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return { lo: r1(100 * Math.max(0, c - h)), hi: r1(100 * Math.min(1, c + h)) };
}
const share = (hits, n) => ({ pct: rate(hits, n), n, k: hits, ...wilson(hits, n) });
const supportOf = R => { const c = R.filter(r => POSITIONS.has(r.vote)); return share(c.filter(r => r.vote === 'FOR').length, c.length); };
const oppositionOf = R => { const c = R.filter(r => POSITIONS.has(r.vote)); return share(c.filter(r => r.vote !== 'FOR').length, c.length); };

const FUND_ORDER = [
  'Vanguard 500 Index Fund', 'Vanguard ESG U.S. Stock ETF', 'Vanguard FTSE Social Index Fund',
  'iShares Core S&P 500 ETF', 'iShares ESG Aware MSCI USA ETF', 'iShares ESG Screened S&P 500 ETF', 'iShares Paris-Aligned Climate MSCI USA ETF',
  'SPDR Portfolio S&P 500 ETF', 'SPDR S&P 500 ESG ETF', 'SPDR MSCI USA Gender Diversity Index ETF',
  'Fidelity 500 Index Fund', 'Fidelity Contrafund', 'Fidelity U.S. Sustainability Index Fund', 'Fidelity Sustainable U.S. Equity Fund',
  'The Growth Fund of America', 'Washington Mutual Investors Fund',
  'Parnassus Core Equity Fund', 'Calvert US Large-Cap Core Responsible Index Fund', 'Calvert Equity Fund',
  'Domini Impact Equity Fund', 'Impax US Sustainable Economy Fund', 'Green Century Equity Fund',
];
const byFund = new Map(FUND_ORDER.map(f => [f, rows.filter(r => r.fund === f)]));
const fundMeta = f => { const r = byFund.get(f)[0]; return { fund: f, family: r.family, group: r.group, style: r.style, label: r.label }; };
const sh = R => R.filter(r => r.proponent === 'Shareholder');

// The four S&P 500 index flagships hold nearly the same companies, so their
// proposals track the ballot itself.
const FLAGSHIPS = ['Vanguard 500 Index Fund', 'iShares Core S&P 500 ETF', 'SPDR Portfolio S&P 500 ETF', 'Fidelity 500 Index Fund'];
const meetingKey = r => `${r.cusip}|${r.meeting_date}`;
const sp500Meetings = (() => {
  const seen = new Map();
  for (const f of FLAGSHIPS) for (const r of byFund.get(f)) {
    const k = meetingKey(r);
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k).add(f);
  }
  return new Set([...seen].filter(([, s]) => s.size >= 3).map(([k]) => k));
})();
const atSp500 = R => R.filter(r => sp500Meetings.has(meetingKey(r)));

const findings = {};

// --- Headline numbers ---------------------------------------------------------
findings.headline = {
  votes: rows.length,
  funds: FUND_ORDER.length,
  families: new Set(rows.map(r => r.family)).size,
  companies: new Set(rows.map(companyNames(rows))).size, // share classes count once
  quarters: new Set(rows.map(r => r.quarter)).size,
  firstQuarter: [...new Set(rows.map(r => r.quarter))].sort()[0],
  lastQuarter: [...new Set(rows.map(r => r.quarter))].sort().pop(),
  shareholderVotes: sh(rows).length,
  sp500Meetings: sp500Meetings.size,
};

// --- 1. Same proposal, flagship vs ESG sibling --------------------------------
const key = r => `${r.cusip}|${r.meeting_date}|${r.proposal.toLowerCase()}`;
const index = new Map(FUND_ORDER.map(f => [f, new Map(byFund.get(f).map(r => [key(r), r]))]));
function compare(a, b) {
  let shared = 0, differ = 0, shShared = 0, shDiffer = 0;
  for (const [k, ra] of index.get(a)) {
    const rb = index.get(b).get(k);
    if (!rb || !POSITIONS.has(ra.vote) || !POSITIONS.has(rb.vote)) continue;
    shared++; if (ra.vote !== rb.vote) differ++;
    if (ra.proponent === 'Shareholder') { shShared++; if (ra.vote !== rb.vote) shDiffer++; }
  }
  return { a, b, shared, differPct: rate(differ, shared), shShared, shDifferPct: rate(shDiffer, shShared), ...Object.fromEntries(Object.entries(wilson(shDiffer, shShared)).map(([k, v]) => ['sh' + k[0].toUpperCase() + k.slice(1), v])) };
}
findings.siblings = {
  pairs: [
    ['Vanguard 500 Index Fund', 'Vanguard ESG U.S. Stock ETF'],
    ['Vanguard 500 Index Fund', 'Vanguard FTSE Social Index Fund'],
    ['iShares Core S&P 500 ETF', 'iShares ESG Aware MSCI USA ETF'],
    ['iShares Core S&P 500 ETF', 'iShares ESG Screened S&P 500 ETF'],
    ['iShares Core S&P 500 ETF', 'iShares Paris-Aligned Climate MSCI USA ETF'],
    ['SPDR Portfolio S&P 500 ETF', 'SPDR S&P 500 ESG ETF'],
    ['SPDR Portfolio S&P 500 ETF', 'SPDR MSCI USA Gender Diversity Index ETF'],
    ['Fidelity 500 Index Fund', 'Fidelity U.S. Sustainability Index Fund'],
    ['Fidelity Contrafund', 'Fidelity Sustainable U.S. Equity Fund'],
  ].map(([a, b]) => ({ ...compare(a, b), family: fundMeta(a).family })),
  // For scale: how often an S&P 500 flagship and a dedicated ESG index fund disagree.
  reference: compare('Vanguard 500 Index Fund', 'Calvert US Large-Cap Core Responsible Index Fund'),
};

// --- 2. Pro-ESG support by fund (and by season) -------------------------------
// `all` pools every meeting the fund voted at. `matched` restricts to S&P 500
// meetings so funds are compared on (nearly) the same ballot.
findings.proEsgByFund = FUND_ORDER.map(f => {
  const R = sh(byFund.get(f));
  const pro = R.filter(r => r.stance === 'pro-ESG');
  const gov = R.filter(r => r.stance === 'governance');
  return {
    ...fundMeta(f),
    all: supportOf(pro),
    matched: supportOf(atSp500(pro)),
    bySeason: Object.fromEntries(SEASONS.map(s => [s, supportOf(pro.filter(r => r.season === s))])),
    antiEsg: supportOf(R.filter(r => r.stance === 'anti-ESG')),
    governance: supportOf(gov),
  };
});
{
  const diffs = findings.proEsgByFund.filter(x => x.all.pct != null && x.matched.pct != null).map(x => Math.abs(x.all.pct - x.matched.pct));
  findings.robustness = {
    maxMatchedDiff: r1(Math.max(...diffs)),
    minMatchedN: Math.min(...findings.proEsgByFund.map(x => x.matched.n)),
  };
}

// --- 3. What is on the ballot: shareholder proposals by stance and season ------
findings.ballot = SEASONS.map(s => {
  const perFund = FLAGSHIPS.map(f => {
    const R = sh(byFund.get(f)).filter(r => r.season === s);
    const c = st => R.filter(r => r.stance === st).length;
    return { fund: f, total: R.length, pro: c('pro-ESG'), anti: c('anti-ESG'), unclear: c('unclear'), governance: c('governance') };
  });
  const avg = k => Math.round(perFund.reduce((t, x) => t + x[k], 0) / perFund.length);
  const es = perFund.reduce((t, x) => t + x.pro + x.anti + x.unclear, 0);
  const anti = perFund.reduce((t, x) => t + x.anti, 0);
  return { season: s, total: avg('total'), pro: avg('pro'), anti: avg('anti'), unclear: avg('unclear'), governance: avg('governance'), antiShareOfES: rate(anti, es), perFund };
});

// --- 4. Anti-ESG proposals: support by group ----------------------------------
findings.antiEsg = GROUPS.map(g => {
  const R = sh(rows.filter(r => r.group === g));
  return { group: g, antiSupport: supportOf(R.filter(r => r.stance === 'anti-ESG')), proSupport: supportOf(R.filter(r => r.stance === 'pro-ESG')) };
});

// --- 5. ESG specialists by season ---------------------------------------------
findings.esgSpecialists = findings.proEsgByFund.filter(x => x.group === ESGF)
  .map(x => ({ fund: x.fund, family: x.family, bySeason: x.bySeason }));

// Is the 2025-26 decline just a change in which topics reached the ballot?
// Pro-ESG support by season within one SEC topic, for the ESG families and
// the Big Three, plus the ESG families restricted to S&P 500 meetings.
{
  const TOPICS = ['ENVIRONMENT OR CLIMATE', 'HUMAN RIGHTS OR HUMAN CAPITAL/WORKFORCE', 'DIVERSITY, EQUITY, AND INCLUSION', 'OTHER SOCIAL ISSUES'];
  const cell = (R, s) => supportOf(R.filter(r => r.season === s));
  const forGroup = g => {
    const R = sh(rows.filter(r => r.group === g && r.stance === 'pro-ESG'));
    return {
      group: g,
      all: Object.fromEntries(SEASONS.map(s => [s, cell(R, s)])),
      atSp500: Object.fromEntries(SEASONS.map(s => [s, cell(atSp500(R), s)])),
      topics: TOPICS.map(t => ({ topic: t, bySeason: Object.fromEntries(SEASONS.map(s => [s, cell(R.filter(r => r.category === t), s)])) })),
    };
  };
  findings.topicSeason = [ESGF, BIG3].map(forGroup);
}

// --- 6. Pay and boards ---------------------------------------------------------
findings.payAndBoards = FUND_ORDER.map(f => {
  const R = byFund.get(f).filter(r => r.proponent === 'Management');
  return {
    ...fundMeta(f),
    sayOnPay: oppositionOf(R.filter(r => /SAY-ON-PAY/.test(r.category))),
    directors: oppositionOf(R.filter(r => r.category === 'DIRECTOR ELECTIONS')),
    sayOnPayMatched: oppositionOf(atSp500(R.filter(r => /SAY-ON-PAY/.test(r.category)))),
    directorsMatched: oppositionOf(atSp500(R.filter(r => r.category === 'DIRECTOR ELECTIONS'))),
  };
});

// --- 7. Governance vs pro-ESG shareholder proposals, by group -----------------
const cat = (R, c) => supportOf(R.filter(r => r.stance === 'governance' && r.all_categories.includes(c)));
findings.governanceVsEsg = GROUPS.map(g => {
  const R = sh(rows.filter(r => r.group === g));
  return {
    group: g,
    proEsg: supportOf(R.filter(r => r.stance === 'pro-ESG')),
    governance: supportOf(R.filter(r => r.stance === 'governance')),
    shareholderRights: cat(R, 'SHAREHOLDER RIGHTS AND DEFENSES'),
    corporateGovernance: cat(R, 'CORPORATE GOVERNANCE'),
  };
});
// The "Other large managers" group is Fidelity (index and active funds) and
// Capital Group (active); split it by style so the two are not blended.
findings.otherManagersByStyle = ['Index', 'Active'].map(style => {
  const R = sh(rows.filter(r => r.group === OTHER && r.style === style));
  return {
    style,
    funds: [...new Set(R.map(r => r.fund))],
    proEsg: supportOf(R.filter(r => r.stance === 'pro-ESG')),
    governance: supportOf(R.filter(r => r.stance === 'governance')),
    shareholderRights: cat(R, 'SHAREHOLDER RIGHTS AND DEFENSES'),
  };
});

// --- 8. Capital Group's 2026 shift ---------------------------------------------
// "governance" here is governance and other: proposals no keyword rule
// recognized are counted in it too, so the matched-only line shows the same
// shift using proposals a rule positively identified as governance.
const ruled = R => R.filter(r => r.rule !== 'no rule matched');
findings.capitalGroup = ['The Growth Fund of America', 'Washington Mutual Investors Fund'].map(f => {
  const R = sh(byFund.get(f));
  const gov = s => R.filter(r => r.season === s && r.stance === 'governance');
  return {
    fund: f,
    governance: Object.fromEntries(SEASONS.map(s => [s, supportOf(gov(s))])),
    governanceRuled: Object.fromEntries(SEASONS.map(s => [s, supportOf(ruled(gov(s)))])),
    proEsg: Object.fromEntries(SEASONS.map(s => [s, supportOf(R.filter(r => r.season === s && r.stance === 'pro-ESG'))])),
  };
});

// --- Classifier and data notes ---------------------------------------------------
{
  const R = sh(byFund.get('Impax US Sustainable Economy Fund'));
  const s26 = R.filter(r => r.season === '2026' && POSITIONS.has(r.vote));
  const shAll = sh(rows);
  const gov = shAll.filter(r => r.stance === 'governance');
  findings.notes = {
    impax2026: {
      shareholderVotes: s26.length,
      against: s26.filter(r => r.vote === 'AGAINST').length,
      priorSupport: supportOf(R.filter(r => r.season !== '2026')).pct,
    },
    stanceCounts: Object.fromEntries(['pro-ESG', 'anti-ESG', 'unclear', 'governance'].map(s => [s, shAll.filter(r => r.stance === s).length])),
    classifier: {
      distinctTexts: new Set(shAll.map(r => r.proposal)).size,
      noRuleVotes: gov.filter(r => r.rule === 'no rule matched').length,
      governanceVotes: gov.length,
    },
  };
}

fs.writeFileSync(path.join(ROOT, 'data', 'findings.json'), JSON.stringify(findings, null, 2));

// Console summary for a quick check.
console.log('headline', findings.headline);
console.log('robustness (pooled vs S&P 500 meetings):', findings.robustness);
findings.siblings.pairs.forEach(p => console.log(`${p.a} vs ${p.b}: SH ${p.shShared} differ ${p.shDifferPct}% | all ${p.shared} differ ${p.differPct}%`));
console.log('reference', findings.siblings.reference);
findings.ballot.forEach(b => console.log('ballot', b.season, b.total, 'pro', b.pro, 'anti', b.anti, 'anti share', b.antiShareOfES));
findings.antiEsg.forEach(a => console.log('anti', a.group, a.antiSupport, 'pro', a.proSupport));
findings.governanceVsEsg.forEach(g => console.log('gov vs esg', g.group, 'pro', g.proEsg.pct, 'gov', g.governance.pct, 'rights', g.shareholderRights.pct));
findings.otherManagersByStyle.forEach(x => console.log('other managers', x.style, 'pro', x.proEsg.pct, 'gov', x.governance.pct, 'rights', x.shareholderRights.pct, x.shareholderRights.n));
console.log('impax', findings.notes.impax2026, 'classifier', findings.notes.classifier);
