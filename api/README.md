# Accredited Employer API

Cloudflare Worker API backed by D1. It searches the canonical employer dataset, accepts validated INZ responses fetched directly by the browser extension, and stores user-confirmed LinkedIn/SEEK associations. The Worker does not call INZ and D1 is not used as a search-response cache.

The extension-facing architecture, orchestration, complete API contract, fields, freshness policy, and trust model are defined in [`../docs/extension-api-ssot.md`](../docs/extension-api-ssot.md).

## Endpoints

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

An `inz_lookup_required` response tells the extension to perform one user-triggered INZ lookup. Positive results are submitted to `/ingest`; recognised INZ `400 No Results` envelopes are submitted to `/no-match` and reused only for the exact platform identity/query for 24 hours.

## Production

```bash
npm run d1:migrate:prod
npm run deploy:prod
```

The D1 binding and production resource identifiers are defined in `wrangler.jsonc`.
