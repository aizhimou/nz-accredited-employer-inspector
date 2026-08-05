const JOB_DETAIL_PATH = /^\/job\/\d+\/?$/u;
const HOMEPAGE_PATH = /^\/$/u;
const SEARCH_RESULTS_PATH =
  /^\/(?:jobs(?:-in-[^/]+)?|[^/]+-jobs)(?:\/[^/]+)*\/?$/iu;
const COMPANY_PATH =
  /^\/companies\/([a-z0-9][a-z0-9-]{0,199})(?:\/(?:culture|jobs|reviews|salaries))?\/?$/iu;

export function isSeekJobSurface(url: URL): boolean {
  return (
    url.hostname === "nz.seek.com" &&
    (JOB_DETAIL_PATH.test(url.pathname) ||
      HOMEPAGE_PATH.test(url.pathname) ||
      SEARCH_RESULTS_PATH.test(url.pathname))
  );
}

export function getSeekCompanyCanonicalPath(url: URL): string | null {
  if (url.hostname !== "nz.seek.com") {
    return null;
  }
  const match = url.pathname.match(COMPANY_PATH);
  const slug = match?.[1]?.toLowerCase();
  return slug === undefined ? null : `/companies/${slug}`;
}
