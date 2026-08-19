import { getAucklandDate, getExpiryDate } from "./time";

const CATALOG_KEY = "catalog.json";
const SCHEMA_VERSION = 1;
const PUBLICATION_INTERVAL_MS = 72 * 60 * 60 * 1000;
const QUERY_PAGE_SIZE = 2_000;
const MAX_SNAPSHOT_ROWS = 100_000;
const MAX_CSV_BYTES = 32 * 1024 * 1024;
const MAX_ROW_COUNT_CHANGE_RATIO = 0.25;
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const CATALOG_CACHE_CONTROL = "public, max-age=300";

type VerificationSource = "inz_live_lookup" | "inz_official_import";

interface EmployerSnapshotRow {
  employer_name: string;
  trading_name: string | null;
  nzbn: string;
  expiry_date_of_accreditation: string;
  last_verified_at: number;
  last_verified_source: VerificationSource;
  accreditation_type: string | null;
  sector: string | null;
  subsector: string | null;
  accreditation_start_date: string | null;
  region: string | null;
  city: string | null;
  official_snapshot_date: string | null;
}

export interface OpenDataSnapshotEntry {
  snapshot_date: string;
  generated_at: string;
  row_count: number;
  byte_size: number;
  sha256: string;
  schema_version: number;
  csv_path: string;
  metadata_path: string;
}

interface OpenDataOriginalEntry {
  snapshot_date: string;
  title: string;
  source: string;
  format: "XLSX";
  row_count: number;
  nzbn_count: number;
  byte_size: number;
  sha256: string;
  licence: "NOASSERTION";
  download_path: string;
}

export interface OpenDataCatalog {
  schema_version: number;
  updated_at: string | null;
  originals: OpenDataOriginalEntry[];
  snapshots: OpenDataSnapshotEntry[];
}

interface SnapshotMetadata extends OpenDataSnapshotEntry {
  title: string;
  description: string;
  cadence: string;
  status_method: string;
  source_table: string;
  schema_path: string;
  licence: "NOASSERTION";
}

interface PublicationResult {
  status: "published" | "not_due";
  snapshotDate?: string;
  rowCount?: number;
  byteSize?: number;
}

const ORIGINAL_FILES: OpenDataOriginalEntry[] = [
  {
    snapshot_date: "2026-07-27",
    title: "List of Accredited Employers as at 27 July 2026",
    source: "MBIE OIA release",
    format: "XLSX",
    row_count: 30_255,
    nzbn_count: 30_253,
    byte_size: 2_642_699,
    sha256: "4e2668ef8121bf732b1acd77fb0fb55fe97e0de83d54381322dd8b0fc603242b",
    licence: "NOASSERTION",
    download_path: "/original/2026-07-27/mbie-accredited-employers.xlsx",
  },
];

export const OPEN_DATA_SCHEMA = {
  title: "NZ Accredited Employer Inspector employer records snapshot",
  schema_version: SCHEMA_VERSION,
  format: "CSV",
  encoding: "UTF-8 with BOM",
  columns: [
    { name: "employer_name", type: "string", nullable: false, source: "Latest accepted INZ verification" },
    { name: "trading_name", type: "string", nullable: true, source: "Latest accepted INZ verification" },
    { name: "nzbn", type: "string", nullable: false, source: "Latest accepted INZ verification" },
    { name: "expiry_date_of_accreditation", type: "date", nullable: false, source: "Latest accepted INZ verification" },
    { name: "status_as_at_snapshot", type: "string", nullable: false, source: "Derived from expiry date using the Pacific/Auckland calendar" },
    { name: "last_verified_at", type: "datetime", nullable: false, source: "Inspector acceptance time in UTC" },
    { name: "last_verified_source", type: "string", nullable: false, source: "Inspector provenance" },
    { name: "accreditation_type", type: "string", nullable: true, source: "Most recent MBIE OIA snapshot imported for this employer" },
    { name: "sector", type: "string", nullable: true, source: "Most recent MBIE OIA snapshot imported for this employer" },
    { name: "subsector", type: "string", nullable: true, source: "Most recent MBIE OIA snapshot imported for this employer" },
    { name: "accreditation_start_date", type: "date", nullable: true, source: "Most recent MBIE OIA snapshot imported for this employer" },
    { name: "region", type: "string", nullable: true, source: "Most recent MBIE OIA snapshot imported for this employer" },
    { name: "city", type: "string", nullable: true, source: "Most recent MBIE OIA snapshot imported for this employer" },
    { name: "official_snapshot_date", type: "date", nullable: true, source: "Date of the MBIE OIA snapshot supplying enrichment fields" },
  ],
} as const;

const CSV_HEADERS = OPEN_DATA_SCHEMA.columns.map((column) => column.name);

