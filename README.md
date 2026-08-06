# NZ Accredited Employer Inspector

This repository contains three independently buildable projects:

- [`api/`](./api): Cloudflare Worker and D1-backed canonical accredited employer API.
- [`extension/`](./extension): WXT Chrome extension with LinkedIn and SEEK page adapters.
- [`landing/`](./landing): Astro landing page deployed to Cloudflare Pages.

See [`docs/extension-api-ssot.md`](./docs/extension-api-ssot.md) for the canonical architecture, trust boundaries, data model, and extension-facing contract. The core asset is the `employers` table; platform associations are community confirmations, and D1 is not used as an INZ search-response cache.

Production uses `https://nzaec.zemo.bio` for the landing page and `https://nzaec.zemo.bio/api` for the extension API. See [`docs/cloudflare-deployment.md`](./docs/cloudflare-deployment.md) for the one-time Cloudflare Git integration setup.
