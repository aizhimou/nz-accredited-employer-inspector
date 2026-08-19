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
- [How results work](${link("/how-results-work/")}): Plain-language explanation of official data, matching, multiple candidates, community confirmations, notices, and limitations.
- [How results work — agent version](${link("/how-results-work.md")}): Machine-readable interpretation rules and notice dictionary for accurate downstream answers.
- [Accredited employer insights](${link("/insights/")}): Interactive regional, sector, and accreditation-expiry overview from the dated official INZ snapshot.
- [Accredited employer insights as Markdown](${link("/insights.md")}): Machine-readable aggregate counts and interpretation notes.
- [Open data](${link("/open-data/")}): Dated downloadable snapshots, original MBIE source files, field definitions, provenance, reuse status, and limitations.
- [Open data as Markdown](${link("/open-data.md")}): Machine-readable snapshot publication method and field guide.
- [Public API](${link("/public-api/")}): Read-only NZBN lookup and employer-name search for integrations.
- [Public API as Markdown](${link("/public-api.md")}): Machine-readable public API guide with limits and response conventions.
- [Changelog](${link("/changelog/")}): Public release ledger with dates and user-visible improvements.
- [Changelog as Markdown](${link("/changelog.md")}): Machine-readable product release history.
- [Privacy policy](${link("/privacy/")}): Public Chrome extension privacy policy covering data collection, use, sharing, retention, security, and deletion requests.
- [Privacy policy as Markdown](${link("/privacy.md")}): Low-markup version of the same policy.
- [Full agent context](${link("/llms-full.txt")}): Detailed architecture, data provenance, resolution states, API summary, limitations, and terminology.

## API discovery

- [API catalog](${link("/.well-known/api-catalog")}): RFC 9727 linkset for the extension and read-only public APIs.
- [OpenAPI description](${link("/api/openapi.json")}): Machine-readable OpenAPI 3.1 contract.
- [Public OpenAPI description](${link("/api/public/openapi.json")}): Machine-readable OpenAPI 3.1 contract for the unauthenticated read-only API.
- [API health](https://nzaei.zemo.bio/api/health): Current service health and version.

## Project source

- [Repository](https://github.com/aizhimou/nz-accredited-employer-inspector): Worker, D1 migrations, extension, tests, and documentation.
- [Canonical architecture and API contract](https://github.com/aizhimou/nz-accredited-employer-inspector/blob/main/docs/extension-api-ssot.md): Single source of truth for implementation semantics.
- [Extension guide](https://github.com/aizhimou/nz-accredited-employer-inspector/blob/main/extension/README.md): Local setup and verification.
- [Chrome Web Store](https://chromewebstore.google.com/detail/nz-accredited-employer-in/gjcifpaoplkboeefndngnglhjhldkbbg): Install NZ Accredited Employer Inspector for Chrome.
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
