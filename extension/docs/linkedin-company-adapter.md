# LinkedIn company homepage adapter

## Scope

Supported URLs:

```text
https://www.linkedin.com/company/<company-slug>/
```

The first version intentionally does not inject on `/about`, `/posts`, `/jobs`, `/life`, `/people`, `/insights`, or admin URLs.

## Page contract

Primary company-name selector:

```css
main h1.org-top-card-summary__title
```

Fallback company-name selector:

```css
main h1
```

The adapter creates its own inline mount anchor immediately after the company heading and mounts the Shadow DOM UI inside it. This avoids coupling the widget to LinkedIn's tagline class while keeping the control beside the company title. Its strong platform identity is the canonical company slug: `company:<slug>`.

If the primary heading class changes, the adapter falls back to the first non-empty `main h1`. No generated Ember ID or obfuscated LinkedIn class is used.

LinkedIn may render the company header after `document_idle`. The adapter therefore observes the page until the heading exists before creating the WXT UI. WXT `wxt:locationchange` handling removes the UI outside the company homepage and recreates it for SPA navigation to another company homepage. `autoMount()` restores the UI if LinkedIn rerenders the header.

## UI states

1. `Check NZ accreditation`: no network call has happened.
2. `Checking INZ…`: background orchestration is active.
3. `Confirm employer match`: D1 or live INZ returned official employer candidates, but no platform association can be assumed.
4. `Accredited in NZ` / `Accreditation expired`: the associated employer's official expiry evaluation.
5. `No published INZ match`: recognised live INZ `400 No Results`; the exact platform identity/query observation is reused for 24 hours and its check/expiry times are shown.
6. `Live verification needs review`: an associated NZBN could not be republished by INZ; the old row is only dated context.
7. `Try again`: API, INZ, or extension background failure.

The result panel shows the associated employer and all API candidates (up to 50), with legal name, optional trading name, NZBN, accreditation expiry, INZ verification date, association provenance, and explicit `Use this employer` controls.

## Manual verification

1. Run `npm run build` in `extension/`.
2. Open `chrome://extensions`, enable Developer mode, and load `extension/.output/chrome-mv3`.
3. Open `https://www.linkedin.com/company/onenz/`.
4. Confirm one compact control appears beside the company title, before the tagline.
5. Click it once.
6. From `chrome://extensions`, open the extension service worker's DevTools. Background requests do not appear in the LinkedIn tab's Network panel.
7. Confirm the first call is `POST /v1/employers/resolve`.
8. If the response is `inz_lookup_required` or `refresh_required`, confirm exactly one background INZ request is followed by `POST /v1/employers/ingest` only for a positive payload.
9. For a recognised display-name `400 No Results`, confirm one `POST /v1/employers/no-match`; a repeat check within 24 hours should stop after `/resolve` and make no INZ request.
10. If candidates need confirmation, select one and confirm one `POST /v1/employers/associate` request.
11. Confirm accreditation, association, and no-match provenance are labelled separately and the official INZ link opens in a new tab.
12. Navigate to `/company/onenz/about/`; confirm the control is removed.
13. Navigate back through LinkedIn SPA navigation; confirm exactly one control is mounted.

The shared API and orchestration contract remains [`../../docs/extension-api-ssot.md`](../../docs/extension-api-ssot.md).
