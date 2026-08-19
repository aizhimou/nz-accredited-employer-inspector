export const openDataBaseUrl = (
  import.meta.env.PUBLIC_OPEN_DATA_BASE_URL ?? "https://data.nzaei.zemo.bio"
).replace(/\/$/u, "");

export interface OriginalFileEntry {
  snapshot_date: string | null;
  title: string;
  source: string;
  format: "XLSX";
  row_count: number | null;
  nzbn_count: number | null;
  byte_size: number;
  sha256: string | null;
  licence: "NOASSERTION";
  download_url: string;
}

export const originalOpenDataFiles: OriginalFileEntry[] = [
  {
    snapshot_date: "2025-06-02",
    title: "List of Accredited Employers as at 2 June 2025",
    source: "MBIE OIA release",
    format: "XLSX",
    row_count: 24_202,
    nzbn_count: 0,
    byte_size: 1_005_155,
    sha256: "c59d013579632121e200116a1f2a7784f62f962d7bab667e5ce62e235bcf842b",
    licence: "NOASSERTION",
    download_url: `${openDataBaseUrl}/original/2025-06-02/mbie-accredited-employers.xlsx`,
  },
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
    download_url: `${openDataBaseUrl}/original/2026-07-27/mbie-accredited-employers.xlsx`,
  },
];

export const openDataCatalogUrl = `${openDataBaseUrl}/catalog.json`;
export const openDataSchemaUrl = `${openDataBaseUrl}/schema/employers-v1.json`;
