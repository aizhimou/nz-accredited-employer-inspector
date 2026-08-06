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

## Cloudflare Pages

The Pages project builds from the `landing` monorepo root with `npm run build` and publishes `dist`. Cloudflare Git integration automatically builds and deploys pushes to `main`; the one-time dashboard settings and deployment order are documented in [`../docs/cloudflare-deployment.md`](../docs/cloudflare-deployment.md).

## Production site URL

The production origin defaults to `https://nzaei.zemo.bio`. Astro uses it for canonical links, `robots.txt`, `sitemap.xml`, `llms.txt`, the API catalog, and social metadata. Override `SITE_URL` only when building for another environment.

```bash
SITE_URL=https://preview.example.com npm run build
```

Without `SITE_URL`, generated absolute URLs use the production origin.

## Temporary download flow

While the Chrome Web Store listing is under review, the hero CTA opens a dialog with two paths: a one-message release waitlist backed by `POST /api/v1/waitlist`, or a direct version 0.6.0 ZIP download with Developer mode instructions. Replace this temporary dialog with the store link after approval.

## Agent-readable resources

- `/robots.txt` includes crawl policy, Content Signals, and the sitemap URL.
- `/sitemap.xml` lists human and machine-readable resources.
- `/llms.txt` is the concise discovery index.
- `/llms-full.txt` contains detailed product, architecture, trust, privacy, and API context.
- `/index.md` mirrors the core landing-page content as Markdown.
- `/privacy/` is the public Chrome Web Store privacy policy, with `/privacy.md` as its agent-readable equivalent.
- `/.well-known/api-catalog` is an RFC 9727 `application/linkset+json` catalog.
- `/api/openapi.json` describes the production extension API using OpenAPI 3.1.
- HTML includes semantic landmarks, JSON-LD, canonical metadata, and alternate-resource links.

`public/_headers` adds discovery `Link` headers and Content Signals when the build is deployed to Cloudflare Pages or another host that supports the same headers-file convention.

### Markdown content negotiation

This static project publishes explicit Markdown URLs, but Astro static output does not negotiate a second representation for `/` based on `Accept: text/markdown`. If the deployed domain uses Cloudflare, enable **Markdown for Agents** at the zone or matching Configuration Rule to provide network-level content negotiation. Verify it after deployment:

```bash
curl -I https://nzaei.zemo.bio/ -H 'Accept: text/markdown'
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

The demo embeds the published walkthrough from YouTube's privacy-enhanced `youtube-nocookie.com` domain and loads lazily. The hero's “See how it works” action scrolls to the player and starts playback.