export function createEmptyCatalog(): OpenDataCatalog {
  return {
    schema_version: SCHEMA_VERSION,
    updated_at: null,
    originals: ORIGINAL_FILES,
    snapshots: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSnapshotEntry(value: unknown): value is OpenDataSnapshotEntry {
  return isRecord(value) &&
    typeof value.snapshot_date === "string" &&
    typeof value.generated_at === "string" &&
    typeof value.row_count === "number" &&
    typeof value.byte_size === "number" &&
    typeof value.sha256 === "string" &&
    typeof value.schema_version === "number" &&
    typeof value.csv_path === "string" &&
    typeof value.metadata_path === "string";
}

function parseCatalog(value: unknown): OpenDataCatalog {
  if (!isRecord(value) ||
      value.schema_version !== SCHEMA_VERSION ||
      !(value.updated_at === null || typeof value.updated_at === "string") ||
      !Array.isArray(value.originals) ||
      !Array.isArray(value.snapshots) ||
      !value.snapshots.every(isSnapshotEntry)) {
    throw new Error("The existing open-data catalog is invalid.");
  }
  return {
    schema_version: SCHEMA_VERSION,
    updated_at: value.updated_at,
    originals: ORIGINAL_FILES,
    snapshots: value.snapshots,
  };
}

export function isPublicationDue(
  catalog: OpenDataCatalog,
  scheduledTime: number,
): boolean {
  const latest = catalog.snapshots[0];
  if (latest === undefined) {
    return true;
  }
  const lastPublishedAt = Date.parse(latest.generated_at);
  if (!Number.isFinite(lastPublishedAt)) {
    throw new Error("The latest catalog publication time is invalid.");
  }
  return scheduledTime - lastPublishedAt >= PUBLICATION_INTERVAL_MS;
}

function csvCell(value: string | null): string {
  return `"${(value ?? "").replaceAll('"', '""')}"`;
}

function dateOnly(value: string | null, fieldName: string): string | null {
  if (value === null) {
    return null;
  }
  const parsed = getExpiryDate(value);
  if (parsed === null) {
    throw new Error(`${fieldName} is not a valid database date.`);
  }
  return parsed;
}

function validateRow(row: EmployerSnapshotRow): void {
  if (row.employer_name.trim() === "") {
    throw new Error("An employer row has an empty employer name.");
  }
  if (!/^\d{13}$/u.test(row.nzbn)) {
    throw new Error(`Employer row has an invalid NZBN: ${row.nzbn}`);
  }
  if (!Number.isSafeInteger(row.last_verified_at) || row.last_verified_at <= 0) {
    throw new Error(`Employer ${row.nzbn} has an invalid verification time.`);
  }
  if (row.last_verified_source !== "inz_live_lookup" &&
      row.last_verified_source !== "inz_official_import") {
    throw new Error(`Employer ${row.nzbn} has an invalid verification source.`);
  }
}

export function buildSnapshotCsv(
  rows: readonly EmployerSnapshotRow[],
  snapshotDate: string,
): Uint8Array {
  const lines = [`\uFEFF${CSV_HEADERS.map(csvCell).join(",")}`];
  for (const row of rows) {
    validateRow(row);
    const expiryDate = dateOnly(
      row.expiry_date_of_accreditation,
      "expiry_date_of_accreditation",
    );
    if (expiryDate === null) {
      throw new Error(`Employer ${row.nzbn} has no accreditation expiry date.`);
    }
    const values = [
      row.employer_name,
      row.trading_name,
      row.nzbn,
      expiryDate,
      expiryDate >= snapshotDate ? "accredited" : "expired",
      new Date(row.last_verified_at * 1000).toISOString(),
      row.last_verified_source,
      row.accreditation_type,
      row.sector,
      row.subsector,
      dateOnly(row.accreditation_start_date, "accreditation_start_date"),
      row.region,
      row.city,
      dateOnly(row.official_snapshot_date, "official_snapshot_date"),
    ];
    lines.push(values.map(csvCell).join(","));
  }
  const bytes = new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);
  if (bytes.byteLength > MAX_CSV_BYTES) {
    throw new Error(`Open-data CSV exceeds the ${MAX_CSV_BYTES}-byte safety limit.`);
  }
  return bytes;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function assertReasonableRowCount(
  rowCount: number,
  catalog: OpenDataCatalog,
): void {
  if (rowCount < 1 || rowCount > MAX_SNAPSHOT_ROWS) {
    throw new Error(`Open-data row count ${rowCount} is outside the safety limits.`);
  }
  const previous = catalog.snapshots[0]?.row_count;
  if (previous === undefined) {
    return;
  }
  const ratio = Math.abs(rowCount - previous) / previous;
  if (ratio > MAX_ROW_COUNT_CHANGE_RATIO) {
    throw new Error(
      `Open-data row count changed by ${(ratio * 100).toFixed(1)}%; publication stopped for review.`,
    );
  }
}

async function readAllEmployerRows(db: D1Database): Promise<EmployerSnapshotRow[]> {
  const rows: EmployerSnapshotRow[] = [];
  let cursor = "";
  while (true) {
    const page = await db
      .prepare(
        `SELECT employer_name, trading_name, nzbn,
                expiry_date_of_accreditation,
                last_verified_at, last_verified_source,
                accreditation_type, sector, subsector,
                accreditation_start_date, region, city,
                official_snapshot_date
           FROM employers
          WHERE nzbn > ?1
          ORDER BY nzbn
          LIMIT ${QUERY_PAGE_SIZE}`,
      )
      .bind(cursor)
      .all<EmployerSnapshotRow>();
    rows.push(...page.results);
    if (rows.length > MAX_SNAPSHOT_ROWS) {
      throw new Error(`Open-data snapshot exceeds ${MAX_SNAPSHOT_ROWS} rows.`);
    }
    const last = page.results.at(-1);
    if (last === undefined || page.results.length < QUERY_PAGE_SIZE) {
      return rows;
    }
    cursor = last.nzbn;
  }
}

async function readCatalog(bucket: R2Bucket): Promise<{
  catalog: OpenDataCatalog;
  etag: string | null;
}> {
  const object = await bucket.get(CATALOG_KEY);
  if (object === null) {
    return { catalog: createEmptyCatalog(), etag: null };
  }
  return {
    catalog: parseCatalog(await object.json<unknown>()),
    etag: object.etag,
  };
}

async function putImmutable(
  bucket: R2Bucket,
  key: string,
  value: ArrayBuffer | ArrayBufferView | string,
  httpMetadata: R2HTTPMetadata,
  sha256?: ArrayBuffer,
): Promise<void> {
  await bucket.put(key, value, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata,
    ...(sha256 === undefined ? {} : { sha256 }),
  });
}

async function writeCatalog(
  bucket: R2Bucket,
  priorEtag: string | null,
  catalog: OpenDataCatalog,
): Promise<void> {
  const result = await bucket.put(
    CATALOG_KEY,
    `${JSON.stringify(catalog, null, 2)}\n`,
    {
      onlyIf: priorEtag === null
        ? { etagDoesNotMatch: "*" }
        : { etagMatches: priorEtag },
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        cacheControl: CATALOG_CACHE_CONTROL,
      },
    },
  );
  if (result === null) {
    throw new Error("The open-data catalog changed during publication.");
  }
}

