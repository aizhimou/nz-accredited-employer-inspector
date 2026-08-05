const COMPANY_PATH =
  /^\/company\/([a-z0-9][a-z0-9-]{0,99})(?:\/([^/]+)(?:\/.*)?)?\/?$/iu;
const PUBLIC_COMPANY_SECTIONS = new Set([
  "about",
  "insights",
  "jobs",
  "life",
  "people",
  "posts",
  "product",
]);
const JOB_SEARCH_RESULTS_PATH = /^\/jobs\/search-results\/?$/u;
const JOB_VIEW_PATH = /^\/jobs\/view\/\d+\/?$/u;

export type LinkedInJobSurface = "search-results" | "view";

export function getLinkedInCompanySlug(url: URL): string | null {
  if (url.hostname !== "www.linkedin.com") {
    return null;
  }

  const match = url.pathname.match(COMPANY_PATH);
  const slug = match?.[1]?.toLowerCase();
  const section = match?.[2]?.toLowerCase();
  if (
    slug === undefined ||
    (section !== undefined && !PUBLIC_COMPANY_SECTIONS.has(section))
  ) {
    return null;
  }

  return slug;
}

export function isLinkedInJobSearchResults(url: URL): boolean {
  return getLinkedInJobSurface(url) === "search-results";
}

export function getLinkedInJobSurface(url: URL): LinkedInJobSurface | null {
  if (url.hostname !== "www.linkedin.com") {
    return null;
  }

  const pathname = url.pathname.startsWith("/comm/jobs/")
    ? url.pathname.slice("/comm".length)
    : url.pathname;

  if (JOB_SEARCH_RESULTS_PATH.test(pathname)) {
    return "search-results";
  }

  return JOB_VIEW_PATH.test(pathname) ? "view" : null;
}
