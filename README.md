# Proxy Voting Panel

How the largest U.S. fund families and a set of ESG-branded fund families
vote their shares at company annual meetings, built from the SEC's
structured Form N-PX proxy voting records.

Work in progress.

## Data

- **Source:** SEC EDGAR, Form N-PX (annual report of proxy voting record),
  in the structured XML format the SEC requires for votes cast on or after
  July 1, 2023.
- **Time column:** calendar quarter of the shareholder meeting.
- **Fund families:** BlackRock/iShares, Vanguard, State Street/SPDR,
  Fidelity, Capital Group (American Funds), Parnassus, Calvert, Domini,
  Impax (Pax), Trillium, Green Century.

EDGAR asks automated clients to identify themselves; the fetch script sends
a User-Agent with a contact address. If you re-run it, replace that with
your own.
