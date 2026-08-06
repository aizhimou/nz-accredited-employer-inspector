import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src";
import { CLIENT_ID, createInzResponse } from "./fixtures";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const CLIENT_ID_2 = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID_3 = "33333333-3333-4333-8333-333333333333";

const linkedinIdentity = {
  platform: "linkedin",
  externalKey: "company:onenz",
  kind: "linkedin_company_url",
  strength: "strong",
  displayName: "One New Zealand",
  publicUrl: "https://www.linkedin.com/company/onenz/",
};

function allowRateLimit(): RateLimit {
  return { limit: vi.fn(async () => ({ success: true })) };
}

function denyRateLimit(): RateLimit {
  return { limit: vi.fn(async () => ({ success: false })) };
}

function createTestEnv(
  overrides: Partial<Pick<Env, "CLIENT_RATE_LIMITER" | "SUBMISSION_RATE_LIMITER">> = {},
): Env {
  return {
    DB: env.DB,
    CLIENT_RATE_LIMITER: overrides.CLIENT_RATE_LIMITER ?? allowRateLimit(),
    SUBMISSION_RATE_LIMITER: overrides.SUBMISSION_RATE_LIMITER ?? allowRateLimit(),
    ENVIRONMENT: "development",
    SERVICE_VERSION: "0.6.0",
  };
}

