// Writes data/proposal_stance_review.csv: every distinct shareholder-proposal
// text in data/votes.csv with the stance scripts/stance_rules.js assigns it,
// the rule that fired, the SEC categories filers gave it, an example company,
// and how many fund votes it covers. Sorted by stance, then rule, then votes,
// so each group can be spot-checked.
//
//   node scripts/classify_proposals.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { stanceOf } = require('./stance_rules');

const ROOT = path.join(__dirname, '..');
const csvPath = path.join(ROOT, 'data', 'votes.csv');
const text = fs.existsSync(csvPath)
  ? fs.readFileSync(csvPath, 'utf8')
  : zlib.gunzipSync(fs.readFileSync(csvPath + '.gz')).toString('utf8');

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

const lines = text.split('\n').filter(Boolean);
const header = parseLine(lines[0]);
const col = name => header.indexOf(name);
const texts = new Map();
for (const line of lines.slice(1)) {
  const r = parseLine(line);
  if (r[col('proponent')] !== 'Shareholder') continue;
  const proposal = r[col('proposal')];
  const key = proposal.toLowerCase();
  let e = texts.get(key);
  if (!e) {
    e = { proposal, votes: 0, categories: new Set(), example: `${r[col('issuer')]} (${r[col('meeting_date')]})` };
    texts.set(key, e);
  }
  e.votes++;
  r[col('all_categories')].split(' | ').filter(Boolean).forEach(c => e.categories.add(c));
}

const ORDER = { 'anti-ESG': 0, unclear: 1, 'pro-ESG': 2, governance: 3 };
const rows = [...texts.values()].map(e => ({ ...e, ...stanceOf(e.proposal) }))
  .sort((a, b) => ORDER[a.stance] - ORDER[b.stance] || a.rule.localeCompare(b.rule) || b.votes - a.votes);

const cell = v => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const out = ['stance,rule,fund_votes,sec_categories,example,proposal']
  .concat(rows.map(e => [e.stance, e.rule, e.votes, [...e.categories].join(' | '), e.example, e.proposal].map(cell).join(',')));
fs.writeFileSync(path.join(ROOT, 'data', 'proposal_stance_review.csv'), out.join('\n') + '\n');

const tally = {};
rows.forEach(e => { tally[e.stance] = tally[e.stance] || { texts: 0, votes: 0 }; tally[e.stance].texts++; tally[e.stance].votes += e.votes; });
console.log(`${rows.length} distinct shareholder-proposal texts -> data/proposal_stance_review.csv`);
Object.entries(tally).forEach(([s, t]) => console.log(`  ${s.padEnd(10)} ${String(t.texts).padStart(5)} texts  ${String(t.votes).padStart(6)} fund votes`));
