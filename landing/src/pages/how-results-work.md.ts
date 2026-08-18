import type { APIRoute } from "astro";

export const GET: APIRoute = () => {
  const body = `---
title: How NZ Accredited Employer Inspector results work
description: Agent-readable explanation of official employer data, platform associations, community confirmations, candidate selection, freshness, notices, and interpretation limits.
language: en-NZ
version: 0.9.0
last_updated: 2026-08-18
canonical: https://nzaei.zemo.bio/how-results-work/
human_readable: https://nzaei.zemo.bio/how-results-work/
---

# How NZ Accredited Employer Inspector results work

## Core interpretation rule

Every positive result contains two independent claims:

1. **Official accreditation claim:** a particular legal employer record, identified by NZBN, appears in official Immigration New Zealand data with the displayed accreditation expiry.
2. **Platform identity claim:** the LinkedIn or SEEK page being viewed corresponds to that legal employer record.

The official accreditation claim and the platform identity claim must not be conflated. Immigration New Zealand is authoritative for accreditation facts. It does not supply the page-to-employer association used by this product.

## Data sources

### Official employer records

Immigration New Zealand (INZ), part of the Ministry of Business, Innovation and Employment (MBIE), is the source of employer name, optional trading name, NZBN, and accreditation expiry.

The service receives official data through:

- a validated MBIE official bulk snapshot; and
- user-triggered live lookups of INZ's public accredited-employer service.

The official bulk import checks the expected spreadsheet structure, snapshot date, row count, field formats, and duplicate NZBNs. The complete source is staged before canonical employer records are updated. A partial import cannot partially activate. A newer live observation is not overwritten by an older bulk snapshot.

The live response parser requires valid employer names, a 13-digit NZBN, a valid accreditation expiry, consistent pagination totals, no duplicate NZBN within a page, and no more than 50 results on one page. Invalid payloads are rejected.

### Platform identity

The extension reads the public employer or advertiser display name and a public platform identifier from a supported LinkedIn or SEEK page. It does not use the person's LinkedIn or SEEK account identity.

A LinkedIn company slug or SEEK company profile path is a strong platform identity. Some SEEK job ads provide only an advertiser name. That is a weak identity because unrelated advertisers can use similar normalised names.

### Community confirmations

A platform association maps one public LinkedIn or SEEK identity to one official NZBN. Associations are created by extension users and are community data, not INZ data.

The extension generates a random installation UUID. The API hashes it before persisting a confirmation. One installation has one active choice per platform identity. Selecting a different employer replaces that installation's previous choice.

The installation's own choice wins for that installation. Without a self choice, a unique highest community confirmation count wins. If the highest counts are tied, no employer is selected automatically. Conflicting NZBN choices set the association as disputed.

Confirmation counts describe page-to-employer selections only. They do not vote on, create, extend, or verify accreditation.

## Resolution order

The service resolves a result in this order:

1. Use the current installation's saved association, if one exists.
2. Otherwise use a unique community winner, if one exists.
3. Otherwise auto-select only when the normalised platform display name exactly equals one NZBN's official employer name or trading name. An immediate live result additionally requires INZ to report exactly one total result.
4. Otherwise return explicit candidates from a live INZ response, duplicated exact names, or community confirmations and require user confirmation.
5. If there are no positive candidates, reuse a fresh exact no-match observation for this platform identity and display-name query.
6. Otherwise permit one user-triggered live INZ name lookup.

Positive official data takes precedence over a prior no-match observation. A stored platform association takes precedence over an automatic exact-name match.

## Exact-name rule

Automatic selection is intentionally narrow. It requires equality between the platform display name and exactly one NZBN's official INZ employer name or trading name after only:

- Unicode NFKC normalisation;
- trimming outer whitespace;
- collapsing repeated whitespace; and
- lowercasing.

The rule does not remove punctuation or company suffixes. If the same exact name belongs to multiple NZBNs, the service does not auto-select an employer. Containment, shared keywords, abbreviations, and approximate character similarity do not produce automatic candidates. For an immediate live lookup, INZ must also report exactly one total result. An automatic exact-name match is derived on every resolution, is not stored as an association, and does not increase community confirmation counts.

## Meaning of multiple employer results

Multiple results are separate official employer records, normally with different NZBNs. They are not necessarily duplicates and do not mean one company holds several accreditations. Multiple candidates can come from a live INZ lookup, duplicated exact official/trading names, or competing community confirmations.

The user should compare legal name and NZBN with the job ad, employment agreement, employer website, or information from the employer. Name similarity alone is not treated as evidence that two records describe the same employer.

## Meaning of “Use this employer”

Selecting **Use this employer**:

- associates the current public LinkedIn or SEEK identity with the selected official NZBN;
- makes that employer the selected result for the current browser installation;
- contributes one anonymous community confirmation; and
- replaces that installation's earlier choice for the same platform identity, if present.

It does not modify official INZ data, prove that the association is correct, contact the employer, submit a job application, or send the selection to LinkedIn or SEEK.

## Notice dictionary

### Match and community notices

- **Platform association:** A stored user-created mapping connects this platform identity to an official NZBN. The mapping is not an INZ fact.
- **Your confirmed association:** This browser installation previously selected the displayed NZBN for this platform identity. Its self choice has precedence for this installation.
- **N community confirmation(s):** N distinct hashed installation identifiers currently select this NZBN for the same platform identity. This is matching context, not official verification.
- **Community confirmations are tied:** Two or more NZBNs share the highest confirmation count. No community winner is selected.
- **Other users selected a different NZBN:** At least one confirmation for this platform identity points to an alternative NZBN. The association is disputed.
- **Based on advertiser name:** The association uses a weak normalised SEEK advertiser-name identity instead of a stronger company profile identity.
- **Automatic exact INZ name match:** The official employer name or trading name of exactly one NZBN equals the platform display name under the narrow normalisation rule.
- **Not community-confirmed:** The automatic exact-name result did not create or use a community association.

### Result and freshness notices

- **Accredited in NZ:** The selected official record's expiry date has not passed on the Pacific/Auckland calendar date. This does not determine eligibility for a particular role or visa.
- **Accreditation expired:** The selected official record's expiry date has passed on the Pacific/Auckland calendar date.
- **Confirm employer match:** Positive candidates exist, but none can be selected safely.
- **No published INZ match:** A recognised INZ lookup returned no result for this exact platform identity and normalised display-name query. This is not proof of non-accreditation.
- **Live verification needs review:** A stale selected NZBN was not confirmed by the latest INZ response. The older dated record remains visible as context and is not treated as newly verified.
- **Live INZ:** The displayed response followed a live user-triggered INZ lookup.
- **Shared data:** The official record was reused from the service's canonical dataset. This label describes delivery, not a different accreditation authority.
- **Recent INZ check:** A still-fresh exact no-match observation is being reused.
- **Recent INZ attempt:** Another user-triggered refresh is temporarily suppressed by the per-employer cooldown.
- **INZ data verified [date]:** The date the service accepted the displayed official observation or official snapshot.

## Freshness and no-match handling

- The configured positive freshness window is currently 30 days for selected official records.
- When a selected record is older than the window or its stored expiry has passed, the extension requests a per-NZBN lease and performs at most one user-triggered lookup.
- A recognised NZBN no-result retains the dated record and suppresses another live call for 24 hours. Every displayed employer also offers a manual Refresh from INZ action using the same cooldown.
- The configured negative freshness window is currently seven days.
- A no-match observation is scoped to the exact platform identity and normalised display-name query.
- A changed display name, an expired observation, or later positive data prevents the old no-match from deciding the result.
- “No published INZ match” means only that the query returned no published result at the stated time. It must never be restated as “the employer is not accredited”.

## Reliability boundaries

- The product is independent open-source software, not an INZ or MBIE product.
- It does not provide legal or immigration advice.
- Accreditation of an employer does not by itself prove that a role or applicant meets visa requirements.
- Platform associations and community confirmations can be wrong.
- Official public data can change after the displayed verification date.
- A public browser client cannot cryptographically prove that a valid-looking submitted live payload originated from INZ. The current service validates payload structure and consistency but does not protect against a determined fabricator.

For consequential decisions, verify the legal employer name and NZBN with the employer and consult the [official INZ accredited employer list](https://www.immigration.govt.nz/work/requirements-for-work-visas/approved-employers/accredited-employer-list/).

## Stable related resources

- Human-readable guide: https://nzaei.zemo.bio/how-results-work/
- Product overview: https://nzaei.zemo.bio/index.md
- Privacy policy: https://nzaei.zemo.bio/privacy.md
- Full agent context: https://nzaei.zemo.bio/llms-full.txt
- OpenAPI: https://nzaei.zemo.bio/api/openapi.json
- Canonical technical contract: https://github.com/aizhimou/nz-accredited-employer-inspector/blob/main/docs/extension-api-ssot.md
`;

  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
