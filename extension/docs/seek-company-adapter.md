# SEEK company profile adapter

## Scope

Supported URLs:

```text
https://nz.seek.com/companies/<company-slug>
https://nz.seek.com/companies/<company-slug>/culture
https://nz.seek.com/companies/<company-slug>/jobs
https://nz.seek.com/companies/<company-slug>/reviews
https://nz.seek.com/companies/<company-slug>/salaries
```

## Page contract

SEEK does not expose a stable `data-automation` attribute for the visible company name. The adapter finds the canonical company-name link by requiring all of the following:

- its URL equals the canonical `/companies/<company-slug>` path;
- its text is non-empty;
- its immediate container is a flex container with only the company-name link before injection.

The sticky duplicate uses a different container structure and is ignored. The adapter places the Shadow DOM mount anchor immediately after the company-name link without changing the container's native layout styles. SEEK's existing column layout therefore renders the accreditation control on a dedicated, left-aligned second line. A small block-start margin separates the control from the linked title and its underline.

Identity is always strong:

```ts
{
  platform: "seek",
  externalKey: "company:/companies/<company-slug>",
  kind: "seek_company_profile",
  strength: "strong",
  displayName: "<visible company name>",
  publicUrl: "https://nz.seek.com/companies/<company-slug>"
}
```

All company sub-routes resolve to the same canonical identity and public URL.

## Manual verification

1. Run `npm run build` in `extension/`.
2. Reload `extension/.output/chrome-mv3` from `chrome://extensions`.
3. Open `https://nz.seek.com/companies/westpac-bank-171714208415050`.
4. Confirm one `Check NZ accreditation` control appears on a dedicated line immediately below `Westpac Bank`, without changing the title alignment.
5. Click it and confirm the first request is `POST /v1/employers/resolve` with `company:/companies/westpac-bank-171714208415050`.
6. Confirm the normal positive, candidate confirmation, exact-name, negative, and refresh flows behave identically to the shared contract.
7. Navigate between About, Life & Culture, Jobs, Salaries, and Reviews and confirm the control remounts once with the same identity.

The shared API and orchestration contract remains [`../../docs/extension-api-ssot.md`](../../docs/extension-api-ssot.md).
