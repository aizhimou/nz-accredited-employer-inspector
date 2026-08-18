import { describe, expect, it } from "vitest";
import { readFreshnessPolicy } from "../src/config";
import { InzResponseError } from "../src/errors";
import { parseInzResponse } from "../src/inz-response";
import {
  getAccreditationStatus,
  getAucklandDate,
  getExpiryDate,
  isRecentlyVerified,
} from "../src/time";
import {
  normalizeName,
  parseAssociationRequest,
  parseIngestRequest,
  parseNoMatchRequest,
  parseResolveRequest,
  parseWaitlistRequest,
  validateClientId,
} from "../src/validation";
import {
  buildEmployerFtsQuery,
  tokenizeEmployerSearch,
} from "../src/employer-search";
import { CLIENT_ID, createInzResponse } from "./fixtures";

const linkedinIdentity = {
  platform: "linkedin",
  externalKey: "company:onenz",
  kind: "linkedin_company_url",
  strength: "strong",
  displayName: "One New Zealand",
  publicUrl: "https://www.linkedin.com/company/onenz/",
};

describe("request validation", () => {
  it("normalizes Unicode, case, and whitespace without removing legal suffixes", () => {
    expect(normalizeName("  CATCH   Design ＬＴＤ  ")).toBe("catch design ltd");
  });

  it("validates and canonicalizes LinkedIn identities", () => {
    expect(parseResolveRequest({ identity: linkedinIdentity })).toEqual({
      identity: linkedinIdentity,
    });
    expect(() =>
      parseResolveRequest({
        identity: { ...linkedinIdentity, externalKey: "company:another" },
      }),
    ).toThrowError("LinkedIn company identity is invalid");
  });

  it("validates strong and weak SEEK identities", () => {
    expect(parseResolveRequest({
      identity: {
        platform: "seek",
        externalKey: "company:/companies/anz-171714174098706",
        kind: "seek_company_profile",
        strength: "strong",
        displayName: "ANZ Bank New Zealand Limited",
        publicUrl: "https://nz.seek.com/companies/anz-171714174098706/",
      },
    }).identity.publicUrl).toBe("https://nz.seek.com/companies/anz-171714174098706");

    expect(parseResolveRequest({
      identity: {
        platform: "seek",
        externalKey: "advertiser:anz bank new zealand limited",
        kind: "seek_advertiser_name",
        strength: "weak",
        displayName: " ANZ  Bank New Zealand Limited ",
        publicUrl: null,
      },
    }).identity.externalKey).toBe("advertiser:anz bank new zealand limited");
  });

  it("validates ingest and association envelopes", () => {
    expect(parseIngestRequest({
      identity: linkedinIdentity,
      query: " One New Zealand ",
      page: 1,
      inzResponse: { results: "[]" },
    })).toMatchObject({ query: "One New Zealand", page: 1 });
    expect(parseAssociationRequest({ identity: linkedinIdentity, nzbn: "9429034908822" }))
      .toMatchObject({ nzbn: "9429034908822" });
    expect(() =>
      parseAssociationRequest({ identity: linkedinIdentity, nzbn: "invalid" }),
    ).toThrowError("13 digits");
  });

  it("validates exact recognised no-match observations", () => {
    expect(parseNoMatchRequest({
      identity: linkedinIdentity,
      query: "  ONE   New Zealand ",
      inzResponse: {
        Title: "No Results",
        Message: "Your search found no results.\n Check the spelling.",
      },
    })).toMatchObject({
      query: "ONE   New Zealand",
      normalizedQuery: "one new zealand",
    });
    expect(() => parseNoMatchRequest({
      identity: linkedinIdentity,
      query: "Another Company",
      inzResponse: {
        Title: "No Results",
        Message: "Your search found no results.",
      },
    })).toThrowError("must match the platform display name");
    expect(() => parseNoMatchRequest({
      identity: linkedinIdentity,
      query: "One New Zealand",
      inzResponse: { Title: "Bad Request", Message: "No result." },
    })).toThrowError("no-match response is invalid");
  });

  it("validates UUID client IDs", () => {
    expect(validateClientId(CLIENT_ID)).toBe(CLIENT_ID);
    expect(() => validateClientId("not-a-uuid")).toThrowError("valid UUID");
  });

  it("normalizes and validates waitlist email addresses", () => {
    expect(parseWaitlistRequest({ email: "  USER+NZ@Example.COM ", website: "" }))
      .toEqual({ email: "user+nz@example.com", website: "" });
    expect(() => parseWaitlistRequest({ email: "not-an-email" }))
      .toThrowError("valid email address");
  });
});

