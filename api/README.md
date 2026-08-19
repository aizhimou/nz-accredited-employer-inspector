# Accredited Employer API

Cloudflare Worker API backed by D1. It searches the canonical employer dataset, accepts validated INZ responses fetched directly by the browser extension, and stores user-confirmed LinkedIn/SEEK associations. The Worker does not call INZ and D1 is not used as a search-response cache.

The extension-facing architecture, orchestration, complete API contract, fields, freshness policy, and trust model are defined in [`../docs/extension-api-ssot.md`](../docs/extension-api-ssot.md).

## Endpoints

- Production base URL: `https://nzaei.zemo.bio/api`
- `GET /health`
- `POST /v1/employers/resolve`
- `POST /v1/employers/search`
- `POST /v1/employers/ingest`
- `POST /v1/employers/no-match`
- `POST /v1/employers/refresh`
- `POST /v1/employers/associate`
- `POST /v1/waitlist`
- `GET /public/v1/employers/{nzbn}`
- `GET /public/v1/employers/search?q={query}&limit={1..10}`

Employer requests require an `X-Client-ID` UUID header. The landing-page waitlist endpoint does not.

## Public API

The public API is a separate, read-only contract for automation and system integrations. It accepts only `GET`, `HEAD`, and `OPTIONS`; it does not require `X-Client-ID` or authentication, and it does not expose platform identities, community associations, refresh controls, or any write operation.

- Production base URL: `https://nzaei.zemo.bio/api/public/v1`
- OpenAPI document: `https://nzaei.zemo.bio/api/public/openapi.json`
- Rate limit: 10 requests per 10 seconds per `CF-Connecting-IP` at a Cloudflare location. A rejected request returns `429` with `Retry-After: 10`.
- Successful responses are cacheable for 60 seconds in clients and 5 minutes at the edge. Use the dated R2 CSV snapshots for bulk imports instead of crawling the API.

Exact lookup example:

```bash
curl 'https://nzaei.zemo.bio/api/public/v1/employers/9429034908822'
```

Search example:

```bash
curl --get \
  --data-urlencode 'q=One New Zealand' \
  --data-urlencode 'limit=5' \
  'https://nzaei.zemo.bio/api/public/v1/employers/search'
```

Success responses use a `data` envelope; search responses add `meta.query` and `meta.count`. Errors use an `error` envelope with a stable machine-readable `code` and include `meta.requestId`. Every response also carries `X-Request-ID`.

The temporary `extension_waitlist` table stores normalized, unique email addresses for one Chrome Web Store release notification. The landing page discloses this narrow purpose; `notified_at` can be set when the message is sent and the table can be removed after the release.

## Local development

```bash
npm install
npm run typegen
npm run d1:migrate:local
npm test
npm run dev
```

Resolve example:

```bash
curl -X POST \
  -H 'Content-Type: application/json' \
  -H 'X-Client-ID: 11111111-1111-4111-8111-111111111111' \
  --data '{"identity":{"platform":"linkedin","externalKey":"company:onenz","kind":"linkedin_company_url","strength":"strong","displayName":"One New Zealand","publicUrl":"https://www.linkedin.com/company/onenz/"}}' \
  'http://localhost:8787/v1/employers/resolve'
```

An `inz_lookup_required` response tells the extension to perform one user-triggered INZ lookup. Positive results are submitted to `/ingest`; recognised INZ `400 No Results` envelopes are submitted to `/no-match`. Selected positive observations refresh after the configured positive TTL (30 days by default) or on the first eligible user check after their stored accreditation expiry passes. `/refresh` claims a short per-NZBN refresh lease before the extension calls INZ, and a recognised NZBN no-result applies a 24-hour cooldown without changing `last_verified_at`. A unique NZBN whose official `employerName` or `tradingName` exactly matches the normalised platform display name is returned directly with `matchMethod: "exact_employer_name"`; no community confirmation is created.

