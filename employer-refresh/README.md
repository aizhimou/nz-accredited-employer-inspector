# Expiring employer refresh

This local Node.js script refreshes employers whose accreditation expiry date is on or before
the current Auckland date plus seven calendar days. It queries INZ sequentially, with at least
three seconds between completed lookups, and updates the production D1 database directly.

It does not run in Cloudflare Workers and does not call the public extension API.

## Requirements

- Node.js 22 or newer
- A Cloudflare API token with D1 read and write access for the target account
- The Cloudflare account ID and D1 database ID

## Configure

From the repository root:

```sh
cp employer-refresh/.env.example employer-refresh/.env.local
```

Fill in these required values:

```dotenv
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_D1_DATABASE_ID=...
```

For a small first run, uncomment `MAX_EMPLOYERS=10`. Environment files are ignored by Git.

## Run

```sh
node --env-file=employer-refresh/.env.local \
  employer-refresh/refresh-expiring-employers.mjs
```

The script loads one snapshot of eligible employers, claims each row before calling INZ, and
prints a final count of positive, no-result, failed, and skipped outcomes. Press `Ctrl+C` once to
finish the current employer and stop cleanly.

Positive results replace the latest INZ name, trading name, and expiry fields. A recognized INZ
`400 No Results` response keeps the last positive employer record, records `no_result`, and applies
a 24-hour cooldown. Network errors and unexpected responses leave the 15-minute claim lease in
place so a later run can retry safely.

## Test

The tests are offline and do not access INZ or Cloudflare:

```sh
node --test employer-refresh/refresh-expiring-employers.test.mjs
```
