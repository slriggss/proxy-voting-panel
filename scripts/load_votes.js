// Shared loader: reads data/votes.csv (or the committed .gz copy) into row
// objects, adds each shareholder proposal's stance, and exposes the helpers
// the analysis and site-data scripts both use.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { stanceOf } = require('./stance_rules');

const ROOT = path.join(__dirname, '..');

function parseLine(line) {
  const out = []; let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Votes that are an actual position (excludes "take no action", "undetermined").
const CAST = new Set(['FOR', 'AGAINST', 'ABSTAIN', 'WITHHOLD', '1 YEAR', '2 YEARS', '3 YEARS']);

// Filings left out of the analysis and dashboard (the rows stay in votes.csv).
//
// Impax, 2025-26 (accession 0001398344-26-016225): the vote column appears to
// hold management's recommendation rather than the fund's vote. It shows FOR
// on all 1,704 management items and AGAINST on 142 of 143 shareholder
// proposals -- management's usual position on every item -- while the same
// filing's for/against-management flag marks 114 director votes as AGAINST
// management (Impax voted against 124 and 136 management items in the two
// prior years). Read through that flag, Impax supported roughly 60% of
// shareholder proposals, in line with earlier years, not the ~1% the vote
// column implies. Because the two fields contradict each other, the filing is
// excluded rather than reinterpreted.
const EXCLUDED_FILINGS = new Set(['0001398344-26-016225']);

function loadVotes() {
  const csv = path.join(ROOT, 'data', 'votes.csv');
  const text = fs.existsSync(csv)
    ? fs.readFileSync(csv, 'utf8')
    : zlib.gunzipSync(fs.readFileSync(csv + '.gz')).toString('utf8');
  const lines = text.split('\n').filter(Boolean);
  const header = parseLine(lines[0]);
  const stanceCache = new Map();
  // data/votes.csv.gz was written before this group was renamed; the name below is the one the site uses.
  const GROUP_RENAMES = { 'Active managers': 'Other large managers' };
  const accession = header.indexOf('accession');
  return lines.slice(1).filter(line => !EXCLUDED_FILINGS.has(parseLine(line)[accession])).map(line => {
    const cells = parseLine(line);
    const r = {};
    header.forEach((h, i) => { r[h] = cells[i]; });
    r.group = GROUP_RENAMES[r.group] || r.group;
    r.cast = CAST.has(r.vote);
    if (r.proponent === 'Shareholder') {
      if (!stanceCache.has(r.proposal)) stanceCache.set(r.proposal, stanceOf(r.proposal));
      r.stance = stanceCache.get(r.proposal).stance;
      r.rule = stanceCache.get(r.proposal).rule;
    } else {
      r.stance = 'management';
      r.rule = '';
    }
    return r;
  });
}

// One display name per company: the most common spelling of the issuer name for
// its CUSIP (or ISIN/name when CUSIP is missing). Share classes of the same
// company (e.g. Alphabet A and C) share a name, so they count as one company.
function companyNames(rows) {
  const counts = new Map();
  for (const r of rows) {
    const id = r.cusip || r.isin || r.issuer;
    if (!counts.has(id)) counts.set(id, new Map());
    const m = counts.get(id);
    m.set(r.issuer, (m.get(r.issuer) || 0) + 1);
  }
  const byId = new Map([...counts].map(([id, m]) => [id, [...m].sort((a, b) => b[1] - a[1])[0][0]]));
  return r => byId.get(r.cusip || r.isin || r.issuer);
}

module.exports = { loadVotes, companyNames, ROOT, EXCLUDED_FILINGS };