describe("employer keyword search", () => {
  it("tokenizes Unicode names and requires every search term", () => {
    expect(tokenizeEmployerSearch("  Āporo & Sons (NZ) Ltd. ")).toEqual([
      "āporo",
      "sons",
      "nz",
      "ltd",
    ]);
    expect(buildEmployerFtsQuery("Woolworths NZ Ltd")).toBe(
      '"woolworths"* AND "nz" AND "ltd"*',
    );
  });

  it("deduplicates terms and rejects queries without searchable tokens", () => {
    expect(buildEmployerFtsQuery("Alpha alpha NZ")).toBe('"alpha"* AND "nz"');
    expect(buildEmployerFtsQuery("A")).toBeNull();
  });
});

describe("INZ response parser", () => {
  it("maps the four official fields, allows nullable trading name, and ignores unknown fields", () => {
    const response = parseInzResponse(createInzResponse([
      {
        employerName: "CATCH DESIGN LIMITED",
        nzbn: "9429034641101",
        expiryDateOfAccreditation: "2027-02-17T00:00:00",
        extraFields: [{ APIColumn: "futureField", Value: "ignored" }],
      },
    ]));

    expect(response.results).toEqual([{
      employerName: "CATCH DESIGN LIMITED",
      tradingName: null,
      nzbn: "9429034641101",
      expiryDateOfAccreditation: "2027-02-17T00:00:00",
    }]);
  });

  it("rejects malformed result JSON and required fields", () => {
    expect(() =>
      parseInzResponse({ results: "not-json", current: 1, totalPages: 1, totalResults: 1 }),
    ).toThrowError(InzResponseError);
    expect(() =>
      parseInzResponse(createInzResponse([{
        employerName: "EXAMPLE LIMITED",
        nzbn: "invalid",
        expiryDateOfAccreditation: "2028-01-01T00:00:00",
      }])),
    ).toThrowError("invalid NZBN");
  });
});

describe("Auckland accreditation and freshness", () => {
  it("uses the Pacific/Auckland calendar around the UTC boundary", () => {
    expect(getAucklandDate(Date.parse("2026-08-04T11:30:00Z"))).toBe("2026-08-04");
    expect(getAucklandDate(Date.parse("2026-08-04T12:30:00Z"))).toBe("2026-08-05");
  });

  it("validates and evaluates the expiry calendar date", () => {
    expect(getExpiryDate("2028-02-29T00:00:00")).toBe("2028-02-29");
    expect(getExpiryDate("2027-02-29T00:00:00")).toBeNull();
    expect(getAccreditationStatus(
      "2026-08-04T00:00:00",
      Date.parse("2026-08-04T11:30:00Z"),
    )).toBe("accredited");
    expect(getAccreditationStatus(
      "2026-08-04T00:00:00",
      Date.parse("2026-08-04T12:30:00Z"),
    )).toBe("expired");
  });

  it("evaluates configurable freshness boundaries", () => {
    const verified = Math.floor(Date.parse("2026-08-01T00:00:00Z") / 1000);
    expect(isRecentlyVerified(
      verified,
      Date.parse("2026-08-07T23:59:59Z"),
      7 * 24 * 60 * 60,
    )).toBe(true);
    expect(isRecentlyVerified(
      verified,
      Date.parse("2026-08-08T00:00:00Z"),
      7 * 24 * 60 * 60,
    )).toBe(false);
    expect(isRecentlyVerified(
      verified,
      Date.parse("2026-08-30T23:59:59Z"),
      30 * 24 * 60 * 60,
    )).toBe(true);
    expect(isRecentlyVerified(
      verified,
      Date.parse("2026-08-31T00:00:00Z"),
      30 * 24 * 60 * 60,
    )).toBe(false);
  });
});

describe("freshness configuration", () => {
  it("accepts positive integer number and string Worker variables", () => {
    expect(readFreshnessPolicy({
      POSITIVE_TTL_SECONDS: 2592000,
      NEGATIVE_TTL_SECONDS: "604800",
      REFRESH_ATTEMPT_COOLDOWN_SECONDS: 900,
      REFRESH_NO_MATCH_COOLDOWN_SECONDS: "86400",
    })).toEqual({
      positiveTtlSeconds: 2592000,
      negativeTtlSeconds: 604800,
      refreshAttemptCooldownSeconds: 900,
      refreshNoMatchCooldownSeconds: 86400,
    });
  });

  it.each([0, -1, 1.5, "", "7 days", undefined])(
    "rejects invalid TTL value %s",
    (value) => {
      expect(() => readFreshnessPolicy({
        POSITIVE_TTL_SECONDS: value,
        NEGATIVE_TTL_SECONDS: 604800,
        REFRESH_ATTEMPT_COOLDOWN_SECONDS: 900,
        REFRESH_NO_MATCH_COOLDOWN_SECONDS: 86400,
      })).toThrowError("POSITIVE_TTL_SECONDS must be a positive integer");
    },
  );
});
