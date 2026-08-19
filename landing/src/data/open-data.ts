export const openDataBaseUrl = (
  import.meta.env.PUBLIC_OPEN_DATA_BASE_URL ?? "https://data.nzaei.zemo.bio"
).replace(/\/$/u, "");

export const originalOpenDataFile = {
  snapshotDate: "2026-07-27",
  title: "List of Accredited Employers as at 27 July 2026",
  source: "MBIE OIA release",
  format: "XLSX",
  rowCount: 30_255,
  nzbnCount: 30_253,
  byteSize: 2_642_699,
  sha256: "4e2668ef8121bf732b1acd77fb0fb55fe97e0de83d54381322dd8b0fc603242b",
  licence: "NOASSERTION",
  downloadUrl: `${openDataBaseUrl}/original/2026-07-27/mbie-accredited-employers.xlsx`,
} as const;

export const openDataCatalogUrl = `${openDataBaseUrl}/catalog.json`;
export const openDataSchemaUrl = `${openDataBaseUrl}/schema/employers-v1.json`;
