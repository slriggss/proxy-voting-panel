// Pulls SEC Form N-PX proxy voting records for the 22 funds in FUNDS and
// writes data/votes.csv (and a gzipped copy, data/votes.csv.gz, which is what
// the repo stores): one row per fund per proposal voted.
//
//   node scripts/fetch_npx.js
//
// Steps:
//   1. For each trust (CIK) that files one of our funds, list its N-PX and
//      N-PX/A filings from EDGAR's submissions API.
//   2. Keep filings for the 2024, 2025 and 2026 reporting periods (each covers
//      July 1 - June 30). When a trust filed an amendment for a period, the
//      latest filing that contains a vote table wins.
//   3. Download each vote table once (cached in data/raw/, which is not
//      committed) and keep only rows for our funds' series IDs.
//
// EDGAR asks automated clients to identify themselves and to stay under
// 10 requests per second. Replace SEC_USER_AGENT with your own name and
// email if you re-run this.

const fs = require('fs');
const path = require('path');

const SEC_USER_AGENT = 'Shelby Riggs sriggsco@gmail.com';
const PERIODS = { '2024-06-30': 2024, '2025-06-30': 2025, '2026-06-30': 2026 };
const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');

// group: Big Three / Active managers / ESG families
// style: Index or Active; label: Conventional or ESG
const FUNDS = [
  { id: 'S000002839', cik: 36405,   family: 'Vanguard',      group: 'Big Three',       style: 'Index',  label: 'Conventional', fund: 'Vanguard 500 Index Fund' },
  { id: 'S000063075', cik: 52848,   family: 'Vanguard',      group: 'Big Three',       style: 'Index',  label: 'ESG',          fund: 'Vanguard ESG U.S. Stock ETF' },
  { id: 'S000004440', cik: 52848,   family: 'Vanguard',      group: 'Big Three',       style: 'Index',  label: 'ESG',          fund: 'Vanguard FTSE Social Index Fund' },
  { id: 'S000004310', cik: 1100663, family: 'BlackRock',     group: 'Big Three',       style: 'Index',  label: 'Conventional', fund: 'iShares Core S&P 500 ETF' },
  { id: 'S000055381', cik: 1100663, family: 'BlackRock',     group: 'Big Three',       style: 'Index',  label: 'ESG',          fund: 'iShares ESG Aware MSCI USA ETF' },
  { id: 'S000069532', cik: 1100663, family: 'BlackRock',     group: 'Big Three',       style: 'Index',  label: 'ESG',          fund: 'iShares ESG Screened S&P 500 ETF' },
  { id: 'S000074757', cik: 1100663, family: 'BlackRock',     group: 'Big Three',       style: 'Index',  label: 'ESG',          fund: 'iShares Paris-Aligned Climate MSCI USA ETF' },
  { id: 'S000006983', cik: 1064642, family: 'State Street',  group: 'Big Three',       style: 'Index',  label: 'Conventional', fund: 'SPDR Portfolio S&P 500 ETF' },
  { id: 'S000069051', cik: 1064642, family: 'State Street',  group: 'Big Three',       style: 'Index',  label: 'ESG',          fund: 'SPDR S&P 500 ESG ETF' },
  { id: 'S000053058', cik: 1064642, family: 'State Street',  group: 'Big Three',       style: 'Index',  label: 'ESG',          fund: 'SPDR MSCI USA Gender Diversity Index ETF' },
  { id: 'S000006027', cik: 819118,  family: 'Fidelity',      group: 'Active managers', style: 'Index',  label: 'Conventional', fund: 'Fidelity 500 Index Fund' },
  { id: 'S000006037', cik: 24238,   family: 'Fidelity',      group: 'Active managers', style: 'Active', label: 'Conventional', fund: 'Fidelity Contrafund' },
  { id: 'S000057366', cik: 35315,   family: 'Fidelity',      group: 'Active managers', style: 'Index',  label: 'ESG',          fund: 'Fidelity U.S. Sustainability Index Fund' },
  { id: 'S000072129', cik: 225322,  family: 'Fidelity',      group: 'Active managers', style: 'Active', label: 'ESG',          fund: 'Fidelity Sustainable U.S. Equity Fund' },
  { id: 'S000009228', cik: 44201,   family: 'Capital Group', group: 'Active managers', style: 'Active', label: 'Conventional', fund: 'The Growth Fund of America' },
  { id: 'S000009388', cik: 104865,  family: 'Capital Group', group: 'Active managers', style: 'Active', label: 'Conventional', fund: 'Washington Mutual Investors Fund' },
  { id: 'S000000856', cik: 866256,  family: 'Parnassus',     group: 'ESG families',    style: 'Active', label: 'ESG',          fund: 'Parnassus Core Equity Fund' },
  { id: 'S000005145', cik: 1105446, family: 'Calvert',       group: 'ESG families',    style: 'Index',  label: 'ESG',          fund: 'Calvert US Large-Cap Core Responsible Index Fund' },
  { id: 'S000008719', cik: 356682,  family: 'Calvert',       group: 'ESG families',    style: 'Active', label: 'ESG',          fund: 'Calvert Equity Fund' },
  { id: 'S000003423', cik: 851680,  family: 'Domini',        group: 'ESG families',    style: 'Active', label: 'ESG',          fund: 'Domini Impact Equity Fund' },
  { id: 'S000015763', cik: 76721,   family: 'Impax',         group: 'ESG families',    style: 'Active', label: 'ESG',          fund: 'Impax US Sustainable Economy Fund' },
  { id: 'S000007715', cik: 877232,  family: 'Green Century', group: 'ESG families',    style: 'Active', label: 'ESG',          fund: 'Green Century Equity Fund' },
];
const FUND_BY_ID = new Map(FUNDS.map(f => [f.id, f]));

