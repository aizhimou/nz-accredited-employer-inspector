# LinkedIn job adapter

## Scope

Supported URLs:

```text
https://www.linkedin.com/jobs/search-results/
https://www.linkedin.com/jobs/view/<numeric-job-id>/
https://www.linkedin.com/comm/jobs/search-results/
https://www.linkedin.com/comm/jobs/view/<numeric-job-id>/
```

The `/comm/jobs/...` routes are LinkedIn email entry points that replace their URL with the corresponding `/jobs/...` route after the document starts. Supporting both forms ensures the content script is present before that SPA canonicalisation. All supported routes accept an optional trailing slash and any query parameters, including `currentJobId`. Other LinkedIn job routes remain unsupported.

## Page contract

On search results, the adapter locates the current right-hand job detail header through two semantic links:

```css
main a[href*="/jobs/view/"]
a[href*="/company/"]
```

The job link must have the canonical `/jobs/view/<numeric-id>/` path. The company link must be inside the same detail header and resolve to a supported LinkedIn company profile URL. Generated LinkedIn classes are not part of the contract.

On a direct job page, the adapter finds the canonical company link in the main job header and inserts the mount anchor immediately after the company-name row and before the job title. On search results, it inserts the anchor immediately after the job-title row and before the location metadata. It derives the same strong `company:<slug>` identity used on company pages, so results and community associations are shared across both surfaces.

The shared adapter observes asynchronous rendering and remounts after LinkedIn SPA navigation, when choosing another search result changes the visible employer, and when LinkedIn replaces a header with a second render of the same employer. It compares both the live mount anchor and the mounted Shadow host, so the UI is recovered when LinkedIn replaces the anchor or clears only its children even when the company identity did not change.

## Manual verification

1. Run `npm run build` in `extension/` and reload the unpacked extension.
2. Open `https://www.linkedin.com/jobs/search-results/?currentJobId=<job-id>`.
3. Confirm one compact control appears in the right-hand detail header, directly below the job title and above the location metadata.
4. Change the selected job and confirm the control remounts once with the new company identity.
5. Open `https://www.linkedin.com/jobs/view/<job-id>/` and confirm one control appears below the company name and above the job title.
6. From the direct job page, choose several items in More jobs. Confirm the resulting search detail card retains one control after the detail header finishes rendering.
7. Open a LinkedIn job-alert email and follow a job card whose href starts with `/comm/jobs/view/`. Confirm the control mounts without refreshing the resulting `/jobs/view/` page.
8. Change or remove unrelated URL query parameters and confirm the adapter remains active.
9. Navigate to `/jobs/` and confirm this adapter is not mounted.

The shared API and orchestration contract remains [`../../docs/extension-api-ssot.md`](../../docs/extension-api-ssot.md).
