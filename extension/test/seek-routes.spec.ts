import { describe, expect, it } from "vitest";
import {
  getSeekCompanyCanonicalPath,
  isSeekJobSurface,
} from "../lib/seek-routes";

function seekUrl(path: string): URL {
  return new URL(path, "https://nz.seek.com");
}

describe("SEEK route classification", () => {
  it.each([
    "/",
    "/job/93707838",
    "/jobs",
    "/jobs/in-All-New-Zealand",
    "/rush-jobs",
    "/rush-jobs/in-All-New-Zealand",
    "/Java-Developer-jobs",
    "/jobs-in-accounting",
  ])("recognises a job surface at %s", (path) => {
    expect(isSeekJobSurface(seekUrl(path))).toBe(true);
  });

  it.each([
    "/job/not-a-number",
    "/companies/westpac-bank-171714208415050",
    "/companies/westpac-bank-171714208415050/jobs",
    "/my-activity/saved-jobs",
    "/career-advice",
  ])("does not misclassify %s as a job surface", (path) => {
    expect(isSeekJobSurface(seekUrl(path))).toBe(false);
  });

  it.each([
    "/companies/westpac-bank-171714208415050",
    "/companies/westpac-bank-171714208415050/culture",
    "/companies/westpac-bank-171714208415050/jobs",
    "/companies/westpac-bank-171714208415050/reviews",
    "/companies/westpac-bank-171714208415050/salaries",
  ])("canonicalises a company route at %s", (path) => {
    expect(getSeekCompanyCanonicalPath(seekUrl(path))).toBe(
      "/companies/westpac-bank-171714208415050",
    );
  });

  it("rejects unrelated and unsupported company routes", () => {
    expect(getSeekCompanyCanonicalPath(seekUrl("/companies"))).toBeNull();
    expect(
      getSeekCompanyCanonicalPath(
        seekUrl("/companies/westpac-bank-171714208415050/unknown"),
      ),
    ).toBeNull();
    expect(
      getSeekCompanyCanonicalPath(
        new URL("https://example.com/companies/westpac-bank-171714208415050"),
      ),
    ).toBeNull();
  });
});
