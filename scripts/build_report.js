// Builds index.html from index.template.html and data/findings.json.
// Every number and fund name in the report's prose is a {{token}} in the
// template, filled in here from findings.json, so re-running the analysis and
// then this script keeps the text and the charts in agreement.
//
// Claims the prose makes in words ("supported none of them", "fell in every
// year", "the smallest footprint") are checked against the data below; if the
// data stops supporting one, this script fails instead of publishing a false
// sentence.
//
// Run with: node scripts/build_report.js   (after scripts/analyze.js)

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const F = JSON.parse(fs.readFileSync(path.join(root, 'data', 'findings.json'), 'utf8'));
const template = fs.readFileSync(path.join(root, 'index.template.html'), 'utf8');
const reviewRows = fs.readFileSync(path.join(root, 'data', 'proposal_stance_review.csv'), 'utf8').split('\n').filter(Boolean).length - 1;
const auditFile = path.join(root, 'data', 'audit_result.json');
const audit = fs.existsSync(auditFile) ? JSON.parse(fs.readFileSync(auditFile, 'utf8')) : null;

// --- helpers -----------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fx = (n, d = 1) => Number(n).toFixed(d);
const int = (n) => Number(n).toLocaleString('en-US');
function check(cond, message) { if (!cond) throw new Error('Report claim no longer supported by the data: ' + message); }

const SEASONS = ['2024', '2025', '2026'];
const IDS = {
  van500: 'Vanguard 500 Index Fund', vanesg: 'Vanguard ESG U.S. Stock ETF', vansoc: 'Vanguard FTSE Social Index Fund',
  ishcore: 'iShares Core S&P 500 ETF', ishaware: 'iShares ESG Aware MSCI USA ETF', ishscreen: 'iShares ESG Screened S&P 500 ETF', ishparis: 'iShares Paris-Aligned Climate MSCI USA ETF',
  spdrport: 'SPDR Portfolio S&P 500 ETF', spdresg: 'SPDR S&P 500 ESG ETF', spdrgender: 'SPDR MSCI USA Gender Diversity Index ETF',
  fid500: 'Fidelity 500 Index Fund', fidcontra: 'Fidelity Contrafund', fidsust: 'Fidelity U.S. Sustainability Index Fund', fidsusteq: 'Fidelity Sustainable U.S. Equity Fund',
  gfa: 'The Growth Fund of America', wami: 'Washington Mutual Investors Fund',
  parn: 'Parnassus Core Equity Fund', calidx: 'Calvert US Large-Cap Core Responsible Index Fund', caleq: 'Calvert Equity Fund',
  dom: 'Domini Impact Equity Fund', impax: 'Impax US Sustainable Economy Fund', gc: 'Green Century Equity Fund',
};
const pro = {}, pay = {};
for (const [id, name] of Object.entries(IDS)) {
  pro[id] = F.proEsgByFund.find(x => x.fund === name);
  pay[id] = F.payAndBoards.find(x => x.fund === name);
  check(pro[id] && pay[id], `fund ${name} missing from findings`);
}

const v = {};
const putShare = (prefix, s, d = 1) => {
  v[`${prefix}`] = fx(s.pct, d); v[`${prefix}.n`] = int(s.n); v[`${prefix}.k`] = int(s.k);
  v[`${prefix}.lo`] = fx(s.lo, d); v[`${prefix}.hi`] = fx(s.hi, d);
};

// Headline
v['head.votes'] = int(F.headline.votes); v['head.funds'] = int(F.headline.funds); v['head.families'] = int(F.headline.families);
v['head.companies'] = int(F.headline.companies); v['head.quarters'] = int(F.headline.quarters);
v['head.firstQuarter'] = F.headline.firstQuarter; v['head.lastQuarter'] = F.headline.lastQuarter;
v['head.sh'] = int(F.headline.shareholderVotes); v['head.spm'] = int(F.headline.sp500Meetings);

