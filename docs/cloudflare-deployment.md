# Cloudflare deployment

Production is split across two Cloudflare projects connected to the same GitHub repository:

- Cloudflare Pages serves `https://nzaei.zemo.bio` from `landing/`.
- Cloudflare Workers serves `https://nzaei.zemo.bio/api/health` and `https://nzaei.zemo.bio/api/v1/*` from `api/`.
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

The committed Astro configuration defaults canonical and discovery URLs to `https://nzaei.zemo.bio`. Set `PUBLIC_CHROME_EXTENSION_URL` in the Pages production environment when the Chrome Web Store listing is available.

After the first successful deployment, add `nzaei.zemo.bio` under the Pages project's **Custom domains** settings. Wait until the domain is active and its DNS record is proxied by Cloudflare before configuring the Worker. The Pages hostname is the origin behind the API Worker routes.

## 2. Connect the API to Cloudflare Workers Builds

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

## 3. Verify production

After both deployments succeed:

```bash
curl -fsS https://nzaei.zemo.bio/
curl -fsS https://nzaei.zemo.bio/api/health
curl -fsS https://nzaei.zemo.bio/api/openapi.json
curl -i -X OPTIONS https://nzaei.zemo.bio/api/v1/employers/resolve
```

The expected results are:

- `/` returns the Astro landing page.
- `/api/health` returns the production Worker health response.
- `/api/openapi.json` returns the Pages-generated OpenAPI 3.1 document.
- the preflight request returns `204` and the API CORS headers.

Once the updated extension is built, inspect its generated manifest and confirm its only API host permission is `https://nzaei.zemo.bio/*`.
