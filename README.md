# Proxy Voting Panel

How the Big Three index managers, two large active managers, and six
ESG-branded fund families vote their shares at company meetings, built from
the SEC's structured Form N-PX proxy voting records.

**Live site:** https://slriggss.github.io/proxy-voting-panel/
**Repository:** https://github.com/slriggss/proxy-voting-panel

The site has two pages: a report (`index.html`) with nine findings, each with
a chart, and a dashboard (`dashboard.html`) that filters all 301,734 votes in
the browser.

## Files

| File | What it does |
|---|---|
| `index.html` | The report: headline numbers, nine findings with charts, and a closing section on the data and methods. |
| `dashboard.html` | The dashboard: filter by fund family, fund label (conventional/ESG), management style (index/active), meeting quarter, proposal type, SEC topic, and company; switch the measure (% FOR, % with management, % against management, vote count) and the breakdown (group, family, fund, label); four summary numbers, four charts, and a vote table recompute live. Supports shareable filtered links, CSV export, and PNG export of any chart. |
| `css/style.css` | Shared styles for both pages (design carried over from the ESG Country Panel project): typography, dark/light themes, the scroll-driven backdrop, chart-card animations, and the filter controls. |
| `js/charts-common.js` | Shared Chart.js setup: colors and fonts, hover highlighting, data-driven chart annotations, the chart intro animations, and the card-opening effect. |
| `js/report.js` | Builds the report's charts from `data/findings.json`. |
| `js/dashboard.js` | All dashboard interactivity, working from `data/site_votes.json`. |
| `js/effects.js` | Fade-in on scroll and the scroll-driven backdrop glow. |
| `js/theme.js` | The light/dark toggle (dark by default). |
| `scripts/fetch_npx.js` | Pulls the N-PX filings for the 22 funds from SEC EDGAR, merges and cleans the vote records, and writes `data/votes.csv` plus the gzipped copy the repo stores. |
| `scripts/stance_rules.js` | Labels each shareholder proposal pro-ESG, anti-ESG, unclear, or governance, with the name of the rule that decided it. |
| `scripts/classify_proposals.js` | Writes `data/proposal_stance_review.csv` so every stance label can be reviewed. |
| `scripts/load_votes.js` | Shared loader used by the scripts below: reads the votes, adds stances, applies the one filing exclusion, and names companies consistently. |
| `scripts/analyze.js` | Computes every number on the report page into `data/findings.json`. |
| `scripts/build_site_data.js` | Writes `data/site_votes.json`, the compact column-by-column file the dashboard loads. |
| `data/votes.csv.gz` | The full data set, one row per fund per proposal (gzipped; the CSV is just over GitHub's 100 MB limit). |
| `data/findings.json` | The report's numbers. |
| `data/site_votes.json` | The dashboard's data. |
| `data/proposal_stance_review.csv` | Every distinct shareholder-proposal text with its stance and rule, for review. |

To rebuild everything (Node 18+):

```
node scripts/fetch_npx.js          # EDGAR -> data/votes.csv(.gz)   (about 2.3 GB of downloads the first time)
node scripts/classify_proposals.js # -> data/proposal_stance_review.csv
node scripts/analyze.js            # -> data/findings.json
node scripts/build_site_data.js    # -> data/site_votes.json
```

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
| Active managers | Fidelity | Fidelity 500 Index Fund; Fidelity Contrafund | Fidelity U.S. Sustainability Index Fund; Fidelity Sustainable U.S. Equity Fund |
| Active managers | Capital Group | The Growth Fund of America; Washington Mutual Investors Fund | - |
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
`data/proposal_stance_review.csv` lists all 2,184 distinct proposal texts.

**Rates.** Support is the share of votes cast FOR, out of FOR + AGAINST +
ABSTAIN + WITHHOLD. Opposition on management items (say-on-pay, directors) is
the share of those votes that were not FOR. Rates pool fund-level votes, so a
proposal voted by three funds counts three times. Head-to-head comparisons
match proposals by company (CUSIP), meeting date and proposal text.

**SEC access.** EDGAR asks automated clients to identify themselves and to stay
under 10 requests per second. The fetch script sends a User-Agent with a
contact address and paces its requests; if you re-run it, replace that address
with your own. Raw downloads are cached in `data/raw/`, which is not
committed.
