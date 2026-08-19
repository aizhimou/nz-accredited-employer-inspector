import type { APIRoute } from "astro";

export const GET: APIRoute = () => {
  const body = `---
title: Public API
description: Read-only employer lookups and name search for automation and system integrations.
language: en-NZ
---

# NZ Accredited Employer Inspector public API

The public API provides unauthenticated, read-only access to individual employer records. It is intended for automation and system integrations, not bulk extraction.

- Base URL: https://nzaei.zemo.bio/api/public/v1
- OpenAPI 3.1: https://nzaei.zemo.bio/api/public/openapi.json
- Methods: GET, HEAD, OPTIONS only
- Authentication: none
- Rate limit: 10 requests per 10 seconds per IP address at a Cloudflare location

## Endpoints

### Get one employer

GET /employers/{nzbn}

The NZBN must contain exactly 13 digits.

\`\`\`bash
curl 'https://nzaei.zemo.bio/api/public/v1/employers/9429034908822'
\`\`\`

### Search employers

GET /employers/search?q={query}&limit={1..10}

Every keyword must match an indexed employer or trading name. The response is BM25-ranked and capped at 10 results.

\`\`\`bash
curl --get \\
  --data-urlencode 'q=One New Zealand' \\
  --data-urlencode 'limit=5' \\
  'https://nzaei.zemo.bio/api/public/v1/employers/search'
\`\`\`

## Response format

Successful lookup:

\`\`\`json
{
  "data": {
    "employerName": "Example Limited",
    "tradingName": null,
    "nzbn": "9429000000000",
    "expiryDateOfAccreditation": "2027-01-31",
    "lastVerifiedAt": "2026-08-18T21:10:00.000Z",
    "accreditationStatus": "accredited"
  }
}
\`\`\`

Search responses add \`meta.query\` and \`meta.count\`. Errors use \`error.code\`, \`error.message\`, and \`meta.requestId\`. Every response includes an \`X-Request-ID\` header; a rate-limited response returns \`429\` and \`Retry-After: 10\`.

## Caching and bulk use

Successful results are cacheable for 60 seconds in clients and 5 minutes at the edge. Use the dated [open-data CSV snapshots](https://nzaei.zemo.bio/open-data/) for batch imports, reproducible analysis, or complete-data workflows.

## Limitations

Records are dated observations, not a live or complete official register. This independent project is not an Immigration New Zealand product and does not provide immigration or legal advice. Verify important decisions with Immigration New Zealand or the employer.
`;

  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
