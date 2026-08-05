# NZ Accredited Employer Inspector

This repository contains two independently deployable projects:

- [`api/`](./api): Cloudflare Worker and D1-backed canonical accredited employer API.
- [`extension/`](./extension): WXT Chrome extension with LinkedIn and SEEK page adapters.

See [`docs/extension-api-ssot.md`](./docs/extension-api-ssot.md) for the canonical architecture, trust boundaries, data model, and extension-facing contract. The core asset is the `employers` table; platform associations are community confirmations, and D1 is not used as an INZ search-response cache.