// 1. Siblings
{
  const S = F.siblings.pairs;
  const pair = (a, b) => S.find(p => p.a === IDS[a] && p.b === IDS[b]);
  const map = { vanesg: ['van500', 'vanesg'], vansoc: ['van500', 'vansoc'], ishaware: ['ishcore', 'ishaware'], ishscreen: ['ishcore', 'ishscreen'], ishparis: ['ishcore', 'ishparis'], spdresg: ['spdrport', 'spdresg'], spdrgender: ['spdrport', 'spdrgender'], fidsust: ['fid500', 'fidsust'], fidsusteq: ['fidcontra', 'fidsusteq'] };
  for (const [id, [a, b]] of Object.entries(map)) {
    const p = pair(a, b); check(p, `sibling pair ${a}/${b}`);
    v[`sib.${id}`] = fx(p.shDifferPct); v[`sib.${id}.n`] = int(p.shShared); v[`sib.${id}.lo`] = fx(p.shLo); v[`sib.${id}.hi`] = fx(p.shHi);
  }
  const r = F.siblings.reference;
  v['ref'] = fx(r.shDifferPct); v['ref.n'] = int(r.shShared); v['ref.lo'] = fx(r.shLo); v['ref.hi'] = fx(r.shHi);
  for (const id of ['vanesg', 'vansoc', 'ishaware', 'ishscreen', 'spdresg', 'spdrgender', 'fidsust']) check(Number(v[`sib.${id}`]) < 1, `${id} should differ from its flagship on under 1% of proposals`);
  check(pair('ishcore', 'ishparis').shDifferPct > 2 && pair('fidcontra', 'fidsusteq').shDifferPct > 4, 'the two exceptions should stand out');
  check(r.shDifferPct > 50, 'the Calvert reference should differ on most proposals');
}

// 2. Pro-ESG support by fund
for (const id of Object.keys(IDS)) {
  putShare(`p.${id}`, pro[id].all);
  v[`p.${id}.m`] = fx(pro[id].matched.pct); v[`p.${id}.m.n`] = int(pro[id].matched.n);
  SEASONS.forEach((s, i) => { const x = pro[id].bySeason[s]; v[`p.${id}.s${i}`] = x.pct == null ? 'n/a' : fx(x.pct); v[`p.${id}.s${i}.n`] = int(x.n); });
}
v['robust.max'] = fx(F.robustness.maxMatchedDiff);
{
  const p = id => pro[id].all.pct;
  check(['van500', 'vanesg', 'vansoc'].every(id => pro[id].all.k === 0), 'Vanguard funds should have supported none of the pro-ESG proposals');
  check(['ishcore', 'ishaware', 'ishscreen'].every(id => p(id) > 1.5 && p(id) < 2.5), 'iShares funds should be about 2%');
  check(['spdrport', 'spdresg', 'spdrgender'].every(id => p(id) >= 9 && p(id) < 11), 'SPDR funds should be 9-11%');
  check(p('fid500') < 3 && p('fidsust') < 3, 'Fidelity index funds should be under 3%');
  const all = Object.keys(IDS);
  const top = all.slice().sort((a, b) => p(b) - p(a));
  check(top[0] === 'calidx' && p('calidx') > 79 && p('dom') > 79 && p('gc') > 79, 'Calvert index, Domini, Green Century should be the top three near 80%');
  check(p('fidsusteq') > p('fidcontra') && p('fidcontra') > p('gfa'), 'Fidelity Sustainable > Contrafund > Growth Fund of America');
  check(F.robustness.maxMatchedDiff < 2.5, 'restricting to S&P 500 meetings should move no fund by 2.5+ points');
  check(pro.caleq.all.n < 100 && pro.parn.all.n <= 101, 'Calvert Equity and Parnassus are described as small samples');
}

