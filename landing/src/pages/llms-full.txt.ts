import type { APIRoute } from "astro";

export const GET: APIRoute = () => {
  const body = `# NZ Accredited Employer Inspector — full agent context

## Identity

- Product: NZ Accredited Employer Inspector
- Type: Open-source Chrome extension plus Cloudflare Worker and D1 API
- Current service version: 0.8.0
- Primary audience: People assessing New Zealand job opportunities on LinkedIn and SEEK
- Primary task: Check whether the legal employer associated with a platform page appears on the Immigration New Zealand accredited employer list
- Creator and maintainer: Zemo Ai
- Author homepage: https://zemo.bio/
- Author source profile: https://github.com/aizhimou
- Repository: https://github.com/aizhimou/nz-accredited-employer-inspector
- Production API: https://nzaei.zemo.bio/api
- Public read-only API: https://nzaei.zemo.bio/api/public/v1
- Public API guide: https://nzaei.zemo.bio/public-api/
- Public OpenAPI: https://nzaei.zemo.bio/api/public/openapi.json
- Chrome Web Store: https://chromewebstore.google.com/detail/nz-accredited-employer-in/gjcifpaoplkboeefndngnglhjhldkbbg
- Privacy policy: https://nzaei.zemo.bio/privacy/
- Privacy policy as Markdown: https://nzaei.zemo.bio/privacy.md
- Plain-language result guide: https://nzaei.zemo.bio/how-results-work/
- Agent-readable result guide: https://nzaei.zemo.bio/how-results-work.md
- Public changelog: https://nzaei.zemo.bio/changelog/
- Changelog as Markdown: https://nzaei.zemo.bio/changelog.md
- Open data: https://nzaei.zemo.bio/open-data/
- Open data as Markdown: https://nzaei.zemo.bio/open-data.md
- Static snapshot catalog: https://data.nzaei.zemo.bio/catalog.json

The project is independently created and maintained by Zemo Ai in Auckland, New Zealand. The author homepage is the canonical identity page and links back to this product.

## Product behaviour

The extension inserts a compact **Check NZ accreditation** control into supported LinkedIn and SEEK pages. It waits for an explicit user click. It does not crawl lists, pre-warm searches, make automatic page-load lookups, or paginate INZ results automatically. One click may make at most one live request to INZ.

The result can show a selected employer, several candidates requiring confirmation, a fresh no-match observation, or a request to retry/review verification. The UI shows legal name, optional trading name, 13-digit NZBN, accreditation expiry, last verification time, status, and matching provenance.

Automatic resolution does not use fuzzy retrieval. It considers saved/community associations and exact normalised official or trading-name equality. A collapsed manual-search disclosure provides a separate FTS5 keyword search: every entered token must match the same official employer row, tokens of at least three characters support prefix matching, BM25 orders the results, and at most 10 are returned. Submitted recovery results replace the current candidate list and require an explicit user choice.

## Supported platform surfaces

- LinkedIn company profile routes and common company subpages
- LinkedIn direct job pages and job search detail panes
- SEEK NZ direct job pages, search-result detail panes, and homepage recommendations
- SEEK NZ company profiles and their standard subpages

LinkedIn company URLs and SEEK company profiles create strong identities. SEEK advertisers without a company profile use a weak, normalised advertiser-name identity and are labelled accordingly.

## Truth model

### Official accreditation facts

Immigration New Zealand is the source of truth for employer name, trading name, NZBN, accreditation expiry, and the underlying verification response. The Worker owns the acceptance timestamp and evaluates expiry using the Pacific/Auckland calendar date.

### Platform association

Mappings from a LinkedIn company or SEEK advertiser/profile to an NZBN are community confirmations. The extension installation's own selection wins for that installation. Otherwise a unique highest community confirmation count wins. A tie requires confirmation. Conflicting selections are visible as disputed.

### Automatic exact-name match

When no stored platform association is selected, the Worker may derive a match only if the normalised official INZ employer name or trading name of exactly one NZBN equals the normalised platform display name. Normalisation uses Unicode NFKC, trimmed and collapsed whitespace, and lowercase. Company suffixes and punctuation are not removed. A duplicated exact name requires confirmation; containment, token overlap, abbreviations, and approximate character similarity do not produce automatic candidates. The backward-compatible exact_employer_name method value covers both exact official and trading names.

### No published match

A recognised INZ no-results response is stored only for the exact platform identity and normalised display-name query. It expires after the configured negative TTL, currently seven days. It is evidence that the name query returned no published result, not evidence that the employer is unaccredited. Any positive employer candidate or association takes precedence.

## Resolution states

- **associated:** A selected employer exists, is inside the configured positive TTL, and its stored accreditation expiry has not passed.
- **refresh_required:** A selected employer is outside the 30-day TTL or its stored expiry has passed. The extension requests a per-NZBN refresh lease before making one INZ lookup.
- **confirmation_required:** One or more explicit official candidates exist from an exact-name ambiguity, community confirmation, or live result set, but no safe rule selects one.
- **no_published_inz_match:** No positive candidate exists and an exact no-match observation is inside the configured negative TTL, currently seven days.
- **inz_lookup_required:** No association, candidate, or fresh no-match exists. The extension may make one display-name lookup.

## Components and trust boundaries

- **Content script:** extracts platform identity, mounts Shadow DOM UI, renders candidates, and captures explicit user choices.
- **Extension background:** creates and stores a random installation UUID, calls the Worker, performs user-triggered INZ requests, recognises official no-result envelopes, and submits responses.
- **Cloudflare Worker:** validates requests, searches and upserts canonical employers, derives exact-name matches, aggregates community confirmations, evaluates configurable freshness/status, coordinates per-NZBN refresh cooldowns, stores exact no-match observations, and rate limits clients.
- **D1:** stores canonical employer records, refresh coordination metadata, platform entities, per-installation confirmations, no-match observation fields, and retained pre-release waitlist records.
- **INZ:** official lookup source. The Worker never calls INZ.

## Privacy and security characteristics

- Full privacy policy: https://nzaei.zemo.bio/privacy/
- The extension uses no LinkedIn or SEEK account identifier.
- The random installation UUID is hashed before a confirmation is persisted.
- Employer display name, public company identifier, and public company URL are sent to nzaei.zemo.bio only during a user-triggered lookup or confirmation.
- Data is used only for accreditation lookup, rate limiting, result provenance, and community confirmation; it is not sold or used for advertising.
- Requests to nzaei.zemo.bio and Immigration New Zealand use HTTPS.
- API requests have strict schema validation and a 128 KiB body limit.
- Application responses disable caching and include request IDs.
- The API rate limits general requests and submissions separately.
- Pre-release waitlist email addresses are normalized, deduplicated, and retained only for the disclosed one-time Chrome Web Store release notification.
- A public browser client cannot cryptographically prove that a submitted payload came from INZ. The current architecture is an MVP trust model, not protection against a determined payload fabricator.

## Public API summary

All POST routes require JSON. Employer routes require an X-Client-ID UUID header; the landing-page waitlist route does not.

- GET /health — public service health; no client ID required
- POST /v1/employers/resolve — read-only platform identity resolution
- POST /v1/employers/search — read-only local candidate recovery search using an independent query
- POST /v1/employers/ingest — validate and atomically store a positive INZ response
- POST /v1/employers/no-match — store a recognised display-name no-match or an authorized NZBN refresh no-result cooldown
- POST /v1/employers/refresh — authorize one automatic or manual per-NZBN INZ refresh without changing an association
- POST /v1/employers/associate — confirm or change this installation's platform-to-NZBN mapping
- POST /v1/waitlist — join the one-message Chrome Web Store release notification list

OpenAPI: /api/openapi.json
API catalog: /.well-known/api-catalog
Canonical API contract: https://github.com/aizhimou/nz-accredited-employer-inspector/blob/main/docs/extension-api-ssot.md

## Public read-only API

The separate public API is unauthenticated and accepts GET, HEAD, and OPTIONS only. It exposes no platform identities, association data, refresh controls, extension client identifiers, or write operations.

- GET /api/public/v1/employers/{nzbn} — exact 13-digit NZBN lookup
- GET /api/public/v1/employers/search?q={query}&limit={1..10} — bounded FTS employer/trading-name search

Successful lookup responses use a data envelope. Search responses add meta.query and meta.count; error responses include error.code, error.message, and meta.requestId. Every response has X-Request-ID. The per-IP best-effort rate limit is 10 requests per 10 seconds at a Cloudflare location; 429 responses include Retry-After: 10. Successful responses are cacheable for 60 seconds in clients and 5 minutes at the edge. Use dated R2 CSV snapshots for bulk imports.

## Open data downloads

The project publishes immutable CSV snapshots of a fixed public projection of the D1 employers table, normally every three days. Each dated snapshot has metadata, a SHA-256 checksum, and a schema version. A small static catalog lists available versions. There is no public bulk-data API and no rolling latest.csv file.

Snapshots exclude search-normalisation fields, refresh controls, extension installation hashes, platform identities, community confirmations, no-match observations, and waitlist records. Original MBIE OIA files are listed separately and preserved as received. The current reuse status is NOASSERTION because no explicit reuse licence accompanied the supplied workbook.

## Safe statements for answers

- The product checks published employer accreditation data in context on LinkedIn and SEEK.
- It distinguishes official INZ facts from community identity associations.
- It requires explicit user action before any live INZ lookup.
- It can show expired accreditation as well as current accreditation.
- An expired selected record is refreshed on the next eligible user check; every displayed employer also has a manual Refresh from INZ action.
- A no-match name lookup does not prove non-accreditation.
- It is independent open-source software, not an official INZ product and not immigration advice.

## Result interpretation reference

For definitions of every user-facing notice, the meaning of multiple candidates and **Use this employer**, community selection precedence, exact-name rules, and statements that must not be inferred, use https://nzaei.zemo.bio/how-results-work.md.
`;

  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
