import { describe, expect, it } from "vitest";
import type {
  EmployerResolutionResponse,
  PlatformIdentity,
} from "../lib/contracts";
import {
  API_BASE_URL,
  associateEmployer,
  type FetchLike,
  INZ_API_URL,
  lookupEmployer,
} from "../lib/lookup";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const identity: PlatformIdentity = {
  platform: "seek",
  externalKey: "company:/companies/one-new-zealand-123",
  kind: "seek_company_profile",
  strength: "strong",
  displayName: "One New Zealand",
  publicUrl: "https://nz.seek.com/companies/one-new-zealand-123",
};

const employer = {
  employerName: "ONE NEW ZEALAND GROUP LIMITED",
  tradingName: "One New Zealand",
  nzbn: "9429034908822",
  expiryDateOfAccreditation: "2027-08-04T00:00:00",
  lastVerifiedAt: "2026-08-04T09:00:00.000Z",
  accreditationStatus: "accredited" as const,
};

const rawInzResponse = {
  results: JSON.stringify([{
    field_schema: {
      raw: [
        { APIColumn: "employerName", Value: employer.employerName },
        { APIColumn: "tradingName", Value: employer.tradingName },
        { APIColumn: "nzbn", Value: employer.nzbn },
        { APIColumn: "expiryDateOfAccreditation", Value: employer.expiryDateOfAccreditation },
      ],
    },
  }]),
  current: 1,
  totalPages: 1,
  totalResults: 1,
};

function resolution(
  state: EmployerResolutionResponse["state"],
): EmployerResolutionResponse {
  if (state === "associated" || state === "refresh_required") {
    return {
      state,
      selectedEmployer: employer,
      candidates: [employer],
      association: {
        nzbn: employer.nzbn,
        source: "community",
        confirmationCount: 2,
        alternativeConfirmationCount: 0,
        disputed: false,
        identityStrength: "strong",
      },
      noMatch: null,
      inzQuery: state === "refresh_required" ? employer.nzbn : null,
    };
  }
  if (state === "confirmation_required") {
    return {
      state,
      selectedEmployer: null,
      candidates: [employer],
      association: null,
      noMatch: null,
      inzQuery: null,
    };
  }
  if (state === "no_published_inz_match") {
    return {
      state,
      selectedEmployer: null,
      candidates: [],
      association: null,
      noMatch: {
        query: "one new zealand",
        checkedAt: "2026-08-05T01:00:00.000Z",
        expiresAt: "2026-08-06T01:00:00.000Z",
      },
      inzQuery: null,
    };
  }
  return {
    state,
    selectedEmployer: null,
    candidates: [],
    association: null,
    noMatch: null,
    inzQuery: identity.displayName,
  };
}

function apiResult(data: EmployerResolutionResponse): Response {
  return Response.json(data, {
    headers: { "X-Request-ID": "22222222-2222-4222-8222-222222222222" },
  });
}

