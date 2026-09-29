// Scores the hand audit of the stance rules.
//
//   node scripts/score_audit.js
//
// Reads data/stance_audit_sample.csv (after you have filled in `your_label`),
// compares your labels with the rules' labels, and writes data/audit_result.json.
// Rows with an empty or unrecognized `your_label` are left out and counted as
// unlabeled. The report's methodology section reports this result once the
// file exists (run scripts/build_report.js afterwards).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const lines = fs.readFileSync(path.join(ROOT, 'data', 'stance_audit_sample.csv'), 'utf8').split('\n').filter(Boolean);

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

const VALID = new Set(['pro-ESG', 'anti-ESG', 'unclear', 'governance']);
const rows = lines.slice(1).map(parseLine).map(f => ({ id: f[0], rules: f[1], rule: f[2], votes: Number(f[3]), proposal: f[5], yours: (f[6] || '').trim(), notes: f[7] }));
const labeled = rows.filter(r => VALID.has(r.yours));
if (!labeled.length) { console.error('No rows have a valid your_label yet (pro-ESG, anti-ESG, unclear, or governance).'); process.exit(1); }

const by = {};
for (const r of labeled) {
  const b = (by[r.rules] = by[r.rules] || { n: 0, agree: 0 });
  b.n++; if (r.rules === r.yours) b.agree++;
}
const agree = labeled.filter(r => r.rules === r.yours).length;
// How were the disagreements labeled? (rules' label -> your label)
const confusion = {};
labeled.filter(r => r.rules !== r.yours).forEach(r => { const k = `${r.rules} -> ${r.yours}`; confusion[k] = (confusion[k] || 0) + 1; });

const result = {
  sampled: rows.length,
  labeled: labeled.length,
  unlabeled: rows.length - labeled.length,
  agree,
  agreementPct: Math.round(1000 * agree / labeled.length) / 10,
  byRulesLabel: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { ...v, pct: Math.round(1000 * v.agree / v.n) / 10 }])),
  disagreements: confusion,
  disagreementRows: labeled.filter(r => r.rules !== r.yours).map(r => ({ id: r.id, rules: r.rules, rule: r.rule, yours: r.yours, notes: r.notes, proposal: r.proposal })),
};
fs.writeFileSync(path.join(ROOT, 'data', 'audit_result.json'), JSON.stringify(result, null, 2));
console.log(`Agreement: ${agree} of ${labeled.length} (${result.agreementPct}%).`);
Object.entries(result.byRulesLabel).forEach(([k, v]) => console.log(`  rules said ${k}: ${v.agree}/${v.n} (${v.pct}%)`));
if (Object.keys(confusion).length) console.log('Disagreements:', confusion);
console.log('Wrote data/audit_result.json');
