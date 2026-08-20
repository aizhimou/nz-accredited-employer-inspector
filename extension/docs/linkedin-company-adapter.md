# LinkedIn company profile adapter

## Scope

Supported URLs:

```text
https://www.linkedin.com/company/<company-slug>/
https://www.linkedin.com/company/<company-slug>/about/
https://www.linkedin.com/company/<company-slug>/{posts|jobs|life|people|insights|product}/...
```

Known public sections may contain additional nested paths, such as `/life/salesandrevenue/`. Query parameters do not affect route recognition. Admin and unknown company sections remain unsupported.

## Page contract

Primary company-name selector:

```css
main h1.org-top-card-summary__title
```

Fallback company-name selector:

```css
main h1
```

The adapter creates a block mount anchor after the complete company-title line and before the tagline or company metadata. The company heading and LinkedIn's own verified/about control therefore stay together while the widget occupies a dedicated row. Its strong platform identity is the canonical company slug: `company:<slug>`.

If the primary heading class changes, the adapter falls back to the first non-empty `main h1`. No generated Ember ID or obfuscated LinkedIn class is used.

LinkedIn may render the company header after `document_idle`. The content script therefore starts on every `www.linkedin.com` page and in all frames so it is already present when LinkedIn performs an SPA navigation into a company route. This is required when Jobs keeps the top-level company URL in a shell while rendering the real company page inside the same-origin `/preload/?_bprMode=vanilla` iframe. In that frame the adapter derives the canonical slug from the organization navigation links and waits until both identity and heading exist before creating the UI. WXT `wxt:locationchange` handling removes the UI outside supported top-level company routes and recreates it for SPA navigation. `autoMount()` restores the UI if LinkedIn rerenders the header.

## UI states

1. `Check NZ accreditation`: no network call has happened.
2. `Checking INZ…`: background orchestration is active.
3. `Confirm employer match`: D1 or live INZ returned official employer candidates, but no platform association can be assumed.
4. `Accredited in NZ` / `Accreditation expired`: the selected employer's official expiry evaluation. Selection may be a stored platform association or a unique exact employer-name match (trading name only when no employer name matches).
5. `No published INZ match`: recognised live INZ `400 No Results`; the exact platform identity/query observation is reused for the configured negative TTL and its check/expiry times are shown.
6. `Live verification needs review`: an NZBN refresh returned no published result; the old row is only dated context. A recent attempt shows when another refresh becomes available.
7. `Try again`: API, INZ, or extension background failure.

The result panel shows the selected employer and API candidates (up to 10), with legal name, optional trading name, NZBN, accreditation expiry, INZ verification date, match provenance, explicit `Use this employer` controls, and a per-row `Refresh from INZ` action. Automatic exact-name matches are labelled `Exact match` and `Not community-confirmed`; they are never presented as a community association. Manual recovery searches replace the current candidate list rather than appending another list.

## Manual verification

1. Run `npm run build` in `extension/`.
2. Open `chrome://extensions`, enable Developer mode, and load `extension/.output/chrome-mv3`.
3. Open `https://www.linkedin.com/company/onenz/`.
4. Confirm one compact control appears on its own row below the company-title line and before the tagline.
5. Click it once.
6. From `chrome://extensions`, open the extension service worker's DevTools. Background requests do not appear in the LinkedIn tab's Network panel.
7. Confirm the first call is `POST /v1/employers/resolve`.
8. For `refresh_required`, confirm `POST /v1/employers/refresh` runs first. When authorized, exactly one background INZ request is followed by positive `/ingest` or NZBN `/no-match`; during cooldown no INZ request is made.
9. For a recognised display-name `400 No Results`, confirm one `POST /v1/employers/no-match`; a repeat check inside the configured negative TTL should stop after `/resolve` and make no INZ request.
10. If candidates need confirmation, select one and confirm one `POST /v1/employers/associate` request.
11. Click `Refresh from INZ` on a candidate and confirm it targets only that NZBN without creating or changing an association.
12. Confirm accreditation, automatic exact-name match, association, and no-match provenance are labelled separately and the official INZ link opens in a new tab.
13. Navigate to `/company/onenz/about/?viewAsMember=true`; confirm the control remains mounted with the same `company:onenz` identity.
14. Navigate between supported company tabs through LinkedIn SPA navigation; confirm exactly one control is mounted.
15. Open LinkedIn Jobs search results, follow the active job's company link, and confirm the control mounts inside LinkedIn's preload frame without refreshing the company page.

The shared API and orchestration contract remains [`../../docs/extension-api-ssot.md`](../../docs/extension-api-ssot.md).
