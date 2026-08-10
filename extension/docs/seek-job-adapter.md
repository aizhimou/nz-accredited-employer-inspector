# SEEK job detail, search results, and homepage sidebar adapter

## Scope

Supported URLs:

```text
https://nz.seek.com/job/<numeric-job-id>
https://nz.seek.com/
https://nz.seek.com/jobs[/...]
https://nz.seek.com/<keyword>-jobs[/...]
https://nz.seek.com/jobs-in-<classification>[/...]
```

## Page contract

Company-name selector:

```css
[data-automation="advertiser-name"]
```

The adapter scopes this selector to the header containing `[data-automation="job-detail-title"]`, so a homepage recommendation or search-result card cannot be mistaken for the open detail pane. It uses SEEK's stable `data-automation` attributes rather than generated CSS classes. The employer control and `View all jobs` remain in SEEK's own row; the adapter creates a block mount anchor as the next child of the same vertical heading group. The accreditation button therefore occupies a dedicated row immediately below the company row on every supported surface.

Identity rules:

- If the advertiser element links to `/companies/<slug-or-id>`, use the profile pathname as a strong `seek_company_profile` identity.
- Otherwise use the normalised advertiser name as a weak `seek_advertiser_name` identity. The UI labels that association as name-based and always allows another candidate to be selected.

The shared adapter harness waits for asynchronous rendering, restores the Shadow DOM UI after a rerender, responds to WXT `wxt:locationchange` events during SPA navigation, and remounts when the active employer identity changes without a URL change. That last case is required when switching recommended jobs or search-result cards.

## Manual verification

1. Run `npm run build` in `extension/`.
2. Reload `extension/.output/chrome-mv3` from `chrome://extensions`.
3. Open `https://nz.seek.com/job/93674490`.
4. Confirm `Check NZ accreditation` appears on its own row immediately below `Marsello` and `View all jobs`.
5. Click the control once.
6. Inspect requests from the extension service worker DevTools, not the SEEK tab's Network panel.
7. Confirm the first call is `POST /v1/employers/resolve`.
8. If live verification is required, confirm exactly one INZ call and one positive-only `POST /v1/employers/ingest`.
9. For recognised display-name `400 No Results`, confirm `/no-match` stores the exact strong/weak SEEK identity and a repeat check inside the configured negative TTL does not call INZ.
10. Confirm choosing a candidate calls `POST /v1/employers/associate` and the selected NZBN is shown as community association data.
11. For a sole candidate whose official `employerName` exactly equals the SEEK advertiser name after normalisation, confirm the result is shown directly as `Exact match` and `Not community-confirmed`, with no `/associate` call.
12. Open `https://nz.seek.com/`, click a Recommended job, and confirm the control appears on its own row immediately below the employer row in the sidebar header.
13. Select a different Recommended job without closing the sidebar and confirm the widget resets to the new advertiser identity without reloading the page.
14. Close and reopen the sidebar and confirm the widget is removed and restored with no duplicate controls.
15. Open `/jobs`, `/rush-jobs`, and `/Java-Developer-jobs`, select different result cards, and confirm the same stacked widget placement and identity reset behaviour in the right-hand detail pane.
