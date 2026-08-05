# NZ Accredited Employer Inspector extension

WXT-powered Chrome extension with page adapters for LinkedIn company homepages and SEEK New Zealand job detail pages.

The extension follows [`../docs/extension-api-ssot.md`](../docs/extension-api-ssot.md) for platform identity, API orchestration, candidate confirmation, provenance, and fields.

## Development

```bash
npm install
npm run dev
```

Load the generated Chrome extension from `.output/chrome-mv3` if WXT does not launch Chrome automatically.

To review the isolated widget without installing the extension:

```bash
npm run preview
```

Then open `http://127.0.0.1:5173/dev/preview.html`.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

Adapter contracts and manual test steps:

- [`docs/linkedin-company-adapter.md`](docs/linkedin-company-adapter.md)
- [`docs/seek-job-adapter.md`](docs/seek-job-adapter.md)