Automatic resolution uses only saved/community associations and exact normalised official or trading-name equality. `/search` is a separate, user-initiated recovery path backed by a D1 FTS5 index. Every keyword must match an official or trading-name token; tokens of at least three characters support prefix matching. The endpoint returns at most 10 BM25-ranked results and never writes an association or calls INZ.

Freshness is configured in `wrangler.jsonc` through `POSITIVE_TTL_SECONDS`, `NEGATIVE_TTL_SECONDS`, `REFRESH_ATTEMPT_COOLDOWN_SECONDS`, and `REFRESH_NO_MATCH_COOLDOWN_SECONDS`. All four variables are required positive integer numbers of seconds and must be declared separately for every Wrangler environment.

## Open data snapshots

The Worker also has a scheduled handler that publishes a fixed public projection of the `employers` table to the `OPEN_DATA_BUCKET` R2 binding. The Cron Trigger runs daily at 16:15 UTC, reads the small static catalog, and exits without querying D1 until 72 hours have passed since the previous successful publication. A failed eligible run is therefore retried the next day.

Each successful publication writes:

- `snapshots/YYYY-MM-DD/employers.csv` — immutable, NZBN-ordered UTF-8 CSV;
- `snapshots/YYYY-MM-DD/metadata.json` — row count, checksum, schema version, and provenance;
- `schema/employers-v1.json` — immutable machine-readable field definition;
- `catalog.json` — the only mutable object, updated after all dated release objects succeed.

There is no `latest.csv` and no bulk-data HTTP endpoint. The projection excludes normalised search fields, refresh controls, platform identities, installation hashes, community confirmations, no-match observations, and waitlist records. Publication stops when validation fails, the output exceeds its safety limits, or the row count changes by more than 25% from the prior release.

Test a scheduled event against local D1 and R2 bindings with:

```bash
npx wrangler dev --local --test-scheduled
curl http://localhost:8787/__scheduled
```

## Official employer imports

The importer accepts the MBIE OIA `.xlsx` appendix, validates its fixed 11-column layout and snapshot date, preserves every source row in an audit table, and generates D1-compatible SQL in batches below D1's 100 KB statement limit. Rows without a valid NZBN remain in `official_employer_import_rows` for audit but are not inserted into the NZBN-keyed `employers` table.

Install the importer dependency and generate the SQL:

```bash
python3 -m pip install -r requirements-import.txt
npm run d1:official:prepare -- \
  "/path/to/DOIA-REQ-0037267 Appendix.xlsx" \
  --output .generated/official-employer-import.sql
```

Apply migrations, import, and verify locally first:

```bash
npm run d1:migrate:local
npm run d1:official:import:local
npx wrangler d1 execute DB --local --command \
  "SELECT snapshot_date, expected_row_count, importable_row_count, actual_row_count, status FROM official_employer_imports ORDER BY snapshot_date DESC LIMIT 1"
npx wrangler d1 execute DB --local --command \
  "SELECT COUNT(*) AS employer_count FROM employers"
```

The import is idempotent. It first loads source rows under `status = 'loading'`, validates the complete row count, then performs one canonical `INSERT ... SELECT ... ON CONFLICT` statement. A partial upload therefore cannot partially update `employers`. Newer live observations are not overwritten by an older official snapshot.

Before the production import, export a recovery copy, apply the migration, then execute the already verified SQL:

```bash
mkdir -p .backups
npx wrangler d1 export nz-accredited-employer-prod --remote \
  --output .backups/pre-official-import.sql
npm run d1:migrate:prod
npm run d1:official:import:prod
```

Do not commit the generated SQL or the source workbook. Both `.generated/` and `.backups/` are ignored.

## Production

```bash
npm run d1:migrate:prod
npm run deploy:prod
```

The D1 binding, production resource identifiers, and the `nzaei.zemo.bio/api` routes are defined in `wrangler.jsonc`. `npm run release:prod` applies pending D1 migrations and deploys the production Worker; Cloudflare Workers Builds uses this command after a successful CI build.
