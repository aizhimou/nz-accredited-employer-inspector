export interface ChangeItem {
  title: string;
  detail: string;
}

export interface Release {
  version: string;
  date: string;
  isoDate: string;
  status?: "Current";
  headline: string;
  summary: string;
  changes: ChangeItem[];
}

export const releases: Release[] = [
  {
    version: "0.7.1",
    date: "16 August 2026",
    isoDate: "2026-08-16",
    status: "Current",
    headline: "A better way back when the first name does not match.",
    summary:
      "The Inspector now lets you search its local employer records by another legal or trading name, without changing the original page identity or making another live INZ request.",
    changes: [
      {
        title: "Manual employer search",
        detail:
          "Try another name from candidate and no-published-match views, then explicitly choose the right legal employer.",
      },
      {
        title: "More useful candidate ranking",
        detail:
          "Indexed token, prefix, abbreviation and acronym signals surface plausible official records while keeping fuzzy matches unselected.",
      },
      {
        title: "A read-only recovery path",
        detail:
          "Searching does not create an association, alter the page name or bypass an existing no-match observation.",
      },
      {
        title: "Expiry-aware live refresh",
        detail:
          "Expired stored records refresh on the next eligible check, with a per-employer cooldown and an explicit Refresh from INZ action.",
      },
    ],
  },
  {
    version: "0.6.1",
    date: "10 August 2026",
    isoDate: "2026-08-10",
    headline: "More control, clearer evidence.",
    summary:
      "This release made the extension easier to control and added a plain-language guide for interpreting every result.",
    changes: [
      {
        title: "Extension controls",
        detail:
          "A new popup shows the current site state, lets you pause or resume the Inspector, and opens a check on supported pages.",
      },
      {
        title: "Result interpretation guide",
        detail:
          "A dedicated guide separates official accreditation facts from page-to-employer matching evidence and community choices.",
      },
      {
        title: "Visible freshness rules",
        detail:
          "Positive employer records refresh after 30 days; exact no-result searches expire after seven days.",
      },
      {
        title: "LinkedIn layout fix",
        detail:
          "The result panel no longer clips inside narrow LinkedIn job detail panes.",
      },
    ],
  },
  {
    version: "0.6.0",
    date: "6 August 2026",
    isoDate: "2026-08-06",
    headline: "The first public release.",
    summary:
      "The Inspector reached the Chrome Web Store with supported LinkedIn and SEEK coverage, official employer data and public trust documentation.",
    changes: [
      {
        title: "LinkedIn and SEEK support",
        detail:
          "Check company profiles, direct job pages and common job-search detail panes without leaving the platform.",
      },
      {
        title: "Official employer dataset",
        detail:
          "Validated Immigration New Zealand snapshots and user-triggered live lookups feed the same canonical employer records.",
      },
      {
        title: "Conservative matching",
        detail:
          "Only one exact official legal-name candidate may be selected automatically; similar names and multiple candidates require a person.",
      },
      {
        title: "Public trust surface",
        detail:
          "Source code, the API contract, privacy policy and machine-readable product documentation became publicly reviewable.",
      },
    ],
  },
];
