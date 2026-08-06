# Accredited Employer API

Cloudflare Worker API backed by D1. It searches the canonical employer dataset, accepts validated INZ responses fetched directly by the browser extension, and stores user-confirmed LinkedIn/SEEK associations. The Worker does not call INZ and D1 is not used as a search-response cache.

The extension-facing architecture, orchestration, complete API contract, fields, freshness policy, and trust model are defined in [`../docs/extension-api-ssot.md`](../docs/extension-api-ssot.md).

## Endpoints

- Production base URL: `https://nzaec.zemo.bio/api`
- `GET /health`
- `POST /v1/employers/resolve`
- `POST /v1/employers/ingest`
- `POST /v1/employers/no-match`
- `POST /v1/employers/associate`

Search requests require an `X-Client-ID` UUID header.

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

An `inz_lookup_required` response tells the extension to perform one user-triggered INZ lookup. Positive results are submitted to `/ingest`; recognised INZ `400 No Results` envelopes are submitted to `/no-match` and reused only for the exact platform identity/query for 24 hours. A sole candidate whose official `employerName` exactly matches the normalised platform display name is returned directly with `matchMethod: "exact_employer_name"`; this is derived on read and does not create a community confirmation.

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

The D1 binding, production resource identifiers, and the `nzaec.zemo.bio/api` routes are defined in `wrangler.jsonc`. `npm run release:prod` applies pending D1 migrations and deploys the production Worker; Cloudflare Workers Builds uses this command after a successful CI build.