// 3. Big Three by season
{
  const four = ['spdrport', 'fid500', 'ishcore', 'van500'];
  const ns = four.flatMap(id => SEASONS.map(s => pro[id].bySeason[s].n));
  v['bt.nmin'] = int(Math.min(...ns)); v['bt.nmax'] = int(Math.max(...ns));
  const s = pro.spdrport.bySeason;
  check(s['2024'].pct > s['2025'].pct && s['2025'].pct < s['2026'].pct, 'State Street flagship falls then edges up');
  check(pro.ishcore.bySeason['2024'].pct > pro.ishcore.bySeason['2026'].pct, 'iShares Core support should fall');
  check(pro.fid500.bySeason['2025'].pct === 0 && pro.fid500.bySeason['2026'].pct === 0, 'Fidelity 500 should be at zero in the last two years');
  check(SEASONS.every(x => pro.van500.bySeason[x].pct === 0), 'Vanguard 500 should be zero all three years');
}

// 4. Ballot
{
  const b = F.ballot;
  ['0', '1', '2'].forEach(i => { v[`bal.${i}.total`] = int(b[i].total); v[`bal.${i}.pro`] = int(b[i].pro); v[`bal.${i}.anti`] = int(b[i].anti); v[`bal.${i}.share`] = fx(b[i].antiShareOfES); });
  v['bal.drop'] = fx(100 * (1 - b[2].pro / b[0].pro), 0);
  check(b[2].pro < b[0].pro * 0.5 && b[2].anti > b[2].pro * 0 && b[2].antiShareOfES > b[0].antiShareOfES, 'pro-ESG proposals should fall by more than half while the anti-ESG share rises');
  check(b[0].anti - b[2].anti < 0.35 * b[0].anti, 'anti-ESG proposals should fall much less than pro-ESG');
}

// 5. Anti-ESG by group
{
  const A = F.antiEsg; const g = (n) => A.find(x => x.group === n);
  putShare('anti.big3', g('Big Three').antiSupport); putShare('anti.other', g('Other large managers').antiSupport); putShare('anti.esgf', g('ESG families').antiSupport);
  check(g('Big Three').antiSupport.k === 0 && g('Other large managers').antiSupport.k === 0, 'Big Three and other large managers should have supported no anti-ESG proposals');
  check(g('ESG families').antiSupport.pct > 0 && g('ESG families').antiSupport.pct < 6, 'ESG families give anti-ESG proposals a few percent');
}

// 6. ESG specialists
{
  const seas = (id, i) => pro[id].bySeason[SEASONS[i]];
  for (const id of ['calidx', 'dom', 'gc', 'parn', 'caleq', 'impax']) SEASONS.forEach((s, i) => { v[`sp.${id}.${i}`] = seas(id, i).pct == null ? 'n/a' : fx(seas(id, i).pct); v[`sp.${id}.${i}.n`] = int(seas(id, i).n); });
  v['sp.parn.2.lo'] = fx(seas('parn', 2).lo); v['sp.parn.2.hi'] = fx(seas('parn', 2).hi);
  v['sp.impax.lo'] = fx(Math.min(pro.impax.bySeason['2024'].pct, pro.impax.bySeason['2025'].pct), 0);
  v['sp.impax.hi'] = fx(Math.max(pro.impax.bySeason['2024'].pct, pro.impax.bySeason['2025'].pct), 0);
  for (const id of ['calidx', 'dom', 'gc']) check(seas(id, 0).pct > seas(id, 2).pct + 8, `${id} should be down by more than 8 points from 2023-24 to 2025-26`);
  check(seas('parn', 2).n < 30 && seas('caleq', 2).n < 30, 'Parnassus and Calvert Equity 2025-26 are described as too few votes to read');
  check(seas('impax', 2).n === 0, 'Impax 2025-26 should be excluded');

  const T = F.topicSeason.find(x => x.group === 'ESG families');
  const topic = (needle) => T.topics.find(t => t.topic.startsWith(needle)).bySeason;
  const env = topic('ENVIRONMENT'), hr = topic('HUMAN RIGHTS'), dei = topic('DIVERSITY'), oth = topic('OTHER SOCIAL');
  const put = (k, o) => SEASONS.forEach((s, i) => { v[`ts.${k}.${i}`] = fx(o[s].pct); v[`ts.${k}.${i}.n`] = int(o[s].n); });
  put('env', env); put('hr', hr); put('dei', dei); put('oth', oth);
  SEASONS.forEach((s, i) => { v[`ts.all.${i}`] = fx(T.all[s].pct); v[`ts.sp.${i}`] = fx(T.atSp500[s].pct); v[`ts.sp.${i}.n`] = int(T.atSp500[s].n); });
  check(env['2025'].pct - env['2026'].pct > 10 && hr['2025'].pct - hr['2026'].pct > 8, 'ESG families should be down 2025->2026 on climate and human rights');
  check(oth['2026'].pct >= oth['2025'].pct - 2, 'ESG families\' "other social" support should not have fallen 2025->2026');
  check(dei['2026'].n < 30, 'the diversity 2025-26 figure is described as resting on very few votes');
}

