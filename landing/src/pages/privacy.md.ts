import type { APIRoute } from "astro";

export const GET: APIRoute = () => {
  const body = `---
title: Privacy Policy — NZ Accredited Employer Inspector
description: How the extension handles installation identifiers and supported-page employer data.
language: en-NZ
effective_date: 2026-08-06
canonical: https://nzaei.zemo.bio/privacy/
operator: Zemo Ai
contact: aizhimoug@gmail.com
---

# Privacy Policy

NZ Accredited Employer Inspector reads a small amount of public employer context only when a user explicitly selects **Check NZ accreditation**. It does not automatically send a lookup on page load and does not collect general browsing history.

## Data processed

### Random installation identifier

The extension generates a random UUID and stores it in Chrome local extension storage. It sends the UUID to https://nzaei.zemo.bio in the X-Client-ID request header for API rate limiting and to distinguish one installation's community confirmation from another. The UUID is not derived from a LinkedIn or SEEK account. The API stores a SHA-256 hash, not the raw UUID, when persisting a community confirmation.

### Supported-page employer context

The extension reads only the public fields needed to identify an employer on a supported LinkedIn or SEEK page:

- employer or company display name;
- public company identifier, such as a LinkedIn company slug, SEEK company path, or normalized SEEK advertiser name;
- public company URL, when available;
- platform and page type; and
- an NZBN selected by the user when confirming an employer association.

These fields are sent to https://nzaei.zemo.bio/api only during a user-triggered accreditation check or confirmation.

### Official accreditation results

When fresh official data is required, the extension sends the employer-name or NZBN query directly to Immigration New Zealand's public lookup service. It may then submit the returned employer name, trading name, NZBN, accreditation expiry, and response context to nzaei.zemo.bio for validation and display.

### Optional release email

Before the Chrome Web Store release, the landing page, not the extension, offered an optional one-message release waitlist. Submitted email addresses are used only for that notification.

## Data not read

The extension does not read or transmit a LinkedIn or SEEK account identifier, profile email, login credentials, cookies, private messages, saved jobs, job applications, contacts, payment details, or browsing activity outside supported pages needed for the accreditation feature.

## Purposes

Data is used only for:

- employer accreditation lookup;
- API rate limiting and abuse prevention;
- result provenance and official-data freshness;
- community-confirmed platform-to-employer associations; and
- limited service diagnostics using request IDs and events that omit the raw UUID and supported-page identity fields.

Data is not used for unrelated purposes.

## Sharing, sale, and advertising

The project uses Cloudflare Worker and D1 infrastructure to process requests, provide network security and rate limiting, and store service data. When needed, the extension sends an employer-name or NZBN query directly to Immigration New Zealand. The installation UUID is not sent to Immigration New Zealand.

Community confirmation totals and employer associations may be returned to other extension users. The raw UUID, stored UUID hash, and an individual installation's identity are not exposed in API responses.

The project does not sell data, share it with advertising networks, or use it for targeted advertising, behavioural profiling, credit decisions, or data brokerage.

## Retention

- **Local installation UUID:** retained in Chrome local extension storage until the extension is removed, its storage is cleared, or an invalid/missing value is replaced.
- **Raw UUID in API requests:** processed during the request for rate limiting and hashing; not intentionally written to the application database or application event logs.
- **Hashed UUID and community confirmation:** retained while the community-association feature operates, until no longer needed, or until a valid deletion request can be matched to it.
- **Employer name, company identifier, and public URL:** retained while the lookup and community-association service operates, unless removed earlier when no longer needed or following an applicable deletion request.
- **No-published-match observation:** used for no more than 24 hours. Stored fields may remain until replaced or cleared, but are ignored after expiry.
- **Official employer records:** retained while the service operates and updated or replaced as newer public Immigration New Zealand data is accepted.
- **Release waitlist email:** retained until the one release notification is sent or deletion is requested, then deleted from the active waitlist within 30 days after the notification campaign ends.

Infrastructure providers may temporarily retain network and operational metadata under their security and service-retention settings. Application events are designed not to include the raw UUID or supported-page identity fields listed above.

## Security

- Requests to nzaei.zemo.bio and Immigration New Zealand use HTTPS.
- The API validates schemas, limits request size, applies rate limits, and disables response caching.
- The raw UUID is hashed before a community confirmation is persisted in D1.
- The extension, API, database schema, and tests are open source.

No internet service can guarantee absolute security.

## Deletion and contact

Removing the extension or clearing its local storage stops future processing from that installation. To request deletion of waitlist, platform identity, or community-confirmation data, email [aizhimoug@gmail.com](mailto:aizhimoug@gmail.com?subject=NZ%20Accredited%20Employer%20Inspector%20privacy%20request) with the subject **NZ Accredited Employer Inspector privacy request**.

Include the supported public company URL and approximate check or confirmation date when relevant. Because the service does not collect account identity, additional context—and in some cases the installation UUID—may be needed to locate an anonymous hashed confirmation. Do not send passwords, cookies, or account credentials.

## Changes

This policy will be updated when the extension's data practices materially change. The effective date above identifies the current version. The [public repository](https://github.com/aizhimou/nz-accredited-employer-inspector) provides a history of changes.
`;

  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
