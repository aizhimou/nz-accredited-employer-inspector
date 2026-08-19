# Cloudflare deployment

Production is split across two Cloudflare projects connected to the same GitHub repository:

- Cloudflare Pages serves `https://nzaei.zemo.bio` from `landing/`.
- Cloudflare Workers serves `https://nzaei.zemo.bio/api/health` and `https://nzaei.zemo.bio/api/v1/*` from `api/`.
- Cloudflare R2 serves immutable open-data files from `https://data.nzaei.zemo.bio`.
- Pages continues to serve the static OpenAPI document at `https://nzaei.zemo.bio/api/openapi.json` because the Worker routes are intentionally narrower than `/api/*`.

Complete the following dashboard setup once. Afterwards, pushes to `main` deploy automatically.

## 1. Connect the landing page to Cloudflare Pages

In **Workers & Pages**, create a Pages application and connect this GitHub repository.

Use these build settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `/landing` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Build watch path | `landing/**` |

The committed Astro configuration defaults canonical and discovery URLs to `https://nzaei.zemo.bio`. Set `PUBLIC_OPEN_DATA_BASE_URL=https://data.nzaei.zemo.bio` in the Pages production environment.

After the first successful deployment, add `nzaei.zemo.bio` under the Pages project's **Custom domains** settings. Wait until the domain is active and its DNS record is proxied by Cloudflare before configuring the Worker. The Pages hostname is the origin behind the API Worker routes.

## 2. Create the public open-data bucket

From `api/`, create the R2 bucket and apply the committed read-only browser CORS policy:

```bash
npx wrangler r2 bucket create nz-accredited-employer-public-data
npx wrangler r2 bucket cors set nz-accredited-employer-public-data \
  --file r2-cors.json
```

In the bucket's **Settings**, connect the custom domain `data.nzaei.zemo.bio`. The domain must be in the same Cloudflare account and its public access must be enabled. Do not enable the temporary `r2.dev` URL for production use.

Upload the original MBIE workbook once, preserving the immutable dated key used by the catalog:

```bash
npx wrangler r2 object put \
  nz-accredited-employer-public-data/original/2026-07-27/mbie-accredited-employers.xlsx \
  --file "../data/original-data/List of Accredited Employers as at 27 July 2026.xlsx"
```

The scheduled Worker creates generated CSVs, per-version metadata, the schema, and `catalog.json`. The bucket is public only for object reads; Worker writes use the in-process R2 binding.

## 3. Connect the API to Cloudflare Workers Builds

Open the existing `nz-accredited-employer-api` Worker and connect the same GitHub repository under **Builds**.

Use these build settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `/api` |
| Build command | `npm run check` |
| Deploy command | `npm run release:prod` |
| Build watch path | `api/**` |

The build command verifies generated binding types, TypeScript, and tests. The deploy command applies pending D1 migrations and runs `wrangler deploy --env production`.

The production environment in `api/wrangler.jsonc` owns these routes:

```text
nzaei.zemo.bio/api/health
nzaei.zemo.bio/api/v1/*
```

Do not configure the Worker as a Custom Domain and do not replace these routes with `nzaei.zemo.bio/api/*`; either change would prevent Pages from serving `/api/openapi.json`.

The Worker configuration runs the snapshot schedule daily at 16:15 UTC. The handler reads `catalog.json` and publishes only when at least 72 hours have passed, so generated snapshots are normally three days apart while a failed eligible run can retry the next day.

## 4. Verify production

After both deployments succeed:

```bash
curl -fsS https://nzaei.zemo.bio/
curl -fsS https://nzaei.zemo.bio/api/health
curl -fsS https://nzaei.zemo.bio/api/openapi.json
curl -fsS https://nzaei.zemo.bio/open-data/
curl -fsS -H 'Origin: https://nzaei.zemo.bio' \
  https://data.nzaei.zemo.bio/catalog.json
curl -i -X OPTIONS https://nzaei.zemo.bio/api/v1/employers/resolve
```

The expected results are:

- `/` returns the Astro landing page.
- `/api/health` returns the production Worker health response.
- `/api/openapi.json` returns the Pages-generated OpenAPI 3.1 document.
- `/open-data/` returns the data catalog and documentation page.
- the R2 catalog request returns JSON with an `Access-Control-Allow-Origin` header after the first scheduled publication.
- the preflight request returns `204` and the API CORS headers.

Once the updated extension is built, inspect its generated manifest and confirm its only API host permission is `https://nzaei.zemo.bio/*`.