const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastRequest = 0;
async function secGet(url, type = 'text') {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const wait = lastRequest + 150 - Date.now(); // well under 10 requests/second
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    try {
      const r = await fetch(url, { headers: { 'User-Agent': SEC_USER_AGENT }, signal: AbortSignal.timeout(120000) });
      if (r.status === 404) return null;
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return type === 'json' ? await r.json() : await r.text();
    } catch (err) {
      if (attempt === 5) throw err;
      await sleep(2000 * attempt);
    }
  }
}

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`));
  return m ? m[1].trim() : '';
};
const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

// 1-2. Find the filing to use for each trust + period.
async function findFilings() {
  const chosen = [];
  for (const cik of [...new Set(FUNDS.map(f => f.cik))]) {
    const sub = await secGet(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`, 'json');
    const pages = [sub.filings.recent];
    for (const extra of sub.filings.files || []) {
      pages.push(await secGet(`https://data.sec.gov/submissions/${extra.name}`, 'json'));
    }
    const candidates = [];
    for (const p of pages) {
      p.form.forEach((form, i) => {
        if ((form === 'N-PX' || form === 'N-PX/A') && PERIODS[p.reportDate[i]]) {
          candidates.push({ cik, form, acc: p.accessionNumber[i], filed: p.filingDate[i], period: p.reportDate[i] });
        }
      });
    }
    // Newest first, so an amendment beats the original for the same series.
    candidates.sort((a, b) => b.filed.localeCompare(a.filed) || b.acc.localeCompare(a.acc));
    const covered = new Set(); // `${seriesId}|${period}`
    for (const c of candidates) {
      const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${c.acc.replace(/-/g, '')}`;
      const primary = await secGet(`${base}/primary_doc.xml`);
      if (!primary || !/FUND VOTING REPORT/.test(primary)) continue;
      const seriesInFiling = [...primary.matchAll(/<idOfSeries>([^<]*)</g)].map(m => m[1].trim());
      const ours = FUNDS.filter(f => f.cik === cik && seriesInFiling.includes(f.id) && !covered.has(`${f.id}|${c.period}`));
      if (!ours.length) continue;
      const index = await secGet(`${base}/index.json`, 'json');
      const table = index && index.directory.item.find(i => /\.xml$/i.test(i.name) && !/primary_doc/i.test(i.name));
      if (!table) { console.log(`  no vote table in ${c.form} ${c.acc} (${c.period}); trying older filings`); continue; }
      ours.forEach(f => covered.add(`${f.id}|${c.period}`));
      chosen.push({ ...c, url: `${base}/${table.name}`, file: `${cik}-${c.acc}.xml`, series: ours.map(f => f.id), seriesInFiling });
    }
    for (const f of FUNDS.filter(x => x.cik === cik)) {
      for (const period of Object.keys(PERIODS)) {
        if (!covered.has(`${f.id}|${period}`)) console.log(`  MISSING: ${f.fund}, period ending ${period}`);
      }
    }
  }
  return chosen;
}

// Filers spell the same position several ways ("ONE YEAR", "1 YEAR", "1.0";
// "Takenoaction", "TAKE NO ACTION"); map them onto one vocabulary.
function normalizeVote(v) {
  const s = v.toUpperCase().replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (/^TAKE ?NO ?ACTION$/.test(s)) return 'TAKE NO ACTION';
  if (/^(ONE YEAR|1 YEARS?|1(\.0)?)$/.test(s)) return '1 YEAR';
  if (/^(TWO YEARS|2 YEARS?|2(\.0)?)$/.test(s)) return '2 YEARS';
  if (/^(THREE YEARS|3 YEARS?|3(\.0)?)$/.test(s)) return '3 YEARS';
  return s;
}
const NOT_A_POSITION = new Set(['TAKE NO ACTION', 'UNDETERMINED', '']);

// 3. Parse a vote table, keeping only our funds' rows.
//
// One proposal can span several <proxyTable> blocks for the same fund: some
// filers (iShares from 2025, Vanguard from 2026) report each voting entity's
// shares separately -- different stewardship teams, or investors directing
// their own shares. Blocks are merged into one row per fund x company x
// meeting x proposal, adding up shares by position.
//
// Some filers also report pass-through votes -- shares whose investors chose
// their own voting policy -- as small separate blocks, often with a vendor's
// different wording of the same proposal. Those slices are not the fund
// manager's decision, so any block voting under PASS_THROUGH_SHARE of the
// fund's largest block at that meeting is left out (and counted).
const PASS_THROUGH_SHARE = 0.10;
const stats = { passThroughBlocks: 0, duplicateBlocks: 0 };

function parseTable(xml, filing, onRow) {
  const onlyOne = filing.seriesInFiling.length === 1 ? filing.seriesInFiling[0] : null;
  let unattributed = 0;

  // Pass 1: collect our funds' blocks, grouped by fund x company x meeting.
  const meetings = new Map();
  const re = /<(?:\w+:)?proxyTable>([\s\S]*?)<\/(?:\w+:)?proxyTable>/g;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    // A row lists the series that cast it; single-fund filings may omit it.
    let series = [...block.matchAll(/<(?:\w+:)?voteSeries>([^<]*)</g)].map(x => x[1].trim());
    if (!series.length) { if (onlyOne) series = [onlyOne]; else { unattributed++; continue; } }
    series = series.filter(s => filing.series.includes(s));
    if (!series.length) continue;

    const records = [...block.matchAll(/<(?:\w+:)?voteRecord>([\s\S]*?)<\/(?:\w+:)?voteRecord>/g)].map(r => ({
      how: normalizeVote(tag(r[1], 'howVoted')),
      shares: Number(tag(r[1], 'sharesVoted')) || 0,
      mgmt: normalizeVote(tag(r[1], 'managementRecommendation')),
    }));
    if (!records.length) continue;
    const shares = records.reduce((t, r) => t + r.shares, 0);
    // Issuer names vary in case between blocks, so key on CUSIP (or ISIN/name).
    const company = tag(block, 'cusip') || tag(block, 'isin') || tag(block, 'issuerName').toLowerCase();
    for (const s of series) {
      const k = [s, company, tag(block, 'meetingDate')].join('|');
      if (!meetings.has(k)) meetings.set(k, []);
      meetings.get(k).push({ series: s, block, records, shares });
    }
  }

  // Pass 2: drop pass-through slices, then merge blocks for the same proposal.
  const merged = new Map();
  for (const [k, blocks] of meetings) {
    const biggest = Math.max(...blocks.map(b => b.shares));
    for (const b of blocks) {
      if (biggest > 0 && b.shares < PASS_THROUGH_SHARE * biggest) { stats.passThroughBlocks++; continue; }
      const proposal = decode(tag(b.block, 'voteDescription')).replace(/\s+/g, ' ').trim();
      const key = `${k}|${proposal.toLowerCase()}`;
      let row = merged.get(key);
      if (!row) {
        const categories = [...b.block.matchAll(/<(?:\w+:)?categoryType>([^<]*)</g)].map(x => decode(x[1].trim()));
        row = { series: b.series, block: b.block, meeting: tag(b.block, 'meetingDate'), proposal, categories, records: [], seen: new Set(), loan: 0 };
        merged.set(key, row);
      }
      // The same vote is sometimes repeated under a second voting manager
      // with identical positions and shares; count it once.
      const sig = b.records.map(r => `${r.how}:${r.shares}`).sort().join(',');
      if (row.seen.has(sig)) { stats.duplicateBlocks++; continue; }
      row.seen.add(sig);
      row.records.push(...b.records);
      row.loan += Number(tag(b.block, 'sharesOnLoan')) || 0;
    }
  }

  for (const row of merged.values()) {
    const f = FUND_BY_ID.get(row.series);
    const block = row.block;
    const sharesBy = new Map();
    row.records.forEach(r => sharesBy.set(r.how, (sharesBy.get(r.how) || 0) + r.shares));
    // Main vote: the position with the most shares, ignoring "take no action"
    // unless nothing else was cast.
    const positions = [...sharesBy.entries()].sort((a, b) => b[1] - a[1]);
    const main = (positions.find(([how]) => !NOT_A_POSITION.has(how)) || positions[0])[0];
    // Despite its name, the N-PX <managementRecommendation> element records
    // whether the vote was FOR or AGAINST management's recommendation, not the
    // recommendation itself: every filing here marks votes against directors
    // AGAINST (management always recommends FOR its nominees) and funds'
    // AGAINST votes on shareholder proposals FOR. Take the flag that goes with
    // the main position.
    const vsMgmt = (row.records.find(r => r.how === main && !NOT_A_POSITION.has(r.mgmt)) ||
                    row.records.find(r => !NOT_A_POSITION.has(r.mgmt)) || { mgmt: 'NONE' }).mgmt;
    const [mm, dd, yyyy] = row.meeting.split('/');
    const source = tag(block, 'voteSource').toUpperCase();
    const castPositions = positions.filter(([how]) => !NOT_A_POSITION.has(how));
    onRow({
      season: PERIODS[filing.period],
      quarter: `${yyyy}-Q${Math.ceil(Number(mm) / 3)}`,
      meeting_date: `${yyyy}-${mm}-${dd}`,
      group: f.group,
      family: f.family,
      fund: f.fund,
      series_id: row.series,
      style: f.style,
      label: f.label,
      issuer: decode(tag(block, 'issuerName')),
      cusip: tag(block, 'cusip'),
      isin: tag(block, 'isin'),
      proposal: row.proposal,
      proponent: source === 'SECURITY HOLDER' ? 'Shareholder' : source === 'ISSUER' ? 'Management' : (source || 'Unknown'),
      category: row.categories[0] || 'UNCATEGORIZED',
      all_categories: row.categories.join(' | '),
      vote: main,
      vs_mgmt: vsMgmt,
      with_mgmt: NOT_A_POSITION.has(main) ? '' : vsMgmt === 'FOR' ? 'Y' : vsMgmt === 'AGAINST' ? 'N' : '',
      split_vote: castPositions.length > 1 ? 'Y' : 'N',
      shares_voted: row.records.reduce((t, r) => t + r.shares, 0),
      shares_for: sharesBy.get('FOR') || 0,
      shares_against: (sharesBy.get('AGAINST') || 0) + (sharesBy.get('WITHHOLD') || 0),
      shares_on_loan: row.loan,
      accession: filing.acc,
    });
  }
  return unattributed;
}

const COLUMNS = ['season', 'quarter', 'meeting_date', 'group', 'family', 'fund', 'series_id', 'style', 'label',
  'issuer', 'cusip', 'isin', 'proposal', 'proponent', 'category', 'all_categories', 'vote', 'vs_mgmt',
  'with_mgmt', 'split_vote', 'shares_voted', 'shares_for', 'shares_against', 'shares_on_loan', 'accession'];
const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

(async () => {
  fs.mkdirSync(RAW, { recursive: true });
  console.log('Finding filings...');
  const filings = await findFilings();
  console.log(`Using ${filings.length} filings.`);

  const out = fs.createWriteStream(path.join(ROOT, 'data', 'votes.csv'));
  out.write(COLUMNS.join(',') + '\n');
  const counts = {};
  for (const [i, f] of filings.entries()) {
    const cached = path.join(RAW, f.file);
    if (!fs.existsSync(cached)) {
      process.stdout.write(`[${i + 1}/${filings.length}] downloading ${f.form} ${f.acc} (${f.period})... `);
      const xml = await secGet(f.url);
      fs.writeFileSync(cached, xml);
      console.log(`${(xml.length / 1e6).toFixed(0)} MB`);
    }
    const xml = fs.readFileSync(cached, 'utf8');
    const unattributed = parseTable(xml, f, row => {
      out.write(COLUMNS.map(c => csvCell(row[c])).join(',') + '\n');
      const k = `${row.fund} | ${row.season}`;
      counts[k] = (counts[k] || 0) + 1;
    });
    if (unattributed) console.log(`  note: ${unattributed} rows in ${f.acc} had no fund series and were skipped`);
  }
  out.end();
  await new Promise(r => out.on('finish', r));
  // The CSV is just over GitHub's 100 MB file limit, so the repo keeps a gzipped copy.
  fs.writeFileSync(path.join(ROOT, 'data', 'votes.csv.gz'), require('zlib').gzipSync(fs.readFileSync(path.join(ROOT, 'data', 'votes.csv')), { level: 9 }));
  console.log('\nRows per fund and season:');
  Object.keys(counts).sort().forEach(k => console.log(`  ${k}: ${counts[k].toLocaleString()}`));
  console.log(`Total: ${Object.values(counts).reduce((a, b) => a + b, 0).toLocaleString()} rows -> data/votes.csv (+ votes.csv.gz)`);
  console.log(`Left out: ${stats.passThroughBlocks.toLocaleString()} pass-through blocks, ` +
    `${stats.duplicateBlocks.toLocaleString()} repeated blocks.`);
})().catch(err => { console.error(err); process.exit(1); });
