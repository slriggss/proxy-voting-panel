# Proxy Voting Panel

How the Big Three index managers, two large active managers, and a set of
ESG-branded fund families vote their shares at company meetings, built from
the SEC's structured Form N-PX proxy voting records.

Work in progress: the data pipeline is in place; the report and dashboard
are next.

## Files

| File | What it does |
|---|---|
| `scripts/fetch_npx.js` | Pulls the N-PX filings for the 22 funds below from SEC EDGAR, merges and cleans the vote records, and writes `data/votes.csv` plus the gzipped copy the repo stores. Run with `node scripts/fetch_npx.js` (Node 18+). |
| `data/votes.csv.gz` | The data set (gzipped CSV, one row per fund per proposal). The uncompressed file is just over GitHub's 100 MB limit, so only the gzipped copy is committed. |

## Data

**Source.** SEC EDGAR, Form N-PX (annual report of proxy voting record), in the
structured XML format the SEC requires for votes cast on or after July 1, 2023.
Each filing covers one July 1 - June 30 reporting year; the data set covers the
2024, 2025 and 2026 reporting years (meetings from July 2023 through June 2026).

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

**What one row is.** One fund's vote on one proposal at one company meeting:
303,589 rows across 12 quarters (2023-Q3 to 2026-Q2), 2,074 companies. Columns:
`season` (reporting year), `quarter` (calendar quarter of the meeting, the time
column), `meeting_date`, `group`, `family`, `fund`, `series_id`, `style`
(Index/Active), `label` (Conventional/ESG), `issuer`, `cusip`, `isin`,
`proposal`, `proponent` (Management/Shareholder), `category` (the first SEC
vote category), `all_categories`, `vote`, `mgmt_rec`, `with_mgmt`,
`split_vote`, `shares_voted`, `shares_for`, `shares_against` (against +
withhold), `shares_on_loan`, `accession` (source filing).

**How the raw records are cleaned** (all in `scripts/fetch_npx.js`):

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
- *With or against management.* `with_mgmt` compares `vote` with the
  management recommendation filed with it; it is blank when no recommendation
  was given.

EDGAR asks automated clients to identify themselves and to stay under 10
requests per second. The fetch script sends a User-Agent with a contact
address and paces its requests; if you re-run it, replace that address with
your own. Raw downloads (about 2.3 GB) are cached in `data/raw/`, which is
not committed.
