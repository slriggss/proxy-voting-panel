# Proxy Voting Panel

How the Big Three index managers, two large active managers, and six
ESG-branded fund families vote their shares at company meetings, built from
the SEC's structured Form N-PX proxy voting records.

**Live site:** https://slriggss.github.io/proxy-voting-panel/
**Repository:** https://github.com/slriggss/proxy-voting-panel

The site has three pages: a report (`index.html`) with nine findings, each with
a chart; a dashboard (`dashboard.html`) that filters all 301,734 votes in the
browser, starting from seven preset questions; and a head-to-head page
(`compare.html`) that pairs any two funds' votes on the same proposals.

## Files

| File | What it does |
|---|---|
| `index.template.html` | The source of the report: a limits box, nine findings with charts, and a closing section on the data and methods. Every number and fund name in the prose is a `{{token}}` here. **Edit this file, not `index.html`.** |
| `index.html` | The report as served. Generated from `index.template.html` and `data/findings.json` by `scripts/build_report.js`. |
| `dashboard.html` | The dashboard: start from a preset question or filter by fund family, fund label (conventional/ESG), management style (index/active), meeting quarter, proposal type, SEC topic, company, and words in the proposal text; switch the measure (% FOR, % with management, % against management, vote count), the breakdown (group, family, fund, label), and the time unit (proxy season or meeting quarter); four summary numbers, four charts, and a sortable vote table recompute live. Supports shareable filtered links, CSV export, and PNG export of any chart. By default it shows pro-ESG shareholder proposals, because the all-votes view sits near 90% FOR and hides the differences. |
| `compare.html` | Head-to-head: pick two funds and a proposal type; the page pairs their votes on the same proposal at the same meeting, shows how often they differ, the share voted FOR by proposal type, and every disagreement. Shareable links and CSV export. |
| `css/style.css` | Shared styles for both pages (design carried over from the ESG Country Panel project): typography, dark/light themes, the scroll-driven backdrop, chart-card animations, and the filter controls. |
| `js/charts-common.js` | Shared Chart.js setup: colors and fonts, hover highlighting, data-driven chart annotations, the chart intro animations, and the card-opening effect. |
| `js/report.js` | Builds the report's charts from `data/findings.json`. Tooltips show vote counts and 95% intervals; points built on fewer than 30 votes are drawn hollow. |
| `js/dashboard.js` | All dashboard interactivity, working from `data/site_votes.json`. |
| `js/compare.js` | The head-to-head page, working from `data/site_votes.json`. |
| `js/effects.js` | Fade-in on scroll and the scroll-driven backdrop glow. |
| `js/theme.js` | The light/dark toggle (dark by default). Switching happens in place: the page's charts are redrawn with the new colors, with no reload. |
| `favicon.svg`, `assets/` | The site icon and the link-preview image (`assets/og-image.png`, generated from `assets/og-image.html`). |
| `scripts/fetch_npx.js` | Pulls the N-PX filings for the 22 funds from SEC EDGAR, merges and cleans the vote records, and writes `data/votes.csv` plus the gzipped copy the repo stores. |
| `scripts/stance_rules.js` | Labels each shareholder proposal pro-ESG, anti-ESG, unclear, or governance, with the name of the rule that decided it. |
| `scripts/classify_proposals.js` | Writes `data/proposal_stance_review.csv` so every stance label can be reviewed. |
| `scripts/load_votes.js` | Shared loader used by the scripts below: reads the votes, adds stances, applies the one filing exclusion, and names companies consistently. |
| `scripts/analyze.js` | Computes every number on the report page into `data/findings.json`, with vote counts and 95% Wilson intervals, the S&P 500-meetings check, and the within-topic check. |
| `scripts/build_report.js` | Fills the `{{tokens}}` in `index.template.html` from `data/findings.json` and writes `index.html`. It also checks the report's verbal claims (for example, "supported none of them") against the data and refuses to build if one is no longer true. |
| `scripts/build_site_data.js` | Writes `data/site_votes.json`, the compact column-by-column file the dashboard and compare page load. Also assigns each row a match id so the same proposal worded slightly differently by two filers can be paired. |
| `scripts/make_audit_sample.js` | Draws a seeded random sample of 150 proposal texts (stratified by stance) into `data/stance_audit_sample.csv` for a hand audit of the stance rules. |
| `scripts/score_audit.js` | Reads the labels you filled into that CSV and writes `data/audit_result.json` (agreement overall and by stance). The report shows the result once the file exists. |
| `data/votes.csv.gz` | The full data set, one row per fund per proposal (gzipped; the CSV is just over GitHub's 100 MB limit). |
| `data/findings.json` | The report's numbers. |
| `data/site_votes.json` | The dashboard's data. |
| `data/proposal_stance_review.csv` | Every distinct shareholder-proposal text with its stance and rule, for review. |

To rebuild everything (Node 18+):

```
node scripts/fetch_npx.js          # EDGAR -> data/votes.csv(.gz)   (about 2.3 GB of downloads the first time)
node scripts/classify_proposals.js # -> data/proposal_stance_review.csv
node scripts/analyze.js            # -> data/findings.json
node scripts/build_report.js       # index.template.html + findings -> index.html
node scripts/build_site_data.js    # -> data/site_votes.json
```

To audit the stance rules by hand (recommended before quoting the pro-ESG /
anti-ESG figures): run `node scripts/make_audit_sample.js`, fill the
`your_label` column of `data/stance_audit_sample.csv` (pro-ESG, anti-ESG,
unclear, or governance), run `node scripts/score_audit.js`, then re-run
`node scripts/build_report.js`. Until then the report says the labels have not
been checked against a hand-labeled sample.

The site is static; serve the folder with any local web server
(for example `npx serve .`) and open the printed address.

## Data

**Source.** SEC EDGAR, Form N-PX (annual report of proxy voting record), in the
structured XML format the SEC requires for votes cast on or after July 1, 2023.
Each filing covers one July 1 - June 30 reporting year; the data set covers the
years ending June 2024, 2025 and 2026 (meetings from July 2023 through June 2026).

**Funds (22).** U.S. large-cap stock funds, so they vote at largely the same
companies:

| Group | Family | Flagship | ESG-labeled |
|---|---|---|---|
| Big Three | Vanguard | Vanguard 500 Index Fund | Vanguard ESG U.S. Stock ETF; Vanguard FTSE Social Index Fund |
| Big Three | BlackRock | iShares Core S&P 500 ETF | iShares ESG Aware MSCI USA ETF; iShares ESG Screened S&P 500 ETF; iShares Paris-Aligned Climate MSCI USA ETF |
| Big Three | State Street | SPDR Portfolio S&P 500 ETF | SPDR S&P 500 ESG ETF; SPDR MSCI USA Gender Diversity Index ETF |
| Other large managers | Fidelity | Fidelity 500 Index Fund; Fidelity Contrafund | Fidelity U.S. Sustainability Index Fund; Fidelity Sustainable U.S. Equity Fund |
| Other large managers | Capital Group | The Growth Fund of America; Washington Mutual Investors Fund | - |

"Other large managers" was called "Active managers" in `data/votes.csv.gz`
(and in earlier versions of the site), but it includes two Fidelity index funds,
so `scripts/load_votes.js` renames it on load; use the `style` column (Index /
Active) when the difference matters, as the report does.
| ESG families | Parnassus, Calvert (2), Domini, Impax, Green Century | - | Parnassus Core Equity; Calvert US Large-Cap Core Responsible Index; Calvert Equity; Domini Impact Equity; Impax US Sustainable Economy; Green Century Equity |

**What one row is.** One fund's vote on one proposal at one company meeting.
`data/votes.csv` has 303,589 rows; the analysis and dashboard use 301,734 of
them (one filing is excluded, below), covering 2,015 companies and 12 quarters
(2023-Q3 to 2026-Q2). Columns: `season` (reporting year), `quarter` (calendar
quarter of the meeting, the time column), `meeting_date`, `group`, `family`,
`fund`, `series_id`, `style` (Index/Active), `label` (Conventional/ESG),
`issuer`, `cusip`, `isin`, `proposal`, `proponent` (Management/Shareholder),
`category` (the first SEC vote category), `all_categories`, `vote`, `vs_mgmt`
(whether the vote was FOR or AGAINST management, as filed), `with_mgmt` (Y/N),
`split_vote`, `shares_voted`, `shares_for`, `shares_against` (against +
withhold), `shares_on_loan`, `accession` (source filing).

**How the raw records are cleaned** (`scripts/fetch_npx.js`):

- *Which filing.* For each trust and reporting year, the newest N-PX or
  N-PX/A that contains a vote table for the fund is used.
- *One proposal, several blocks.* Some filers (iShares from 2025, Vanguard
  from 2026) report each voting entity's shares in a separate block. Blocks
  for the same fund, company, meeting and proposal are merged into one row,
  adding up shares by position; a block that exactly repeats another (same
  positions and shares, listed under a second voting manager) is counted once.
- *Pass-through votes.* Vanguard, BlackRock and State Street let some
  investors choose their own voting policy, and those shares can appear as
  small separate blocks, often with different wording of the same proposal.
  The data set is about each fund manager's own decision, so at each meeting
  any block voting less than 10% of the fund's largest block is left out
  (115,481 blocks). Outside Vanguard and iShares this removes about two dozen
  rows a year, such as a 158-share lot voted on the dissident card in
  Norfolk Southern's 2024 proxy contest.
- *One vote per row.* When a fund's shares were split across positions, `vote`
  is the position with the most shares (ignoring "take no action"), and
  `split_vote` is Y. Spellings are normalized (e.g. `ONE YEAR`, `1 YEAR` and
  `1.0` all become `1 YEAR`).
- *With or against management.* Despite its name, the N-PX
  `managementRecommendation` element records whether the vote was cast FOR or
  AGAINST management's recommendation, not the recommendation itself. Every
  filing here marks votes against directors (whom management always
  recommends) AGAINST, and funds' AGAINST votes on shareholder proposals
  (which management usually opposes) FOR. The column is therefore named
  `vs_mgmt`, and `with_mgmt` is Y when it is FOR.

**Excluded filing.** Impax's 2025-26 report (accession 0001398344-26-016225,
1,855 rows) is left out of the analysis and dashboard (`scripts/load_votes.js`),
though its rows stay in `data/votes.csv`. Its vote column shows FOR on every
management item and AGAINST on 142 of 143 shareholder proposals, which is
management's usual position everywhere, while the same filing's
for/against-management field marks 114 director votes as against management
(Impax voted against 124 and 136 management items in the two prior years).
The fields contradict each other, which suggests the vote column holds
management's recommendations, so the filing is excluded rather than
reinterpreted.

