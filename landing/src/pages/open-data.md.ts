import type { APIRoute } from "astro";

const dataBaseUrl = (
  import.meta.env.PUBLIC_OPEN_DATA_BASE_URL ?? "https://data.nzaei.zemo.bio"
).replace(/\/$/u, "");

export const GET: APIRoute = () => {
  const body = `---
title: Open Data
description: Dated downloadable employer-record snapshots and original MBIE source files.
language: en-NZ
licence: NOASSERTION
---

# NZ Accredited Employer Inspector open data

The project publishes static, immutable files for direct download. It does not provide a public data API.

## Download catalog

- [Snapshot catalog](${dataBaseUrl}/catalog.json)
- [Employer snapshot schema v1](${dataBaseUrl}/schema/employers-v1.json)
- [Original MBIE OIA workbook dated 2 June 2025](${dataBaseUrl}/original/2025-06-02/mbie-accredited-employers.xlsx)
- [Original MBIE OIA workbook dated 27 July 2026](${dataBaseUrl}/original/2026-07-27/mbie-accredited-employers.xlsx)

The catalog lists every file uploaded under the public bucket's original/ directory, so future releases appear without a code change.

Generated employer-record snapshots are normally published every three days. Each CSV has a dated path, a matching metadata file, a row count, a schema version, and a SHA-256 checksum. Published snapshot files are not overwritten.

## Public snapshot fields

- employer_name
- trading_name
- nzbn
- expiry_date_of_accreditation
- status_as_at_snapshot
- last_verified_at
- last_verified_source
- accreditation_type
- sector
- subsector
- accreditation_start_date
- region
- city
- official_snapshot_date

Names, NZBN, accreditation expiry, verification time, and verification source reflect the latest accepted INZ verification held by the Inspector. Accreditation type, sector, subsector, start date, region, and city come from the most recent imported MBIE OIA snapshot for that employer. status_as_at_snapshot is derived from the expiry date using the Pacific/Auckland calendar date.

## Excluded data

Snapshots exclude normalised search fields, search indexes, refresh controls, extension installation hashes, LinkedIn and SEEK platform identities, community confirmations, association counts, temporary no-match observations, and waitlist records.

## Publication method

1. Select a fixed allowlist of public fields from the production employers table.
2. Validate identifiers, dates, row count, and output size.
3. Generate a stable NZBN-ordered UTF-8 CSV.
4. Publish the immutable CSV and metadata files.
5. Update the static catalog only after the release files succeed.

## Reuse status

The original workbook was released by MBIE under the Official Information Act, but no explicit reuse licence accompanied the supplied file. Its licence is recorded as NOASSERTION. Generated snapshots currently use the same status while source reuse rights are clarified.

Suggested attribution: NZ Accredited Employer Inspector, Employer Records Snapshot, [snapshot date]. Source data includes Immigration New Zealand information released by MBIE.

## Disclaimer

These files are dated observations, not a live or complete official register. Records may be stale, incomplete, or incorrect. An expiry or no-match observation is not proof of an employer's current accreditation status. Verify important decisions with Immigration New Zealand or the employer. This independent project is not an INZ product and does not provide immigration or legal advice.
`;

  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