// 7. Pay and boards
for (const id of Object.keys(IDS)) {
  v[`pay.${id}`] = fx(pay[id].sayOnPay.pct); v[`pay.${id}.m`] = fx(pay[id].sayOnPayMatched.pct);
  v[`dir.${id}`] = fx(pay[id].directors.pct); v[`dir.${id}.m`] = fx(pay[id].directorsMatched.pct);
}
{
  const big3 = ['van500', 'vanesg', 'vansoc', 'ishcore', 'ishaware', 'ishscreen', 'ishparis', 'spdrport', 'spdresg', 'spdrgender'];
  const maxPay = Math.max(...big3.map(id => pay[id].sayOnPay.pct)), maxDir = Math.max(...big3.map(id => pay[id].directors.pct));
  v['pay.big3max'] = fx(maxPay); v['dir.big3max'] = fx(maxDir);
  const fidMax = Math.max(...['fid500', 'fidcontra', 'fidsust', 'fidsusteq'].map(id => Math.max(pay[id].sayOnPay.pct, pay[id].directors.pct)));
  v['fid.max'] = fx(fidMax);
  check(pay.dom.sayOnPay.pct > pay.calidx.sayOnPay.pct && pay.calidx.sayOnPay.pct > 60 && pay.gc.sayOnPay.pct > 60, 'Domini > Calvert index, Green Century, all above 60% on say-on-pay');
  check(pay.dom.directors.pct > 50 && pay.gc.directors.pct > 50, 'Domini and Green Century should oppose over half of director nominees');
  check(pay.parn.sayOnPay.pct < 20 && pay.parn.directors.pct < 15 && pay.impax.sayOnPay.pct < 20 && pay.impax.directors.pct < 10, 'Parnassus and Impax are described as much lower');
  check(pay.gfa.sayOnPay.pct > 15 && pay.gfa.directors.pct < 2, 'Growth Fund of America opposes pay often but directors rarely');
  check(maxPay < 5 && maxDir < 5.5, 'every Big Three fund should be at 5% or less on pay and directors');
  check(fidMax < 5, 'Fidelity\'s funds should look like the Big Three (under 5%)');
  check(pay.gfa.sayOnPay.pct - pay.gfa.sayOnPayMatched.pct > 4, 'the Growth Fund figure should differ by more than 4 points at S&P 500 meetings');
}

