import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL("https://nzaei.zemo.bio");
  const link = (path: string): string => new URL(path, base).href;
  const body = `# NZ Accredited Employer Inspector

> An open-source Chrome extension that checks New Zealand employer accreditation on LinkedIn and SEEK using Immigration New Zealand data. It keeps official accreditation facts, derived name matches, and community platform associations visibly separate.

## Creator

- [Zemo Ai](https://zemo.bio/): Creator and maintainer of NZ Accredited Employer Inspector, based in Auckland, New Zealand.
- [GitHub profile](https://github.com/aizhimou): Author profile for the project's public source repository.

## Start here

- [Product overview](${link("/index.md")}): What the product does, how a check works, trust boundaries, privacy, and supported platforms.
- [Privacy policy](${link("/privacy/")}): Public Chrome extension privacy policy covering data collection, use, sharing, retention, security, and deletion requests.
- [Privacy policy as Markdown](${link("/privacy.md")}): Low-markup version of the same policy.
- [Full agent context](${link("/llms-full.txt")}): Detailed architecture, data provenance, resolution states, API summary, limitations, and terminology.

## API discovery

- [API catalog](${link("/.well-known/api-catalog")}): RFC 9727 linkset for the public extension API.
- [OpenAPI description](${link("/api/openapi.json")}): Machine-readable OpenAPI 3.1 contract.
- [API health](https://nzaei.zemo.bio/api/health): Current service health and version.

## Project source

- [Repository](https://github.com/aizhimou/nz-accredited-employer-inspector): Worker, D1 migrations, extension, tests, and documentation.
- [Canonical architecture and API contract](https://github.com/aizhimou/nz-accredited-employer-inspector/blob/main/docs/extension-api-ssot.md): Single source of truth for implementation semantics.
- [Extension guide](https://github.com/aizhimou/nz-accredited-employer-inspector/blob/main/extension/README.md): Local setup and verification.
- [Chrome extension 0.6.0 ZIP](https://github.com/aizhimou/nz-accredited-employer-inspector/releases/download/0.6.0/nz-accredited-employer-inspector-extension-0.6.0-chrome.zip): Direct download while the Chrome Web Store listing is under review.
- [API guide](https://github.com/aizhimou/nz-accredited-employer-inspector/blob/main/api/README.md): Endpoints and local development.

## Authoritative external source

- [Immigration New Zealand accredited employer list](https://www.immigration.govt.nz/work/requirements-for-work-visas/approved-employers/accredited-employer-list/): Official source for employer accreditation.

## Important interpretation rule

A “no published INZ match” result is not proof that an employer is unaccredited. Accreditation facts and platform association confidence are independent.
`;

  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