**Proposal direction** (`scripts/stance_rules.js`). The SEC categories say what
a proposal is about but not which way it points: "report on the effectiveness
of DEI efforts" and "report on the risks created by DEI efforts" share a
category but come from opposite camps. Each shareholder proposal is labeled by
ordered keyword rules: anti-ESG first (their wording reuses ESG vocabulary),
then topics filed by both camps (unclear, e.g. charitable giving), then
pro-ESG, then governance/other. Every label records the rule that produced it;
`data/proposal_stance_review.csv` lists every distinct proposal text. The rules have not been
validated against a hand-labeled sample until the audit above is run. Proposals
no rule recognizes are counted as governance (about a fifth of that group's
votes), so the report shows the Capital Group finding both ways. Fixes from
reviewing the rules: the cleaning step used to delete everything after "if
properly presented", which dropped the topic when it came first (31 votes
changed); most keyword rules now match on word boundaries (a "heat" rule was
matching "sheathed"); and pay tied to ESG goals and "living income" asks are now
labeled pro-ESG.

**Rates.** Support is the share of votes cast FOR, out of FOR + AGAINST +
ABSTAIN + WITHHOLD. Opposition on management items (say-on-pay, directors) is
the share of those votes that were not FOR. Rates pool fund-level votes, so a
proposal voted by three funds counts three times. Every rate in `data/findings.json`
carries its vote count and a 95% Wilson interval; the interval treats votes as
independent, which they are not (funds in one family vote alike), so it is a floor
on the uncertainty. Head-to-head comparisons in the report match proposals by
company (CUSIP), meeting date, and exact proposal text; the compare page uses
match ids that also pair proposals worded slightly differently.

**Same-ballot check.** An "S&P 500 meeting" is a company meeting at which at least
3 of the 4 S&P 500 index flagships voted. `scripts/analyze.js` recomputes each
fund's rates on those meetings only, so differences between funds can be told
apart from differences in which companies they hold.

**SEC access.** EDGAR asks automated clients to identify themselves and to stay
under 10 requests per second. The fetch script sends a User-Agent with a
contact address and paces its requests; if you re-run it, replace that address
with your own. Raw downloads are cached in `data/raw/`, which is not
committed.