function postRequest(
  path: string,
  body: unknown,
  clientId = CLIENT_ID,
): Request<unknown, IncomingRequestCfProperties> {
  return new IncomingRequest(`https://api.example.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-ID": clientId },
    body: JSON.stringify(body),
  });
}

async function call(path: string, body: unknown, clientId = CLIENT_ID, testEnv = createTestEnv()) {
  return worker.fetch(postRequest(path, body, clientId), testEnv, createExecutionContext());
}

function ingestBody(employers: Parameters<typeof createInzResponse>[0] = [{
  employerName: "ONE NEW ZEALAND GROUP LIMITED",
  tradingName: "One New Zealand",
  nzbn: "9429034908822",
  expiryDateOfAccreditation: "2027-08-04T00:00:00",
}]) {
  return {
    identity: linkedinIdentity,
    query: "One New Zealand",
    page: 1,
    inzResponse: createInzResponse(employers),
  };
}

const noMatchEnvelope = {
  Title: "No Results",
  Message: "Your search found no results.\n Please refine your search.",
  BackgroundClass: "bg--grey",
};

function noMatchBody(identity = linkedinIdentity, query = identity.displayName) {
  return { identity, query, inzResponse: noMatchEnvelope };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM platform_employer_confirmations"),
    env.DB.prepare("DELETE FROM platform_entities"),
    env.DB.prepare("DELETE FROM employers"),
    env.DB.prepare("DELETE FROM extension_waitlist"),
  ]);
});

describe("HTTP routing and controls", () => {
  it("serves health without D1 or rate limiting", async () => {
    const limiter = denyRateLimit();
    const response = await worker.fetch(
      new IncomingRequest("https://api.example.test/api/health"),
      createTestEnv({ CLIENT_RATE_LIMITER: limiter }),
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ version: "0.6.0", status: "ok" });
    expect(limiter.limit).not.toHaveBeenCalled();
  });

  it("handles CORS, missing routes, wrong methods, and client validation", async () => {
    const testEnv = createTestEnv();
    const options = await worker.fetch(
      new IncomingRequest("https://api.example.test/api/v1/employers/resolve", { method: "OPTIONS" }),
      testEnv,
      createExecutionContext(),
    );
    expect(options.status).toBe(204);
    expect(options.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const missing = await worker.fetch(
      new IncomingRequest("https://api.example.test/missing"),
      testEnv,
      createExecutionContext(),
    );
    expect(missing.status).toBe(404);

    const wrongMethod = await worker.fetch(
      new IncomingRequest("https://api.example.test/api/v1/employers/resolve", {
        headers: { "X-Client-ID": CLIENT_ID },
      }),
      testEnv,
      createExecutionContext(),
    );
    expect(wrongMethod.status).toBe(405);

    const noClient = await worker.fetch(
      new IncomingRequest("https://api.example.test/api/v1/employers/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: linkedinIdentity }),
      }),
      testEnv,
      createExecutionContext(),
    );
    expect(noClient.status).toBe(400);
    expect(await noClient.json()).toMatchObject({ error: { code: "invalid_client_id" } });
  });

  it("enforces request and write rate limits", async () => {
    const read = await call(
      "/v1/employers/resolve",
      { identity: linkedinIdentity },
      CLIENT_ID,
      createTestEnv({ CLIENT_RATE_LIMITER: denyRateLimit() }),
    );
    expect(read.status).toBe(429);
    expect(read.headers.get("Retry-After")).toBe("60");

    const write = await call(
      "/v1/employers/ingest",
      ingestBody(),
      CLIENT_ID,
      createTestEnv({ SUBMISSION_RATE_LIMITER: denyRateLimit() }),
    );
    expect(write.status).toBe(429);
    expect(await write.json()).toMatchObject({
      error: { code: "submission_rate_limit_exceeded" },
    });
  });

  it("rejects unsupported and oversized bodies", async () => {
    const wrongType = await worker.fetch(
      new IncomingRequest("https://api.example.test/v1/employers/resolve", {
        method: "POST",
        headers: { "Content-Type": "text/plain", "X-Client-ID": CLIENT_ID },
        body: "{}",
      }),
      createTestEnv(),
      createExecutionContext(),
    );
    expect(wrongType.status).toBe(415);

    const oversized = await call("/v1/employers/resolve", {
      identity: linkedinIdentity,
      padding: "x".repeat(128 * 1024),
    });
    expect(oversized.status).toBe(413);
  });

  it("stores unique waitlist emails without requiring an extension client ID", async () => {
    const testEnv = createTestEnv();
    const request = () => new IncomingRequest("https://api.example.test/api/v1/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.8" },
      body: JSON.stringify({ email: "  PERSON@Example.COM ", website: "" }),
    });

    const first = await worker.fetch(request(), testEnv, createExecutionContext());
    const duplicate = await worker.fetch(request(), testEnv, createExecutionContext());
    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    expect(await first.json()).toEqual({ state: "subscribed" });

    const rows = await env.DB.prepare("SELECT email FROM extension_waitlist").all<{ email: string }>();
    expect(rows.results).toEqual([{ email: "person@example.com" }]);
  });

  it("silently accepts honeypot waitlist submissions without storing them", async () => {
    const response = await worker.fetch(
      new IncomingRequest("https://api.example.test/api/v1/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "bot@example.com", website: "https://spam.example" }),
      }),
      createTestEnv(),
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM extension_waitlist")
      .first<{ count: number }>();
    expect(count?.count).toBe(0);
  });
});

describe("canonical employers and resolution", () => {
  it("returns an INZ lookup instruction without making outbound requests", async () => {
    const outboundFetch = vi.spyOn(globalThis, "fetch");
    const response = await call("/v1/employers/resolve", { identity: linkedinIdentity });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      state: "inz_lookup_required",
      matchMethod: null,
      selectedEmployer: null,
      candidates: [],
      association: null,
      noMatch: null,
      inzQuery: "One New Zealand",
    });
    expect(outboundFetch).not.toHaveBeenCalled();
  });

  it("atomically ingests every INZ result and returns them in INZ order", async () => {
    const response = await call("/v1/employers/ingest", ingestBody([
      {
        employerName: "ONE NEW ZEALAND GROUP LIMITED",
        tradingName: "One New Zealand",
        nzbn: "9429034908822",
        expiryDateOfAccreditation: "2027-08-04T00:00:00",
      },
      {
        employerName: "ONE NEW ZEALAND RETAIL LIMITED",
        tradingName: "One NZ Retail",
        nzbn: "9429000000002",
        expiryDateOfAccreditation: "2028-01-01T00:00:00",
      },
    ]));
    expect(response.status).toBe(200);
    const body = await response.json<{
      state: string;
      candidates: Array<{ nzbn: string; lastVerifiedAt: string }>;
    }>();
    expect(body.state).toBe("confirmation_required");
    expect(body.candidates.map((employer) => employer.nzbn)).toEqual([
      "9429034908822",
      "9429000000002",
    ]);
    expect(body.candidates[0]?.lastVerifiedAt).toMatch(/Z$/u);

    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM employers")
      .first<{ count: number }>();
    expect(count?.count).toBe(2);
  });

  it("finds canonical employers when a legal name contains the full page name", async () => {
    await call("/v1/employers/ingest", ingestBody([{
      employerName: "ONE NEW ZEALAND GROUP LIMITED",
      tradingName: "One NZ",
      nzbn: "9429034908822",
      expiryDateOfAccreditation: "2027-08-04T00:00:00",
    }]));
    const seekIdentity = {
      platform: "seek",
      externalKey: "advertiser:one new zealand",
      kind: "seek_advertiser_name",
      strength: "weak",
      displayName: "One New Zealand",
      publicUrl: null,
    };
    const response = await call("/v1/employers/resolve", { identity: seekIdentity });
    expect(await response.json()).toMatchObject({
      state: "confirmation_required",
      candidates: [{ nzbn: "9429034908822", tradingName: "One NZ" }],
    });
  });

  it("does not match short trading-name acronyms inside unrelated page words", async () => {
    const acronymEmployers = [
      {
        employerName: "YM MEDIA LIMITED",
        tradingName: "IF",
        nzbn: "9429050917952",
        expiryDateOfAccreditation: "2027-05-27T00:00:00",
      },
      {
        employerName: "ERECT SAFE SOLUTIONS LIMITED",
        tradingName: "ESS",
        nzbn: "9429046609663",
        expiryDateOfAccreditation: "2026-09-19T00:00:00",
      },
      {
        employerName: "INFORMATION TECHNOLOGY SERVICES LIMITED",
        tradingName: "IT",
        nzbn: "9429000000003",
        expiryDateOfAccreditation: "2028-01-01T00:00:00",
      },
    ];
    await call("/v1/employers/ingest", ingestBody(acronymEmployers));

    for (const displayName of ["Pacific Business Trust", "Britomart Holdings"]) {
      const response = await call("/v1/employers/resolve", {
        identity: {
          ...linkedinIdentity,
          externalKey: `company:${displayName.toLowerCase().replaceAll(" ", "-")}`,
          displayName,
          publicUrl: `https://www.linkedin.com/company/${displayName.toLowerCase().replaceAll(" ", "-")}/`,
        },
      });
      expect(await response.json()).toMatchObject({
        state: "inz_lookup_required",
        candidates: [],
        inzQuery: displayName,
      });
    }

    for (const employer of acronymEmployers) {
      const acronym = employer.tradingName;
      const response = await call("/v1/employers/resolve", {
        identity: {
          ...linkedinIdentity,
          externalKey: `company:${acronym.toLowerCase()}`,
          displayName: acronym,
          publicUrl: `https://www.linkedin.com/company/${acronym.toLowerCase()}/`,
        },
      });
      expect(await response.json()).toMatchObject({
        state: "confirmation_required",
        candidates: [{ nzbn: employer.nzbn, tradingName: acronym }],
      });
    }
  });

  it("automatically resolves one normalized exact official-name candidate", async () => {
    await call("/v1/employers/ingest", ingestBody());
    const exactIdentity = {
      ...linkedinIdentity,
      externalKey: "company:one-nz-group",
      displayName: "one   new zealand group limited",
      publicUrl: "https://www.linkedin.com/company/one-nz-group/",
    };

    const response = await call("/v1/employers/resolve", { identity: exactIdentity });
    expect(await response.json()).toMatchObject({
      state: "associated",
      matchMethod: "exact_employer_name",
      selectedEmployer: { nzbn: "9429034908822" },
      association: null,
    });

    const confirmations = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM platform_employer_confirmations",
    ).first<{ count: number }>();
    expect(confirmations?.count).toBe(0);
    const entity = await env.DB.prepare(
      "SELECT id FROM platform_entities WHERE platform = 'linkedin' AND external_key = 'company:one-nz-group'",
    ).first();
    expect(entity).toBeNull();
  });

  it("does not auto-select a trading-name match, fuzzy match, or multiple candidates", async () => {
    await call("/v1/employers/ingest", ingestBody([
      {
        employerName: "ONE NEW ZEALAND",
        tradingName: "One NZ",
        nzbn: "9429034908822",
        expiryDateOfAccreditation: "2027-08-04T00:00:00",
      },
      {
        employerName: "ONE NEW ZEALAND RETAIL LIMITED",
        tradingName: "Retail",
        nzbn: "9429000000002",
        expiryDateOfAccreditation: "2028-01-01T00:00:00",
      },
    ]));

    const multiple = await call("/v1/employers/resolve", {
      identity: { ...linkedinIdentity, displayName: "One New Zealand" },
    });
    expect(await multiple.json()).toMatchObject({
      state: "confirmation_required",
      matchMethod: null,
      selectedEmployer: null,
    });

    const tradingName = await call("/v1/employers/resolve", {
      identity: {
        ...linkedinIdentity,
        externalKey: "company:one-nz",
        displayName: "One NZ",
        publicUrl: "https://www.linkedin.com/company/one-nz/",
      },
    });
    expect(await tradingName.json()).toMatchObject({
      state: "confirmation_required",
      matchMethod: null,
      selectedEmployer: null,
    });
  });

  it("requires INZ totalResults to be one for an immediate live exact match", async () => {
    const exactEmployer = [{
      employerName: "ONE NEW ZEALAND",
      nzbn: "9429034908822",
      expiryDateOfAccreditation: "2027-08-04T00:00:00",
    }];
    const response = await call("/v1/employers/ingest", {
      ...ingestBody(exactEmployer),
      inzResponse: createInzResponse(exactEmployer, {
        current: 1,
        totalPages: 2,
        totalResults: 2,
      }),
    });
    expect(await response.json()).toMatchObject({
      state: "confirmation_required",
      matchMethod: null,
      selectedEmployer: null,
    });
  });

  it("refreshes a stale exact-name match by NZBN", async () => {
    const ingested = await call("/v1/employers/ingest", ingestBody([{
      employerName: "ONE NEW ZEALAND",
      nzbn: "9429034908822",
      expiryDateOfAccreditation: "2027-08-04T00:00:00",
    }]));
    expect(await ingested.json()).toMatchObject({
      state: "associated",
      matchMethod: "exact_employer_name",
      association: null,
    });
    await env.DB.prepare(
      "UPDATE employers SET last_verified_at = ?1 WHERE nzbn = '9429034908822'",
    ).bind(Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60).run();

    const response = await call("/v1/employers/resolve", { identity: linkedinIdentity });
    expect(await response.json()).toMatchObject({
      state: "refresh_required",
      matchMethod: "exact_employer_name",
      association: null,
      selectedEmployer: { nzbn: "9429034908822" },
      inzQuery: "9429034908822",
    });
  });

  it("keeps complete official imports fresh for 30 days without exposing internal provenance", async () => {
    const verifiedAt = Math.floor(Date.now() / 1000) - 10 * 24 * 60 * 60;
    await env.DB.prepare(
      `INSERT INTO employers (
         employer_name, normalized_employer_name,
         trading_name, normalized_trading_name,
         nzbn, expiry_date_of_accreditation,
         first_seen_at, last_verified_at, last_verified_source,
         official_snapshot_date
       ) VALUES (
         'ONE NEW ZEALAND', 'one new zealand',
         NULL, NULL,
         '9429034908822', '2030-01-01T00:00:00',
         ?1, ?1, 'inz_official_import',
         '2026-07-27'
       )`,
    ).bind(verifiedAt).run();

    const officialResponse = await call("/v1/employers/resolve", {
      identity: linkedinIdentity,
    });
    const officialBody = await officialResponse.json<Record<string, unknown>>();
    expect(officialBody).toMatchObject({
      state: "associated",
      matchMethod: "exact_employer_name",
    });
    expect(JSON.stringify(officialBody)).not.toContain("verificationSource");

    await env.DB.prepare(
      `UPDATE employers
          SET last_verified_source = 'inz_live_lookup'
        WHERE nzbn = '9429034908822'`,
    ).run();
    const liveResponse = await call("/v1/employers/resolve", {
      identity: linkedinIdentity,
    });
    expect(await liveResponse.json()).toMatchObject({
      state: "refresh_required",
      matchMethod: "exact_employer_name",
    });
  });

  it("updates official fields and verification source on repeated INZ observations", async () => {
    await call("/v1/employers/ingest", ingestBody());
    await call("/v1/employers/ingest", ingestBody([{
      employerName: "ONE NEW ZEALAND GROUP LIMITED",
      tradingName: "One NZ",
      nzbn: "9429034908822",
      expiryDateOfAccreditation: "2028-08-04T00:00:00",
    }]));
    const row = await env.DB.prepare(
      `SELECT trading_name, normalized_trading_name,
              expiry_date_of_accreditation, last_verified_source
         FROM employers WHERE nzbn = '9429034908822'`,
    ).first<Record<string, unknown>>();
    expect(row).toMatchObject({
      trading_name: "One NZ",
      normalized_trading_name: "one nz",
      expiry_date_of_accreditation: "2028-08-04T00:00:00",
      last_verified_source: "inz_live_lookup",
    });
  });

  it("rejects recognised/canonical empty payloads without a D1 write", async () => {
    const response = await call("/v1/employers/ingest", {
      ...ingestBody(),
      inzResponse: createInzResponse([], { current: 1, totalPages: 0, totalResults: 0 }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "empty_inz_response" } });
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM employers")
      .first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("rejects one invalid INZ result without partially writing valid rows", async () => {
    const response = await call("/v1/employers/ingest", ingestBody([
      {
        employerName: "VALID LIMITED",
        nzbn: "9429000000001",
        expiryDateOfAccreditation: "2028-01-01T00:00:00",
      },
      {
        employerName: "INVALID LIMITED",
        nzbn: "invalid",
        expiryDateOfAccreditation: "2028-01-01T00:00:00",
      },
    ]));
    expect(response.status).toBe(400);
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM employers")
      .first<{ count: number }>();
    expect(count?.count).toBe(0);
  });
});

