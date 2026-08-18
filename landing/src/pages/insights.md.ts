import type { APIRoute } from "astro";
import data from "../data/insights.json";

const number = new Intl.NumberFormat("en-NZ");
const snapshotDate = new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
}).format(new Date(`${data.meta.snapshotDate}T00:00:00Z`));

function totalsBy(index: 0 | 1): Array<[string, number]> {
  const labels = index === 0 ? data.regions : data.sectors;
  const totals = new Map<number, number>();
  for (const row of data.overview) {
    totals.set(row[index], (totals.get(row[index]) ?? 0) + row[5]);
  }
  return [...totals]
    .map(([key, count]) => [labels[key], count] as [string, number])
    .sort((a, b) => b[1] - a[1]);
}

const regionLines = totalsBy(0)
  .slice(0, 10)
  .map(([label, count]) => `- ${label}: ${number.format(count)}`)
  .join("\n");
const sectorLines = totalsBy(1)
  .slice(0, 10)
  .map(([label, count]) => `- ${label}: ${number.format(count)}`)
  .join("\n");
const within90Days = data.overview
  .filter((row) => row[4] === 1 || row[4] === 2)
  .reduce((sum, row) => sum + row[5], 0);

export const GET: APIRoute = () => {
  const body = `---
title: Accredited Employer Insights
description: Aggregate view of the official New Zealand accredited employer snapshot.
snapshot_date: ${data.meta.snapshotDate}
source: Immigration New Zealand
human_readable: https://nzaei.zemo.bio/insights/
---

# Accredited Employer Insights

This page summarises ${number.format(data.meta.totalRecords)} official records published by Immigration New Zealand as at ${snapshotDate}. It is a dated snapshot, not a live guarantee of any employer's current status.

## Largest regions by record count

${regionLines}

## Largest sectors by record count

${sectorLines}

## Accreditation expiry

${number.format(within90Days)} records have an accreditation expiry date within 90 days of the snapshot date. An expiry date is not a forecast that an employer will lose accreditation; employers may renew before that date.

## Data notes

- Counts describe official records, not vacancies or available jobs.
- Region labels are normalised for case and obvious place-name variants.
- ${number.format(data.meta.unknownRegionRecords)} records with missing or non-standard regions are grouped as Unknown / other.
- The interactive page supports region, sector, and accreditation-type filters.
`;

  return new Response(body, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
};
