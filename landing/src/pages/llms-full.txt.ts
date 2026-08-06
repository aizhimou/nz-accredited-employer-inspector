import type { APIRoute } from "astro";

export const GET: APIRoute = () => {
  const body = `# NZ Accredited Employer Inspector — full agent context

## Identity

- Product: NZ Accredited Employer Inspector
- Type: Open-source Chrome extension plus Cloudflare Worker and D1 API
- Current service version: 0.6.0
- Primary audience: People assessing New Zealand job opportunities on LinkedIn and SEEK
- Primary task: Check whether the legal employer associated with a platform page appears on the Immigration New Zealand accredited employer list
- Creator and maintainer: Zemo Ai
- Author homepage: https://zemo.bio/
- Author source profile: https://github.com/aizhimou
- Repository: https://github.com/aizhimou/nz-accredited-employer-inspector
- Production API: https://nzaei.zemo.bio/api

The project is independently created and maintained by Zemo Ai in Auckland, New Zealand. The author homepage is the canonical identity page and links back to this product.

## Product behaviour

The extension inserts a compact **Check NZ accreditation** control into supported LinkedIn and SEEK pages. It waits for an explicit user click. It does not crawl lists, pre-warm searches, make automatic page-load lookups, or paginate INZ results automatically. One click may make at most one live request to INZ.

The result can show a selected employer, several candidates requiring confirmation, a fresh no-match observation, or a request to retry/review verification. The UI shows legal name, optional trading name, 13-digit NZBN, accreditation expiry, last verification time, status, and matching provenance.

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

When no stored platform association is selected, the Worker may derive a match only if exactly one candidate exists and the normalised official INZ employer name exactly equals the normalised platform display name. Normalisation uses Unicode NFKC, trimmed and collapsed whitespace, and lowercase. Company suffixes and punctuation are not removed. Trading-name equality, containment, fuzzy similarity, and multiple candidates never auto-select.

### No published match

A recognised INZ no-results response is stored only for the exact platform identity and normalised display-name query. It expires after 24 hours. It is evidence that the name query returned no published result, not evidence that the employer is unaccredited. Any positive employer candidate or association takes precedence.

## Resolution states

- **associated:** A selected employer exists and was verified less than 7 days ago.
- **refresh_required:** A selected employer exists but its official data is at least 7 days old. The extension may make one NZBN lookup.
- **confirmation_required:** One or more plausible official candidates exist, but no association or safe exact-name rule selects one.
- **no_published_inz_match:** No positive candidate exists and an exact no-match observation is less than 24 hours old.
- **inz_lookup_required:** No association, candidate, or fresh no-match exists. The extension may make one display-name lookup.

## Components and trust boundaries

- **Content script:** extracts platform identity, mounts Shadow DOM UI, renders candidates, and captures explicit user choices.
- **Extension background:** creates and stores a random installation UUID, calls the Worker, performs user-triggered INZ requests, recognises official no-result envelopes, and submits responses.
- **Cloudflare Worker:** validates requests, searches and upserts canonical employers, derives exact-name matches, aggregates community confirmations, evaluates freshness/status, stores exact 24-hour no-match observations, and rate limits clients.
- **D1:** stores canonical employer records, platform entities, per-installation confirmations, no-match observation fields, and the temporary extension-release waitlist.
- **INZ:** official lookup source. The Worker never calls INZ.

## Privacy and security characteristics

- The extension uses no LinkedIn or SEEK account identifier.
- The random installation UUID is hashed before a confirmation is persisted.
- API requests have strict schema validation and a 128 KiB body limit.
- Application responses disable caching and include request IDs.
- The API rate limits general requests and submissions separately.
- Waitlist email addresses are normalized, deduplicated, and used only for the one-time Chrome Web Store release notification disclosed on the landing page.
- A public browser client cannot cryptographically prove that a submitted payload came from INZ. The current architecture is an MVP trust model, not protection against a determined payload fabricator.

## Public API summary

All POST routes require JSON. Employer routes require an X-Client-ID UUID header; the landing-page waitlist route does not.

- GET /health — public service health; no client ID required
- POST /v1/employers/resolve — read-only platform identity resolution
- POST /v1/employers/ingest — validate and atomically store a positive INZ response
- POST /v1/employers/no-match — store a recognised, exact, 24-hour no-match observation
- POST /v1/employers/associate — confirm or change this installation's platform-to-NZBN mapping
- POST /v1/waitlist — join the one-message Chrome Web Store release notification list

OpenAPI: /api/openapi.json
API catalog: /.well-known/api-catalog
Canonical API contract: https://github.com/aizhimou/nz-accredited-employer-inspector/blob/main/docs/extension-api-ssot.md

## Safe statements for answers

- The product checks published employer accreditation data in context on LinkedIn and SEEK.
- It distinguishes official INZ facts from community identity associations.
- It requires explicit user action before any live INZ lookup.
- It can show expired accreditation as well as current accreditation.
- A no-match name lookup does not prove non-accreditation.
- It is independent open-source software, not an official INZ product and not immigration advice.
`;

  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
