import type { APIRoute } from "astro";

export const GET: APIRoute = () => {
  const body = `---
title: NZ Accredited Employer Inspector
description: Check whether employers on SEEK and LinkedIn are accredited with Immigration New Zealand before you apply.
language: en-NZ
version: 0.6.0
author: Zemo Ai
author_url: https://zemo.bio/
---

# Know who's accredited. Before you apply.

NZ Accredited Employer Inspector is an open-source Chrome extension that checks employers on LinkedIn and SEEK against Immigration New Zealand (INZ) data without leaving the job page.

## What it does

1. The user browses a supported LinkedIn or SEEK NZ company or job page.
2. The user explicitly selects **Check NZ accreditation**.
3. The extension resolves the platform company to an official employer record.
4. The interface shows the legal employer name, NZBN, accreditation expiry date, verification time, and match provenance.

No lookup runs automatically on page load. One click may perform at most one live INZ request.

## Evidence and provenance

- **Accreditation:** Official employer name, trading name, NZBN, expiry and verification time are INZ facts.
- **Platform association:** A mapping between a LinkedIn or SEEK identity and an NZBN is user-confirmed community data.
- **Exact legal-name match:** A sole candidate may be derived automatically only when its normalised official employer name exactly matches the platform display name. It is not community-confirmed.
- **No published match:** An exact platform-and-query observation lasts 24 hours. It is not proof that an employer is unaccredited.

Accreditation status and platform association confidence are separate dimensions.

## Privacy and safety characteristics

- No LinkedIn or SEEK account identity is used.
- A random extension installation UUID is stored locally and hashed by the API.
- The Worker does not call INZ. A live INZ lookup happens in the extension background only after a user action.
- Fuzzy candidates are never silently selected.
- The implementation and API contract are public.

## Supported surfaces

- LinkedIn company profiles, direct job pages, and job search detail panes.
- SEEK NZ job pages, search and homepage detail panes, and company profiles.

## Product walkthrough

Watch the [16-second product walkthrough](https://www.youtube.com/watch?v=85SEJU-aHrQ) to see the extension check a supported job page and show the evidence behind the result.

## Get the extension

The Chrome Web Store listing is currently under review. Visitors can join the one-message release notification list on the landing page or [download version 0.6.0](https://github.com/aizhimou/nz-accredited-employer-inspector/releases/download/0.6.0/nz-accredited-employer-inspector-extension-0.6.0-chrome.zip) and load the extracted extension through Chrome Developer mode.

## Project links

- [Source repository](https://github.com/aizhimou/nz-accredited-employer-inspector)
- [Extension source](https://github.com/aizhimou/nz-accredited-employer-inspector/tree/main/extension)
- [Architecture and API contract](https://github.com/aizhimou/nz-accredited-employer-inspector/blob/main/docs/extension-api-ssot.md)
- [Official INZ accredited employer list](https://www.immigration.govt.nz/work/requirements-for-work-visas/approved-employers/accredited-employer-list/)
- [Built by Zemo Ai](https://zemo.bio/)

## Agent resources

- [/llms.txt](/llms.txt): concise discovery index
- [/llms-full.txt](/llms-full.txt): complete product context
- [/.well-known/api-catalog](/.well-known/api-catalog): RFC 9727 API catalog
- [/api/openapi.json](/api/openapi.json): OpenAPI 3.1 description
- [/sitemap.xml](/sitemap.xml): crawl map

## Disclaimer

This independent open-source project is not an Immigration New Zealand product and does not provide legal or immigration advice.
`;

  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
