import { describe, expect, it } from "vitest";
import {
  getLinkedInCompanySlug,
  getLinkedInJobSurface,
  isLinkedInJobSearchResults,
} from "../lib/linkedin-routes";

function linkedinUrl(path: string): URL {
  return new URL(path, "https://www.linkedin.com");
}

describe("LinkedIn route classification", () => {
  it.each([
    "/company/datacom/",
    "/company/datacom/about/",
    "/company/datacom/posts/?viewAsMember=true",
    "/company/datacom/jobs/?currentJobId=123",
    "/company/datacom/life/",
    "/company/datacom/life/salesandrevenue/",
    "/company/datacom/people/",
    "/company/datacom/insights/",
    "/company/datacom/product/",
  ])("extracts the canonical company slug from %s", (path) => {
    expect(getLinkedInCompanySlug(linkedinUrl(path))).toBe("datacom");
  });

  it.each([
    "/company/datacom/admin/",
    "/company/datacom/admin/analytics/",
    "/company/datacom/unknown/",
    "/company/datacom/unknown/nested/",
    "/company/",
    "/products/paypal/",
    "/jobs/search-results/",
  ])("rejects an unsupported company route at %s", (path) => {
    expect(getLinkedInCompanySlug(linkedinUrl(path))).toBeNull();
  });

  it.each([
    "/jobs/search-results",
    "/jobs/search-results/",
    "/jobs/search-results/?currentJobId=4379139684&keywords=engineer",
  ])("recognises the job search detail surface at %s", (path) => {
    expect(isLinkedInJobSearchResults(linkedinUrl(path))).toBe(true);
  });

  it.each([
    ["/jobs/search-results/?currentJobId=4379139684", "search-results"],
    ["/comm/jobs/search-results/?currentJobId=4379139684", "search-results"],
    ["/jobs/view/4379139684", "view"],
    ["/jobs/view/4379139684/?trackingId=abc", "view"],
    ["/comm/jobs/view/4379139684/?trackingId=email", "view"],
    [
      "/jobs/view/4434937703/?trk=eml-email_job_alert_digest_01-primary_job_list-0-jobcard_body_5_jobid_4434937703_ssid_8863954698_fmid_l8fne7~msfi2r4e~nn&refId=zpi2xTTEvbLSMhpTayWlEA%3D%3D&trackingId=9Rf8YCURQ9BC%2BVEg5AZV1A%3D%3D",
      "view",
    ],
  ])("classifies the job surface at %s", (path, surface) => {
    expect(getLinkedInJobSurface(linkedinUrl(path))).toBe(surface);
  });

  it.each([
    "/jobs/",
    "/comm/jobs/",
    "/jobs/view/4379139684/",
    "/jobs/search/",
    "/company/datacom/",
  ])("does not misclassify %s as the job search detail surface", (path) => {
    expect(isLinkedInJobSearchResults(linkedinUrl(path))).toBe(false);
  });

  it("rejects another LinkedIn hostname", () => {
    expect(
      getLinkedInCompanySlug(new URL("https://nz.linkedin.com/company/datacom/")),
    ).toBeNull();
    expect(
      isLinkedInJobSearchResults(
        new URL("https://nz.linkedin.com/jobs/search-results/"),
      ),
    ).toBe(false);
    expect(
      getLinkedInJobSurface(
        new URL("https://nz.linkedin.com/jobs/view/4379139684/"),
      ),
    ).toBeNull();
  });
});
