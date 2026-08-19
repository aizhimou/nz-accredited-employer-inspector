# NZ Accredited Employer Inspector

An open-source Chrome extension that helps job seekers check whether employers shown on LinkedIn and SEEK New Zealand are accredited by Immigration New Zealand (INZ), without leaving the page.

The project deliberately separates official accreditation evidence from the evidence that maps a company page to a legal employer. A result can show:

- official INZ employer data: legal name, trading name, NZBN, and accreditation expiry, plus the time the Inspector accepted that observation;
- a user-confirmed LinkedIn or SEEK association;
- a derived exact official/trading-name match, which is not a community confirmation; or
- a recent no-published-match observation, which is not proof that an employer is unaccredited.

No live lookup runs when a page loads. A check starts only after the user selects **Check NZ accreditation**, and that action makes at most one live INZ request.

## Live services

- Product site: [nzaei.zemo.bio](https://nzaei.zemo.bio)
- Chrome Web Store: [Install the extension](https://chromewebstore.google.com/detail/nz-accredited-employer-in/gjcifpaoplkboeefndngnglhjhldkbbg)
- Extension API: `https://nzaei.zemo.bio/api`
- Open-data catalog: [data.nzaei.zemo.bio/catalog.json](https://data.nzaei.zemo.bio/catalog.json)

## What is supported

The extension currently supports:

- LinkedIn company profiles, direct job pages, and job-search detail panes;
- SEEK NZ company profiles, job pages, search-result detail panes, and homepage recommendation detail panes.

Use the toolbar popup to pause or resume the Inspector. When paused, it does not mount new page widgets or run checks; refreshing a page after re-enabling it restores the widget.

## Repository layout

| Path | Purpose |
| --- | --- |
| [`extension/`](./extension) | WXT Manifest V3 Chrome extension (currently `0.9.0`). |
| [`api/`](./api) | Cloudflare Worker, D1 schema/importer, Worker API, and scheduled R2 open-data publication (currently service `0.8.0`). |
| [`landing/`](./landing) | Astro product site, public API description, privacy policy, changelog, insights, and open-data pages. |
| [`scripts/employer-refresh/`](./scripts/employer-refresh) | Operator-run sequential refresh for employers nearing expiry; it calls INZ and D1 directly, outside the public API. |
| [`data/original-data/`](./data/original-data) | Source MBIE OIA workbooks used for official imports. |
| [`docs/`](./docs) | Architecture/API contract and Cloudflare deployment notes. |

## Architecture

```text
LinkedIn / SEEK page
        │ explicit user action
        ▼
Chrome extension ─────► Cloudflare Worker + D1
        │                       │
        │                       ├─ canonical employer records
        │                       ├─ community page associations
        │                       └─ short-lived no-match / refresh controls
        │
        └────► INZ lookup endpoint (only when the Worker requires it)

Cloudflare scheduled handler ─────► R2 dated open-data snapshots
Operator refresh script ──────────► INZ + production D1
```

The Worker validates and stores browser-submitted INZ payloads but never calls INZ itself. The separate operator refresh script is intentionally outside the extension request path.

## Development

Each deployable project has its own dependency tree and scripts. Use Node.js 22 or later.

```bash
# Extension
cd extension
npm install
npm run check

# Worker API (typegen, TypeScript, and tests)
cd ../api
npm install
npm run check

# Landing site
cd ../landing
npm install
npm run build
```

For local extension work, run `npm run dev` from `extension/` and load `extension/.output/chrome-mv3` if WXT does not open Chrome automatically. The API and import workflow are documented in [`api/README.md`](./api/README.md); deployment order is in [`docs/cloudflare-deployment.md`](./docs/cloudflare-deployment.md).

## Data and trust boundaries

`employers` is the canonical NZBN-keyed dataset. It is populated by validated official MBIE imports and user-triggered INZ observations. Platform associations are community data, not INZ facts; a unique exact name match is derived on demand and never persisted as a confirmation.

The Worker publishes a fixed, privacy-safe projection of the canonical dataset as immutable dated CSV snapshots to R2. It also lists an original MBIE OIA workbook for download. These files use `NOASSERTION` licence status and are dated observations, not a live official register.

For the complete extension contract, data model, freshness rules, API error semantics, and provenance model, read [`docs/extension-api-ssot.md`](./docs/extension-api-ssot.md). For a public machine-readable reference, see [OpenAPI 3.1](https://nzaei.zemo.bio/api/openapi.json) and the [open-data guide](https://nzaei.zemo.bio/open-data/).

## Privacy and disclaimer

The extension does not use a LinkedIn or SEEK account identity. It keeps a random installation UUID in extension storage; the API hashes it before storing a confirmation. It is a rate-limit and selection key, not authentication.

This independent project is not an INZ product and does not provide immigration or legal advice. Verify important decisions with INZ or the employer. See the full [privacy policy](https://nzaei.zemo.bio/privacy/) and [how results work](https://nzaei.zemo.bio/how-results-work/).
