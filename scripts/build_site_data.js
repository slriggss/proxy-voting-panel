// Writes data/site_votes.json, the compact file the dashboard loads.
//
//   node scripts/build_site_data.js
//
// Same rows as data/votes.csv, stored column by column with repeated text
// (fund, company, proposal, category...) replaced by an index into a lookup
// list. That keeps all 300k+ votes loadable in a browser.

const fs = require('fs');
const path = require('path');
const { loadVotes, companyNames, ROOT } = require('./load_votes');
const { clean } = require('./stance_rules');

const rows = loadVotes();

const companyOf = companyNames(rows);

function dictionary() {
  const list = [], at = new Map();
  return { list, id(v) { if (!at.has(v)) { at.set(v, list.length); list.push(v); } return at.get(v); } };
}
// Match ids: rows for "the same proposal at the same meeting" share an id even
// when filers word it slightly differently (quote marks, stockholder vs
// shareholder, a dropped word). Within one company meeting, shareholder-
// proposal texts are clustered when their word sets overlap by at least 80%;
// management items must match exactly. The compare page joins on this id.
const norm = t => clean(t).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/s+/g, ' ').trim();
const meetings = new Map(); // "cusip|date" -> [{ tokens:Set, text, id }]
let nextMatch = 0;
function matchId(r) {
  const mk = (r.cusip || r.isin || r.issuer) + '|' + r.meeting_date;
  if (!meetings.has(mk)) meetings.set(mk, []);
  const clusters = meetings.get(mk);
  const text = norm(r.proposal), tokens = new Set(text.split(' '));
  const shareholder = r.proponent === 'Shareholder';
  for (const c of clusters) {
    if (c.shareholder !== shareholder) continue;
    if (c.text === text) return c.id;
    if (!shareholder) continue;
    let common = 0; for (const t of tokens) if (c.tokens.has(t)) common++;
    if (common / (tokens.size + c.tokens.size - common) >= 0.8) return c.id;
  }
  const id = nextMatch++;
  clusters.push({ tokens, text, id, shareholder });
  return id;
}

const dict = {
  quarter: dictionary(), date: dictionary(), fund: dictionary(), company: dictionary(),
  proposal: dictionary(), category: dictionary(), stance: dictionary(), vote: dictionary(), vsMgmt: dictionary(), rule: dictionary(),
};
// Fix the order of small lists so the dashboard can rely on it.
[...new Set(rows.map(r => r.quarter))].sort().forEach(q => dict.quarter.id(q));
['management', 'pro-ESG', 'anti-ESG', 'unclear', 'governance'].forEach(s => dict.stance.id(s));

const funds = [];
const cols = { q: [], d: [], f: [], c: [], p: [], cat: [], st: [], v: [], mr: [], sh: [], wm: [], m: [] };
const proposalRule = []; // rule index per proposal-dictionary entry
for (const r of rows) {
  const before = dict.fund.list.length;
  const f = dict.fund.id(r.fund);
  if (f === before) funds.push({ name: r.fund, family: r.family, group: r.group, style: r.style, label: r.label });
  cols.q.push(dict.quarter.id(r.quarter));
  cols.d.push(dict.date.id(r.meeting_date));
  cols.f.push(f);
  cols.c.push(dict.company.id(companyOf(r)));
  const before2 = dict.proposal.list.length;
  const pid = dict.proposal.id(r.proposal);
  if (pid === before2) proposalRule[pid] = dict.rule.id(r.rule || '');
  cols.p.push(pid);
  cols.m.push(matchId(r));
  cols.cat.push(dict.category.id(r.category));
  cols.st.push(dict.stance.id(r.stance));
  cols.v.push(dict.vote.id(r.vote));
  cols.mr.push(dict.vsMgmt.id(r.vs_mgmt));
  cols.sh.push(r.proponent === 'Shareholder' ? 1 : 0);
  cols.wm.push(r.with_mgmt === 'Y' ? 1 : r.with_mgmt === 'N' ? 0 : -1);
}

const out = {
  n: rows.length,
  funds,
  lists: Object.fromEntries(Object.entries(dict).filter(([k]) => k !== 'fund').map(([k, d]) => [k, d.list])),
  proposalRule,
  cols,
};
const file = path.join(ROOT, 'data', 'site_votes.json');
fs.writeFileSync(file, JSON.stringify(out));
const gz = require('zlib').gzipSync(fs.readFileSync(file)).length;
console.log(`${rows.length.toLocaleString()} rows -> data/site_votes.json (${(fs.statSync(file).size / 1e6).toFixed(1)} MB, ~${(gz / 1e6).toFixed(1)} MB gzipped over the wire)`);
console.log('lists:', Object.fromEntries(Object.entries(out.lists).map(([k, v]) => [k, v.length])));