// 8. Governance vs pro-ESG
{
  const G = F.governanceVsEsg; const g = n => G.find(x => x.group === n);
  const b3 = g('Big Three'), es = g('ESG families');
  putShare('gv.big3.pro', b3.proEsg); putShare('gv.big3.rights', b3.shareholderRights); putShare('gv.esgf.pro', es.proEsg); putShare('gv.esgf.rights', es.shareholderRights);
  v['gv.big3.ratio'] = fx(b3.shareholderRights.pct / b3.proEsg.pct, 0);
  const idx = F.otherManagersByStyle.find(x => x.style === 'Index'), act = F.otherManagersByStyle.find(x => x.style === 'Active');
  putShare('gv.idx.pro', idx.proEsg); putShare('gv.idx.rights', idx.shareholderRights);
  putShare('gv.act.pro', act.proEsg); putShare('gv.act.rights', act.shareholderRights);
  check(b3.shareholderRights.pct / b3.proEsg.pct > 8 && b3.shareholderRights.pct / b3.proEsg.pct < 12, '"nearly ten times"');
  check(idx.shareholderRights.pct > 50 && act.shareholderRights.pct > 50 && idx.proEsg.pct < 5 && act.proEsg.pct < 15, 'other large managers back shareholder-rights proposals far more than pro-ESG ones');
  check(idx.shareholderRights.n < 100 && act.shareholderRights.n < 100, 'the two other-manager shareholder-rights figures are described as small samples');
  check(Math.abs(es.proEsg.pct - es.shareholderRights.pct) < 15, 'ESG families support both kinds at similar rates');
}

// 9. Capital Group
{
  const C = F.capitalGroup; const gfa = C.find(x => x.fund === IDS.gfa), wami = C.find(x => x.fund === IDS.wami);
  SEASONS.forEach((s, i) => {
    v[`cap.gfa.${i}`] = fx(gfa.governance[s].pct); v[`cap.gfa.${i}.r`] = fx(gfa.governanceRuled[s].pct);
    v[`cap.wami.${i}`] = fx(wami.governance[s].pct); v[`cap.wami.${i}.r`] = fx(wami.governanceRuled[s].pct);
  });
  const pros = [gfa, wami].flatMap(c => SEASONS.map(s => c.proEsg[s].pct));
  v['cap.pro.min'] = fx(Math.min(...pros), 0); v['cap.pro.max'] = fx(Math.max(...pros), 0);
  check(gfa.governance['2026'].pct > gfa.governance['2025'].pct + 10 && wami.governance['2026'].pct > wami.governance['2025'].pct + 10, 'both Capital Group funds up more than 10 points in 2025-26');
  check(gfa.governanceRuled['2026'].pct > gfa.governanceRuled['2025'].pct + 10 && wami.governanceRuled['2026'].pct > wami.governanceRuled['2025'].pct + 5, 'the shift should hold on rule-identified governance proposals');
  check(Math.min(...pros) >= 1 && Math.max(...pros) <= 6, 'Capital Group pro-ESG support should stay between 1% and 6%');
}

// Impax note, classifier, audit
{
  const n = F.notes;
  v['impax.prior'] = fx(n.impax2026.priorSupport, 0);
  v['cls.texts'] = int(reviewRows);
  v['cls.norule.pct'] = fx(100 * n.classifier.noRuleVotes / n.classifier.governanceVotes, 0);
  v['cls.norule'] = int(n.classifier.noRuleVotes); v['cls.gov'] = int(n.classifier.governanceVotes);
  v['audit.sentence'] = audit
    ? `In a hand audit of ${audit.labeled} randomly drawn proposal texts, the rules&rsquo; label matched the author&rsquo;s own label on ${audit.agreementPct}% (${audit.agree} of ${audit.labeled}); the sample, labels, and disagreements are in <code>data/stance_audit_sample.csv</code> and <code>data/audit_result.json</code>.`
    : `These labels come from keyword rules and have not yet been checked against a hand-labeled sample; <code>scripts/make_audit_sample.js</code> draws one for that purpose.`;
}

// --- fill the template -------------------------------------------------------
const used = new Set();
const html = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key) => {
  if (!(key in v)) throw new Error(`Template token {{${key}}} has no value in scripts/build_report.js`);
  used.add(key);
  return v[key];
});

const banner = '<!-- GENERATED FILE: edit index.template.html and run `node scripts/build_report.js`. -->\n';
fs.writeFileSync(path.join(root, 'index.html'), html.replace('<!doctype html>', '<!doctype html>\n' + banner));
console.log(`Wrote index.html (${used.size} tokens filled).`);