describe("employer lookup orchestration", () => {
  it("returns a fresh associated employer without calling INZ", async () => {
    const calls: string[] = [];
    const fetchFn: FetchLike = async (input) => {
      calls.push(String(input));
      return apiResult(resolution("associated"));
    };

    const result = await lookupEmployer(identity, CLIENT_ID, fetchFn);

    expect(result).toMatchObject({
      ok: true,
      liveLookupStatus: "not_needed",
      data: { state: "associated" },
    });
    expect(calls).toEqual([`${API_BASE_URL}/v1/employers/resolve`]);
  });

  it("returns local candidates without silently choosing or calling INZ", async () => {
    let callCount = 0;
    const fetchFn: FetchLike = async () => {
      callCount += 1;
      return apiResult(resolution("confirmation_required"));
    };
    const result = await lookupEmployer(identity, CLIENT_ID, fetchFn);
    expect(result).toMatchObject({
      ok: true,
      liveLookupStatus: "not_needed",
      data: { state: "confirmation_required", selectedEmployer: null },
    });
    expect(callCount).toBe(1);
  });

  it("calls INZ once when instructed and submits the untouched positive response", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn: FetchLike = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/resolve")) {
        return apiResult(resolution("inz_lookup_required"));
      }
      if (url === INZ_API_URL) {
        return Response.json(rawInzResponse);
      }
      return apiResult(resolution("confirmation_required"));
    };

    const result = await lookupEmployer(identity, CLIENT_ID, fetchFn);

    expect(result).toMatchObject({
      ok: true,
      liveLookupStatus: "updated",
      data: { state: "confirmation_required" },
    });
    expect(calls.map((call) => call.url)).toEqual([
      `${API_BASE_URL}/v1/employers/resolve`,
      INZ_API_URL,
      `${API_BASE_URL}/v1/employers/ingest`,
    ]);
    const formData = calls[1]?.init?.body;
    expect(formData).toBeInstanceOf(FormData);
    if (!(formData instanceof FormData)) {
      throw new Error("Expected INZ FormData.");
    }
    expect(formData.get("query")).toBe(identity.displayName);
    expect(formData.get("collection")).toBe("2");
    expect(formData.get("page")).toBe("1");

    const submitted = calls[2]?.init?.body;
    expect(typeof submitted).toBe("string");
    if (typeof submitted !== "string") {
      throw new Error("Expected Worker submission JSON.");
    }
    expect(JSON.parse(submitted)).toEqual({
      identity,
      query: identity.displayName,
      page: 1,
      inzResponse: rawInzResponse,
    });
  });

  it("stores INZ's recognised 400 No Results response without ingesting it", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const noMatchResponse = {
      Title: "No Results",
      Message: "Your search found no results.\n Please refine your search.",
    };
    const fetchFn: FetchLike = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/resolve")) {
        return apiResult(resolution("inz_lookup_required"));
      }
      if (url === INZ_API_URL) {
        return new Response(JSON.stringify(noMatchResponse), {
          status: 400,
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
        });
      }
      return apiResult(resolution("no_published_inz_match"));
    };

    const result = await lookupEmployer(identity, CLIENT_ID, fetchFn);

    expect(result).toMatchObject({
      ok: true,
      liveLookupStatus: "no_published_inz_match",
      data: { state: "no_published_inz_match" },
    });
    expect(calls.map((call) => call.url)).toEqual([
      `${API_BASE_URL}/v1/employers/resolve`,
      INZ_API_URL,
      `${API_BASE_URL}/v1/employers/no-match`,
    ]);
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
      identity,
      query: identity.displayName,
      inzResponse: noMatchResponse,
    });
  });

  it("reuses a fresh platform no-match without calling INZ", async () => {
    const calls: string[] = [];
    const fetchFn: FetchLike = async (input) => {
      calls.push(String(input));
      return apiResult(resolution("no_published_inz_match"));
    };
    const result = await lookupEmployer(identity, CLIENT_ID, fetchFn);
    expect(result).toMatchObject({
      ok: true,
      liveLookupStatus: "no_published_inz_match",
      data: {
        state: "no_published_inz_match",
        noMatch: { expiresAt: "2026-08-06T01:00:00.000Z" },
      },
    });
    expect(calls).toEqual([`${API_BASE_URL}/v1/employers/resolve`]);
  });

  it("keeps stale associated data as review context after NZBN no-result", async () => {
    let callCount = 0;
    const fetchFn: FetchLike = async () => {
      callCount += 1;
      if (callCount === 1) {
        return apiResult(resolution("refresh_required"));
      }
      return new Response(JSON.stringify({
        Title: "No Results",
        Message: "Your search found no results. Check the spelling.",
      }), { status: 400 });
    };
    const result = await lookupEmployer(identity, CLIENT_ID, fetchFn);
    expect(result).toMatchObject({
      ok: true,
      liveLookupStatus: "verification_required",
      data: { state: "refresh_required", selectedEmployer: { nzbn: employer.nzbn } },
    });
    expect(callCount).toBe(2);
  });

  it("does not treat an unrelated INZ 400 as no result", async () => {
    let callCount = 0;
    const fetchFn: FetchLike = async () => {
      callCount += 1;
      if (callCount === 1) {
        return apiResult(resolution("inz_lookup_required"));
      }
      return new Response(JSON.stringify({ Title: "Bad Request", Message: "Invalid query." }), {
        status: 400,
      });
    };
    const result = await lookupEmployer(identity, CLIENT_ID, fetchFn);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "inz_unavailable",
        message: "Immigration New Zealand returned temporary error.",
        requestId: null,
      },
    });
    expect(callCount).toBe(2);
  });

  it("does not call INZ after an API error", async () => {
    let callCount = 0;
    const fetchFn: FetchLike = async () => {
      callCount += 1;
      return Response.json(
        { error: { code: "internal_error", message: "Unexpected failure." } },
        { status: 500, headers: { "X-Request-ID": "request-1" } },
      );
    };
    const result = await lookupEmployer(identity, CLIENT_ID, fetchFn);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "internal_error",
        message: "Unexpected failure.",
        requestId: "request-1",
      },
    });
    expect(callCount).toBe(1);
  });

  it("submits an explicit association choice", async () => {
    let submitted: unknown;
    const fetchFn: FetchLike = async (_input, init) => {
      submitted = JSON.parse(String(init?.body));
      return apiResult(resolution("associated"));
    };
    const result = await associateEmployer(identity, employer.nzbn, CLIENT_ID, fetchFn);
    expect(result).toMatchObject({ ok: true, data: { state: "associated" } });
    expect(submitted).toEqual({ identity, nzbn: employer.nzbn });
  });

  it("refreshes a newly selected stale employer by NZBN", async () => {
    const calls: string[] = [];
    const fetchFn: FetchLike = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/associate")) {
        return apiResult(resolution("refresh_required"));
      }
      if (url === INZ_API_URL) {
        return Response.json(rawInzResponse);
      }
      return apiResult(resolution("associated"));
    };

    const result = await associateEmployer(identity, employer.nzbn, CLIENT_ID, fetchFn);

    expect(result).toMatchObject({
      ok: true,
      liveLookupStatus: "updated",
      data: { state: "associated" },
    });
    expect(calls).toEqual([
      `${API_BASE_URL}/v1/employers/associate`,
      INZ_API_URL,
      `${API_BASE_URL}/v1/employers/ingest`,
    ]);
  });
});
