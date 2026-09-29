// Draws a random sample of shareholder-proposal texts for a hand audit of the
// stance rules, and writes data/stance_audit_sample.csv.
//
//   node scripts/make_audit_sample.js        (after scripts/classify_proposals.js)
//
// How to use it: open the CSV, read each proposal text, and fill in
// `your_label` with what YOU think the proposal is: pro-ESG, anti-ESG,
// unclear, or governance. Leave `notes` for anything odd. Then run
//
//   node scripts/score_audit.js
//
// which compares your labels with the rules' labels and writes
// data/audit_result.json (agreement overall and by stance). The report's
// methodology section shows that result once the file exists.
//
// The sample is stratified so each stance is checked: it takes a fixed
// number of texts from each, plus extra from proposals no rule matched.
// The draw is seeded, so re-running gives the same sample.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const lines = fs.readFileSync(path.join(ROOT, 'data', 'proposal_stance_review.csv'), 'utf8').split('\n').filter(Boolean);

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
const cell = v => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

const all = lines.slice(1).map(l => {
  const [stance, rule, votes, categories, example, proposal] = parseLine(l);
  return { stance, rule, votes: Number(votes), categories, example, proposal };
});

// Small seeded generator (mulberry32) so the sample is reproducible.
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(20260929);
function draw(pool, n) {
  const a = pool.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

const strata = [
  ['anti-ESG', r => r.stance === 'anti-ESG', 30],
  ['unclear', r => r.stance === 'unclear', 15],
  ['pro-ESG', r => r.stance === 'pro-ESG', 45],
  ['governance (a rule matched)', r => r.stance === 'governance' && r.rule !== 'no rule matched', 30],
  ['governance (no rule matched)', r => r.stance === 'governance' && r.rule === 'no rule matched', 30],
];
const sample = strata.flatMap(([, test, n]) => draw(all.filter(test), n));
const shuffled = draw(sample, sample.length); // mix the strata so the reader isn't primed

const out = ['id,rules_label,rule,votes,sec_categories,proposal,your_label,notes']
  .concat(shuffled.map((r, i) => [i + 1, r.stance, r.rule, r.votes, r.categories, r.proposal, '', ''].map(cell).join(',')));
fs.writeFileSync(path.join(ROOT, 'data', 'stance_audit_sample.csv'), out.join('\n') + '\n');
console.log(`Wrote data/stance_audit_sample.csv with ${shuffled.length} proposal texts (` + strata.map(([name, , n]) => `${n} ${name}`).join(', ') + ').');