describe("platform no-match observations", () => {
  it("stores and reuses an exact no-match observation for 24 hours", async () => {
    const stored = await call("/v1/employers/no-match", noMatchBody());
    expect(stored.status).toBe(200);
    const storedBody = await stored.json<{
      state: string;
      noMatch: { query: string; checkedAt: string; expiresAt: string };
    }>();
    expect(storedBody).toMatchObject({
      state: "no_published_inz_match",
      noMatch: { query: "one new zealand" },
    });
    expect(
      Date.parse(storedBody.noMatch.expiresAt) - Date.parse(storedBody.noMatch.checkedAt),
    ).toBe(24 * 60 * 60 * 1000);

    const resolved = await call("/v1/employers/resolve", { identity: linkedinIdentity });
    expect(await resolved.json()).toMatchObject({
      state: "no_published_inz_match",
      noMatch: { checkedAt: storedBody.noMatch.checkedAt },
      inzQuery: null,
    });
  });

  it("does not extend an already-fresh observation", async () => {
    await call("/v1/employers/no-match", noMatchBody());
    const before = await env.DB.prepare(
      "SELECT last_no_match_at FROM platform_entities WHERE platform = 'linkedin' AND external_key = 'company:onenz'",
    ).first<{ last_no_match_at: number }>();
    await call("/v1/employers/no-match", noMatchBody(), CLIENT_ID_2);
    const after = await env.DB.prepare(
      "SELECT last_no_match_at FROM platform_entities WHERE platform = 'linkedin' AND external_key = 'company:onenz'",
    ).first<{ last_no_match_at: number }>();
    expect(after?.last_no_match_at).toBe(before?.last_no_match_at);
  });

  it("expires at 24 hours and ignores an observation for a changed display name", async () => {
    await call("/v1/employers/no-match", noMatchBody());
    await env.DB.prepare(
      "UPDATE platform_entities SET last_no_match_at = ?1 WHERE platform = 'linkedin' AND external_key = 'company:onenz'",
    ).bind(Math.floor(Date.now() / 1000) - 24 * 60 * 60).run();

    const expired = await call("/v1/employers/resolve", { identity: linkedinIdentity });
    expect(await expired.json()).toMatchObject({
      state: "inz_lookup_required",
      noMatch: null,
      inzQuery: "One New Zealand",
    });

    await call("/v1/employers/no-match", noMatchBody());
    const renamedIdentity = { ...linkedinIdentity, displayName: "One NZ" };
    const renamed = await call("/v1/employers/resolve", { identity: renamedIdentity });
    expect(await renamed.json()).toMatchObject({
      state: "inz_lookup_required",
      noMatch: null,
      inzQuery: "One NZ",
    });
  });

  it("rejects malformed or mismatched no-match submissions", async () => {
    const malformed = await call("/v1/employers/no-match", {
      ...noMatchBody(),
      inzResponse: { Title: "Bad Request", Message: "Invalid." },
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({
      error: { code: "invalid_no_match_response" },
    });

    const mismatch = await call(
      "/v1/employers/no-match",
      noMatchBody(linkedinIdentity, "Another Company"),
    );
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toMatchObject({ error: { code: "query_mismatch" } });
  });

  it("gives positive candidates precedence and skips the negative write", async () => {
    await call("/v1/employers/ingest", ingestBody());
    const response = await call("/v1/employers/no-match", noMatchBody());
    expect(await response.json()).toMatchObject({
      state: "confirmation_required",
      candidates: [{ nzbn: "9429034908822" }],
      noMatch: null,
    });
    const entity = await env.DB.prepare(
      "SELECT id FROM platform_entities WHERE platform = 'linkedin' AND external_key = 'company:onenz'",
    ).first();
    expect(entity).toBeNull();
  });

  it("clears an observation on positive ingest and association", async () => {
    await call("/v1/employers/no-match", noMatchBody());
    await call("/v1/employers/ingest", ingestBody());
    let row = await env.DB.prepare(
      "SELECT last_no_match_query, last_no_match_at FROM platform_entities WHERE platform = 'linkedin' AND external_key = 'company:onenz'",
    ).first<{ last_no_match_query: string | null; last_no_match_at: number | null }>();
    expect(row).toEqual({ last_no_match_query: null, last_no_match_at: null });

    await env.DB.prepare(
      "UPDATE platform_entities SET last_no_match_query = 'one new zealand', last_no_match_at = ?1 WHERE platform = 'linkedin' AND external_key = 'company:onenz'",
    ).bind(Math.floor(Date.now() / 1000)).run();
    await call("/v1/employers/associate", {
      identity: linkedinIdentity,
      nzbn: "9429034908822",
    });
    row = await env.DB.prepare(
      "SELECT last_no_match_query, last_no_match_at FROM platform_entities WHERE platform = 'linkedin' AND external_key = 'company:onenz'",
    ).first<{ last_no_match_query: string | null; last_no_match_at: number | null }>();
    expect(row).toEqual({ last_no_match_query: null, last_no_match_at: null });
  });
});

describe("platform confirmations", () => {
  it("gives a manual association precedence over an automatic exact-name match", async () => {
    const exactIdentity = {
      ...linkedinIdentity,
      displayName: "ONE NEW ZEALAND GROUP LIMITED",
    };
    await call("/v1/employers/ingest", {
      ...ingestBody([
        {
          employerName: "ONE NEW ZEALAND GROUP LIMITED",
          nzbn: "9429034908822",
          expiryDateOfAccreditation: "2027-08-04T00:00:00",
        },
        {
          employerName: "ONE NEW ZEALAND RETAIL LIMITED",
          nzbn: "9429000000002",
          expiryDateOfAccreditation: "2027-08-04T00:00:00",
        },
      ]),
      identity: exactIdentity,
      query: exactIdentity.displayName,
    });

    const response = await call("/v1/employers/associate", {
      identity: exactIdentity,
      nzbn: "9429000000002",
    });
    expect(await response.json()).toMatchObject({
      state: "associated",
      matchMethod: "platform_association",
      selectedEmployer: { nzbn: "9429000000002" },
      association: { source: "self" },
    });
  });

  it("stores a self confirmation and allows the same client to change it", async () => {
    await call("/v1/employers/ingest", ingestBody([
      {
        employerName: "ONE NEW ZEALAND GROUP LIMITED",
        nzbn: "9429034908822",
        expiryDateOfAccreditation: "2027-08-04T00:00:00",
      },
      {
        employerName: "ONE NEW ZEALAND RETAIL LIMITED",
        nzbn: "9429000000002",
        expiryDateOfAccreditation: "2027-08-04T00:00:00",
      },
    ]));

    const first = await call("/v1/employers/associate", {
      identity: linkedinIdentity,
      nzbn: "9429034908822",
    });
    expect(await first.json()).toMatchObject({
      state: "associated",
      matchMethod: "platform_association",
      selectedEmployer: { nzbn: "9429034908822" },
      association: { source: "self", confirmationCount: 1 },
    });

    const changed = await call("/v1/employers/associate", {
      identity: linkedinIdentity,
      nzbn: "9429000000002",
    });
    expect(await changed.json()).toMatchObject({
      selectedEmployer: { nzbn: "9429000000002" },
      association: { source: "self", confirmationCount: 1, disputed: false },
    });
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM platform_employer_confirmations",
    ).first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("uses a community winner but requires confirmation for a tie", async () => {
    await call("/v1/employers/ingest", ingestBody([
      {
        employerName: "ONE NEW ZEALAND GROUP LIMITED",
        nzbn: "9429034908822",
        expiryDateOfAccreditation: "2027-08-04T00:00:00",
      },
      {
        employerName: "ONE NEW ZEALAND RETAIL LIMITED",
        nzbn: "9429000000002",
        expiryDateOfAccreditation: "2027-08-04T00:00:00",
      },
    ]));
    await call("/v1/employers/associate", {
      identity: linkedinIdentity,
      nzbn: "9429034908822",
    }, CLIENT_ID);

    const community = await call(
      "/v1/employers/resolve",
      { identity: linkedinIdentity },
      CLIENT_ID_3,
    );
    expect(await community.json()).toMatchObject({
      state: "associated",
      association: { source: "community", nzbn: "9429034908822" },
    });

    await call("/v1/employers/associate", {
      identity: linkedinIdentity,
      nzbn: "9429000000002",
    }, CLIENT_ID_2);
    const tied = await call(
      "/v1/employers/resolve",
      { identity: linkedinIdentity },
      CLIENT_ID_3,
    );
    expect(await tied.json()).toMatchObject({
      state: "confirmation_required",
      selectedEmployer: null,
      association: { nzbn: null, source: null, disputed: true },
    });
  });

  it("returns refresh_required at seven days and keeps accreditation separate", async () => {
    await call("/v1/employers/ingest", ingestBody([{
      employerName: "ONE NEW ZEALAND GROUP LIMITED",
      nzbn: "9429034908822",
      expiryDateOfAccreditation: "2020-01-01T00:00:00",
    }]));
    await call("/v1/employers/associate", {
      identity: linkedinIdentity,
      nzbn: "9429034908822",
    });
    await env.DB.prepare(
      "UPDATE employers SET last_verified_at = ?1 WHERE nzbn = '9429034908822'",
    ).bind(Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60).run();

    const response = await call("/v1/employers/resolve", { identity: linkedinIdentity });
    expect(await response.json()).toMatchObject({
      state: "refresh_required",
      inzQuery: "9429034908822",
      selectedEmployer: { accreditationStatus: "expired" },
    });
  });

  it("rejects association to an unknown NZBN", async () => {
    const response = await call("/v1/employers/associate", {
      identity: linkedinIdentity,
      nzbn: "9429000000009",
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "employer_not_found" } });
  });

  it("rolls back a failing D1 batch", async () => {
    await expect(env.DB.batch([
      env.DB.prepare(
        `INSERT INTO platform_entities (
           platform, external_key, identity_kind, identity_strength,
           display_name, public_url, first_seen_at, last_seen_at
         ) VALUES ('linkedin', 'company:rollback', 'linkedin_company_url',
                   'strong', 'Rollback', NULL, 1, 1)`,
      ),
      env.DB.prepare(
        `INSERT INTO platform_employer_confirmations (
           platform_entity_id, client_id_hash, nzbn, created_at, updated_at
         ) VALUES (last_insert_rowid(), 'invalid-hash', '9429000000009', 1, 1)`,
      ),
    ])).rejects.toThrow();

    const row = await env.DB.prepare(
      "SELECT id FROM platform_entities WHERE external_key = 'company:rollback'",
    ).first();
    expect(row).toBeNull();
  });
});
