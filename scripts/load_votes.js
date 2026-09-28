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

function loadVotes() {
  const csv = path.join(ROOT, 'data', 'votes.csv');
  const text = fs.existsSync(csv)
    ? fs.readFileSync(csv, 'utf8')
    : zlib.gunzipSync(fs.readFileSync(csv + '.gz')).toString('utf8');
  const lines = text.split('\n').filter(Boolean);
  const header = parseLine(lines[0]);
  const stanceCache = new Map();
  return lines.slice(1).map(line => {
    const cells = parseLine(line);
    const r = {};
    header.forEach((h, i) => { r[h] = cells[i]; });
    r.cast = CAST.has(r.vote);
    if (r.proponent === 'Shareholder') {
      if (!stanceCache.has(r.proposal)) stanceCache.set(r.proposal, stanceOf(r.proposal).stance);
      r.stance = stanceCache.get(r.proposal);
    } else {
      r.stance = 'management';
    }
    return r;
  });
}

module.exports = { loadVotes, ROOT };