export async function publishOpenDataSnapshot(
  db: D1Database,
  bucket: R2Bucket,
  scheduledTime: number,
): Promise<PublicationResult> {
  const { catalog, etag } = await readCatalog(bucket);
  if (!isPublicationDue(catalog, scheduledTime)) {
    return { status: "not_due" };
  }

  const snapshotDate = getAucklandDate(scheduledTime);
  const generatedAt = new Date(scheduledTime).toISOString();
  const rows = await readAllEmployerRows(db);
  assertReasonableRowCount(rows.length, catalog);
  const csv = buildSnapshotCsv(rows, snapshotDate);
  const sha256Bytes = await crypto.subtle.digest("SHA-256", csv);
  const sha256 = bytesToHex(sha256Bytes);
  const basePath = `snapshots/${snapshotDate}`;
  const csvPath = `/${basePath}/employers.csv`;
  const metadataPath = `/${basePath}/metadata.json`;
  const entry: OpenDataSnapshotEntry = {
    snapshot_date: snapshotDate,
    generated_at: generatedAt,
    row_count: rows.length,
    byte_size: csv.byteLength,
    sha256,
    schema_version: SCHEMA_VERSION,
    csv_path: csvPath,
    metadata_path: metadataPath,
  };
  const metadata: SnapshotMetadata = {
    ...entry,
    title: "NZ Accredited Employer Inspector employer records snapshot",
    description: "A dated public projection of employer records accepted by the Inspector.",
    cadence: "Normally published every three days",
    status_method: "Derived from accreditation expiry using the Pacific/Auckland calendar date",
    source_table: "employers",
    schema_path: `/schema/employers-v${SCHEMA_VERSION}.json`,
    licence: "NOASSERTION",
  };

  await putImmutable(
    bucket,
    `${basePath}/employers.csv`,
    csv,
    {
      contentType: "text/csv; charset=utf-8",
      contentDisposition: `attachment; filename="nzaei-employer-records-${snapshotDate}.csv"`,
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    },
    sha256Bytes,
  );
  await putImmutable(
    bucket,
    `${basePath}/metadata.json`,
    `${JSON.stringify(metadata, null, 2)}\n`,
    {
      contentType: "application/json; charset=utf-8",
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    },
  );
  await putImmutable(
    bucket,
    `schema/employers-v${SCHEMA_VERSION}.json`,
    `${JSON.stringify(OPEN_DATA_SCHEMA, null, 2)}\n`,
    {
      contentType: "application/schema+json; charset=utf-8",
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    },
  );

  const nextCatalog: OpenDataCatalog = {
    ...catalog,
    updated_at: generatedAt,
    snapshots: [
      entry,
      ...catalog.snapshots.filter((item) => item.snapshot_date !== snapshotDate),
    ].sort((left, right) => right.snapshot_date.localeCompare(left.snapshot_date)),
  };
  await writeCatalog(bucket, etag, nextCatalog);
  return {
    status: "published",
    snapshotDate,
    rowCount: rows.length,
    byteSize: csv.byteLength,
  };
}
