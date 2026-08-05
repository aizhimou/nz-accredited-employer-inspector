# NZ Accredited Employer Inspector landing page

Static Astro landing page for the NZ Accredited Employer Inspector. The page is designed for human readers and provides stable, low-token resources for crawlers and AI agents.

## Local development

```bash
npm install
npm run dev
```

Build and verify:

```bash
npm run build
npm run preview
```

## Production site URL

Set `SITE_URL` to the deployed origin before building. Astro uses it for canonical links, `robots.txt`, `sitemap.xml`, `llms.txt`, the API catalog, and social metadata.

```bash
SITE_URL=https://example.com npm run build
```

Without `SITE_URL`, local builds use `http://localhost:4321` so generated URLs remain valid during development.

## Chrome Web Store URL

Set `PUBLIC_CHROME_EXTENSION_URL` to the published Chrome Web Store listing. Until it is configured, the hero CTA links to the Chrome Web Store home page.

```bash
PUBLIC_CHROME_EXTENSION_URL=https://chromewebstore.google.com/detail/your-extension-id \
SITE_URL=https://example.com \
npm run build
```

## Agent-readable resources

- `/robots.txt` includes crawl policy, Content Signals, and the sitemap URL.
- `/sitemap.xml` lists human and machine-readable resources.
- `/llms.txt` is the concise discovery index.
- `/llms-full.txt` contains detailed product, architecture, trust, privacy, and API context.
- `/index.md` mirrors the core landing-page content as Markdown.
- `/.well-known/api-catalog` is an RFC 9727 `application/linkset+json` catalog.
- `/api/openapi.json` describes the production extension API using OpenAPI 3.1.
- HTML includes semantic landmarks, JSON-LD, canonical metadata, and alternate-resource links.

`public/_headers` adds discovery `Link` headers and Content Signals when the build is deployed to Cloudflare Pages or another host that supports the same headers-file convention.

### Markdown content negotiation

This static project publishes explicit Markdown URLs, but Astro static output does not negotiate a second representation for `/` based on `Accept: text/markdown`. If the deployed domain uses Cloudflare, enable **Markdown for Agents** at the zone or matching Configuration Rule to provide network-level content negotiation. Verify it after deployment:

```bash
curl -I https://example.com/ -H 'Accept: text/markdown'
```

The response should use `Content-Type: text/markdown`, include `Vary: Accept`, and return the converted page body.

## Design system

The visual language is based on an Aotearoa evidence trail:

- harbour (`#083b45`) for trust and structure;
- pounamu (`#087a5c`) for verified status and actions;
- kōwhai (`#e5b647`) for caution and important distinctions;
- mist (`#edf5f3`) for the quiet page surface.

The hero's provenance path and the trust-model grid are the primary visual signatures. The page uses no UI framework, external font request, or client-side JavaScript.

## Demo video

The video section currently uses a YouTube placeholder. Replace the video ID in `src/pages/index.astro` when the final walkthrough is uploaded. The embed uses YouTube's privacy-enhanced `youtube-nocookie.com` domain and loads lazily.
