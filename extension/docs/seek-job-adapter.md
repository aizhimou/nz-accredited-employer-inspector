# SEEK job detail adapter

## Scope

Supported URLs:

```text
https://nz.seek.com/job/<numeric-job-id>
```

## Page contract

Company-name selector:

```css
[data-automation="advertiser-name"]
```

The adapter uses SEEK's stable `data-automation` attribute rather than generated CSS classes. It creates an inline mount anchor immediately after the advertiser control, placing the accreditation button beside the employer name.

Identity rules:

- If the advertiser element links to `/companies/<slug-or-id>`, use the profile pathname as a strong `seek_company_profile` identity.
- Otherwise use the normalised advertiser name as a weak `seek_advertiser_name` identity. The UI labels that association as name-based and always allows another candidate to be selected.

The shared adapter harness waits for asynchronous rendering, restores the Shadow DOM UI after a rerender, and responds to WXT `wxt:locationchange` events during SPA navigation.

## Manual verification

1. Run `npm run build` in `extension/`.
2. Reload `extension/.output/chrome-mv3` from `chrome://extensions`.
3. Open `https://nz.seek.com/job/93674490`.
4. Confirm `Check NZ accreditation` appears beside `Marsello`.
5. Click the control once.
6. Inspect requests from the extension service worker DevTools, not the SEEK tab's Network panel.
7. Confirm the first call is `POST /v1/employers/resolve`.
8. If live verification is required, confirm exactly one INZ call and one positive-only `POST /v1/employers/ingest`.
9. For recognised display-name `400 No Results`, confirm `/no-match` stores the exact strong/weak SEEK identity and a repeat check within 24 hours does not call INZ.
10. Confirm choosing a candidate calls `POST /v1/employers/associate` and the selected NZBN is shown as community association data.
