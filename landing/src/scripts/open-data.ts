interface SnapshotEntry {
  snapshot_date: string;
  generated_at: string;
  row_count: number;
  byte_size: number;
  sha256: string;
  schema_version: number;
  csv_path: string;
  metadata_path: string;
}

interface CatalogOriginal {
  snapshot_date: string | null;
  title: string;
  source: string;
  format: "XLSX";
  row_count: number | null;
  nzbn_count: number | null;
  byte_size: number;
  sha256: string | null;
  licence: "NOASSERTION";
  download_path: string;
}

interface Catalog {
  schema_version: number;
  updated_at: string | null;
  originals: CatalogOriginal[];
  snapshots: SnapshotEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSnapshotEntry(value: unknown): value is SnapshotEntry {
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

function isOriginalEntry(value: unknown): value is CatalogOriginal {
  return isRecord(value) &&
    (value.snapshot_date === null || typeof value.snapshot_date === "string") &&
    typeof value.title === "string" &&
    typeof value.source === "string" &&
    value.format === "XLSX" &&
    (value.row_count === null || typeof value.row_count === "number") &&
    (value.nzbn_count === null || typeof value.nzbn_count === "number") &&
    typeof value.byte_size === "number" &&
    (value.sha256 === null || typeof value.sha256 === "string") &&
    value.licence === "NOASSERTION" &&
    typeof value.download_path === "string";
}

function parseCatalog(value: unknown): Catalog {
  if (!isRecord(value) ||
      typeof value.schema_version !== "number" ||
      !(value.updated_at === null || typeof value.updated_at === "string") ||
      !Array.isArray(value.originals) ||
      !value.originals.every(isOriginalEntry) ||
      !Array.isArray(value.snapshots) ||
      !value.snapshots.every(isSnapshotEntry)) {
    throw new Error("Snapshot catalog has an unexpected format.");
  }
  return {
    schema_version: value.schema_version,
    updated_at: value.updated_at,
    originals: value.originals,
    snapshots: value.snapshots,
  };
}

const dateFormatter = new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const numberFormatter = new Intl.NumberFormat("en-NZ");

function formatDate(value: string): string {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`));
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) {
    return `${Math.ceil(value / 1024)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCount(value: number | null): string {
  return value === null ? "—" : numberFormatter.format(value);
}

function formatNzbnCount(value: number | null): string {
  if (value === null) {
    return "NZBN count not recorded";
  }
  if (value === 0) {
    return "no NZBN column";
  }
  return `${numberFormatter.format(value)} with NZBN`;
}

function appendText(
  parent: HTMLElement,
  tag: "span" | "strong" | "code" | "p" | "small",
  text: string,
): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = text;
  parent.append(element);
  return element;
}

function renderSnapshot(
  snapshot: SnapshotEntry,
  catalogUrl: URL,
  detailed: boolean,
): HTMLLIElement {
  const item = document.createElement("li");
  item.className = detailed ? "snapshot-entry snapshot-entry-detailed" : "snapshot-entry";

  const date = document.createElement("time");
  date.dateTime = snapshot.snapshot_date;
  date.textContent = formatDate(snapshot.snapshot_date);
  item.append(date);

  const facts = document.createElement("div");
  facts.className = "snapshot-entry-facts";
  appendText(facts, "strong", `${numberFormatter.format(snapshot.row_count)} records`);
  appendText(facts, "span", `CSV · ${formatBytes(snapshot.byte_size)} · Schema v${snapshot.schema_version}`);
  if (detailed) {
    const checksum = appendText(facts, "code", `SHA-256 ${snapshot.sha256}`);
    checksum.title = snapshot.sha256;
  }
  item.append(facts);

  const actions = document.createElement("div");
  actions.className = "snapshot-entry-actions";
  const download = document.createElement("a");
  download.href = new URL(snapshot.csv_path, catalogUrl).href;
  download.textContent = "Download CSV";
  actions.append(download);
  if (detailed) {
    const metadata = document.createElement("a");
    metadata.href = new URL(snapshot.metadata_path, catalogUrl).href;
    metadata.textContent = "Metadata";
    actions.append(metadata);
  }
  item.append(actions);
  return item;
}

async function hydrateSnapshotList(list: HTMLElement): Promise<void> {
  const catalogValue = list.dataset.catalogUrl;
  if (catalogValue === undefined) {
    return;
  }
  const status = list.parentElement?.querySelector<HTMLElement>("[data-open-data-status]");
  try {
    const catalogUrl = new URL(catalogValue, window.location.href);
    const response = await fetch(catalogUrl, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`Catalog returned ${response.status}.`);
    }
    const catalog = parseCatalog(await response.json());
    const requestedLimit = Number.parseInt(list.dataset.limit ?? "", 10);
    const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
      ? requestedLimit
      : catalog.snapshots.length;
    const snapshots = catalog.snapshots.slice(0, limit);
    list.replaceChildren(...snapshots.map((snapshot) =>
      renderSnapshot(snapshot, catalogUrl, list.dataset.detailed === "true")
    ));
    if (status !== null && status !== undefined) {
      status.textContent = snapshots.length === 0
        ? "The first generated snapshot has not been published yet."
        : `${snapshots.length === 1 ? "One snapshot" : `${snapshots.length} snapshots`} shown.`;
    }
  } catch {
    if (status !== null && status !== undefined) {
      status.textContent = "The snapshot catalog is temporarily unavailable. Try again shortly.";
    }
  }
}

function renderOriginalCard(original: CatalogOriginal, catalogUrl: URL): HTMLElement {
  const article = document.createElement("article");
  article.className = "original-file";

  const stamp = document.createElement("div");
  stamp.className = "file-stamp";
  appendText(stamp, "span", "Original source");
  appendText(stamp, "strong", "As received");
  article.append(stamp);

  const copy = document.createElement("div");
  copy.className = "original-file-copy";
  appendText(copy, "p", original.source).className = "file-source";
  const title = document.createElement("h3");
  title.textContent = original.title;
  copy.append(title);
  const meta = appendText(copy, "p", `${formatCount(original.row_count)} rows · ${formatNzbnCount(original.nzbn_count)} · XLSX · ${formatBytes(original.byte_size)}`);
  meta.className = "original-file-meta";
  if (original.sha256 !== null) {
    const checksum = appendText(copy, "code", `SHA-256 ${original.sha256}`);
    checksum.title = original.sha256;
  }
  article.append(copy);

  const button = document.createElement("a");
  button.className = "button button-secondary";
  button.href = new URL(original.download_path, catalogUrl).href;
  button.textContent = "Download original XLSX";
  article.append(button);
  return article;
}

function renderOriginalCompact(original: CatalogOriginal, catalogUrl: URL): HTMLElement {
  const entry = document.createElement("div");
  entry.className = "original-release";
  const label = document.createElement("span");
  label.textContent = "Original source · As received";
  entry.append(label);

  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = original.title;
  copy.append(title);
  appendText(copy, "small", `${formatCount(original.row_count)} records · XLSX · ${formatBytes(original.byte_size)}`);
  entry.append(copy);

  const link = document.createElement("a");
  link.href = new URL(original.download_path, catalogUrl).href;
  link.textContent = "Download XLSX";
  entry.append(link);
  return entry;
}

async function hydrateOriginalList(list: HTMLElement): Promise<void> {
  const catalogValue = list.dataset.catalogUrl;
  if (catalogValue === undefined) {
    return;
  }
  const status = list.parentElement?.querySelector<HTMLElement>("[data-open-data-original-status]");
  try {
    const catalogUrl = new URL(catalogValue, window.location.href);
    const response = await fetch(catalogUrl, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`Catalog returned ${response.status}.`);
    }
    const catalog = parseCatalog(await response.json());
    const requestedLimit = Number.parseInt(list.dataset.limit ?? "", 10);
    const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
      ? requestedLimit
      : catalog.originals.length;
    const originals = catalog.originals.slice(0, limit);
    const card = list.dataset.variant === "card";
    list.replaceChildren(...originals.map((original) =>
      card ? renderOriginalCard(original, catalogUrl) : renderOriginalCompact(original, catalogUrl)
    ));
    if (status !== null && status !== undefined) {
      status.textContent = originals.length === 0
        ? "No original source files have been uploaded yet."
        : `${originals.length === 1 ? "One original file" : `${originals.length} original files`} listed.`;
    }
  } catch {
    if (status !== null && status !== undefined) {
      status.textContent = "The original file register is temporarily unavailable. Try again shortly.";
    }
  }
}

for (const list of document.querySelectorAll<HTMLElement>("[data-open-data-snapshot-list]")) {
  void hydrateSnapshotList(list);
}
for (const list of document.querySelectorAll<HTMLElement>("[data-open-data-original-list]")) {
  void hydrateOriginalList(list);
}
