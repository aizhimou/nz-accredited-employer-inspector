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
    SERVICE_VERSION: "0.8.0",
    POSITIVE_TTL_SECONDS: 2592000,
    NEGATIVE_TTL_SECONDS: 604800,
    REFRESH_ATTEMPT_COOLDOWN_SECONDS: 900,
    REFRESH_NO_MATCH_COOLDOWN_SECONDS: 86400,
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
    expect(await response.json()).toMatchObject({ version: "0.8.0", status: "ok" });
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

  it("does not treat a containing legal name as an automatic candidate", async () => {
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
      state: "inz_lookup_required",
      candidates: [],
      inzQuery: "One New Zealand",
    });
  });

  it("keeps abbreviated advertiser names unresolved until the user searches", async () => {
    const woolworthsIdentity = {
      platform: "seek",
      externalKey: "advertiser:woolworths nz ltd",
      kind: "seek_advertiser_name",
      strength: "weak",
      displayName: "Woolworths NZ Ltd",
      publicUrl: null,
    };
    await call("/v1/employers/ingest", {
      identity: woolworthsIdentity,
      query: "Woolworths New Zealand",
      page: 1,
      inzResponse: createInzResponse([{
        employerName: "WOOLWORTHS NEW ZEALAND LIMITED",
        tradingName: "Woolworths New Zealand Limited",
        nzbn: "9429040683379",
        expiryDateOfAccreditation: "2026-09-13T00:00:00",
      }]),
    });

    const response = await call("/v1/employers/resolve", { identity: woolworthsIdentity });
    expect(await response.json()).toMatchObject({
      state: "inz_lookup_required",
      matchMethod: null,
      selectedEmployer: null,
      candidates: [],
      inzQuery: "Woolworths NZ Ltd",
    });

    const search = await call("/v1/employers/search", { query: "Woolworths" });
    expect(await search.json()).toMatchObject({
      query: "Woolworths",
      candidates: [{
        employerName: "WOOLWORTHS NEW ZEALAND LIMITED",
        nzbn: "9429040683379",
      }],
    });
  });

  it("searches the local official dataset with an independent recovery query", async () => {
    await call("/v1/employers/ingest", ingestBody([{
      employerName: "ALPHA BETA CONSULTING LIMITED",
      nzbn: "9429000000010",
      expiryDateOfAccreditation: "2028-01-01T00:00:00",
    }]));

    const abbreviation = await call("/v1/employers/search", { query: "ABC Consulting" });
    expect(await abbreviation.json()).toMatchObject({ candidates: [] });

    const response = await call("/v1/employers/search", { query: "Alpha Consulting" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      query: "Alpha Consulting",
      candidates: [{
        employerName: "ALPHA BETA CONSULTING LIMITED",
        nzbn: "9429000000010",
      }],
    });
  });

  it("returns at most ten ranked candidates", async () => {
    const employers = Array.from({ length: 12 }, (_, index) => ({
      employerName: `AUCKLAND EMPLOYER ${String(index + 1).padStart(2, "0")} LIMITED`,
      nzbn: (9429000000100n + BigInt(index)).toString(),
      expiryDateOfAccreditation: "2028-01-01T00:00:00",
    }));
    const ingested = await call("/v1/employers/ingest", ingestBody(employers));
    const ingestedBody = await ingested.json<{ candidates: unknown[] }>();
    expect(ingestedBody.candidates).toHaveLength(10);

    const searched = await call("/v1/employers/search", {
      query: "Auckland Employer",
    });
    const searchedBody = await searched.json<{ candidates: unknown[] }>();
    expect(searchedBody.candidates).toHaveLength(10);
  });

  it("requires all keywords and does not return candidates for a shared generic term", async () => {
    await call("/v1/employers/ingest", ingestBody([
      {
        employerName: "ECL GROUP LIMITED",
        tradingName: "ECL Group",
        nzbn: "9429000000030",
        expiryDateOfAccreditation: "2028-01-01T00:00:00",
      },
      {
        employerName: "EDUCARE GROUP LIMITED",
        tradingName: "Educare Group Limited",
        nzbn: "9429000000031",
        expiryDateOfAccreditation: "2028-01-01T00:00:00",
      },
      {
        employerName: "PIONEER GROUP 2012 LIMITED",
        tradingName: "Pioneer Group",
        nzbn: "9429000000032",
        expiryDateOfAccreditation: "2028-01-01T00:00:00",
      },
    ]));

    const resolution = await call("/v1/employers/resolve", {
      identity: {
        ...linkedinIdentity,
        externalKey: "company:carecone-group",
        displayName: "CareCone Group",
        publicUrl: "https://www.linkedin.com/company/carecone-group/",
      },
    });
    expect(await resolution.json()).toMatchObject({
      state: "inz_lookup_required",
      candidates: [],
      inzQuery: "CareCone Group",
    });

    const search = await call("/v1/employers/search", { query: "CareCone Group" });
    expect(await search.json()).toMatchObject({ candidates: [] });
  });

  it("keeps the employer FTS index synchronized after a canonical name change", async () => {
    await call("/v1/employers/ingest", ingestBody([{
      employerName: "SOUTHERN ALPHA LIMITED",
      nzbn: "9429000000011",
      expiryDateOfAccreditation: "2028-01-01T00:00:00",
    }]));
    await env.DB.prepare(
      `UPDATE employers
          SET employer_name = 'NORTHERN QUANTUM LIMITED',
              normalized_employer_name = 'northern quantum limited'
        WHERE nzbn = '9429000000011'`,
    ).run();

    const oldName = await call("/v1/employers/search", { query: "Southern Alpha" });
    expect(await oldName.json()).toMatchObject({ candidates: [] });
    const newName = await call("/v1/employers/search", { query: "Northern Quantum" });
    expect(await newName.json()).toMatchObject({
      candidates: [{ nzbn: "9429000000011" }],
    });
  });

  it("keeps employer_names_fts rowids aligned with employers across changes", async () => {
    await call("/v1/employers/ingest", ingestBody([
      {
        employerName: "MANUKAU HARBOUR LIMITED",
        nzbn: "9429000000012",
        expiryDateOfAccreditation: "2028-01-01T00:00:00",
      },
      {
        employerName: "RANGITOTO ISLAND TOURS LIMITED",
        nzbn: "9429000000013",
        expiryDateOfAccreditation: "2028-01-01T00:00:00",
      },
    ]));

    const missingRows = await env.DB.prepare(
      `SELECT COUNT(*) AS count
         FROM employers e
         LEFT JOIN employer_names_fts f ON f.rowid = e.rowid
        WHERE f.rowid IS NULL`,
    ).first<{ count: number }>();
    expect(missingRows?.count).toBe(0);

    await env.DB.prepare(
      `UPDATE employers
          SET employer_name = 'HARBOUR EDGE CONSULTING LIMITED',
              normalized_employer_name = 'harbour edge consulting limited'
        WHERE nzbn = '9429000000012'`,
    ).run();

    const renamed = await env.DB.prepare(
      `SELECT f.employer_name
         FROM employer_names_fts f
         JOIN employers e ON e.rowid = f.rowid
        WHERE e.nzbn = '9429000000012'`,
    ).first<{ employer_name: string }>();
    expect(renamed?.employer_name).toBe("HARBOUR EDGE CONSULTING LIMITED");

    await env.DB.prepare(`DELETE FROM employers WHERE nzbn = '9429000000013'`).run();

    const orphanRows = await env.DB.prepare(
      `SELECT COUNT(*) AS count
         FROM employer_names_fts f
         LEFT JOIN employers e ON e.rowid = f.rowid
        WHERE e.rowid IS NULL`,
    ).first<{ count: number }>();
    expect(orphanRows?.count).toBe(0);
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
        state: "associated",
        matchMethod: "exact_employer_name",
        selectedEmployer: { nzbn: employer.nzbn, tradingName: acronym },
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

  it("auto-selects a unique exact official or trading name", async () => {
    await call("/v1/employers/ingest", ingestBody([
      {
        employerName: "UNIVERSITY OF AUCKLAND",
        tradingName: "The University of Auckland",
        nzbn: "9429041925300",
        expiryDateOfAccreditation: "2028-03-31T00:00:00",
      },
      {
        employerName: "AUCKLAND UNIVERSITY OF TECHNOLOGY",
        tradingName: "Auckland University of Technology",
        nzbn: "9429041901069",
        expiryDateOfAccreditation: "2027-08-14T00:00:00",
      },
    ]));

    const tradingName = await call("/v1/employers/resolve", {
      identity: {
        ...linkedinIdentity,
        externalKey: "company:the-university-of-auckland",
        displayName: "The University of Auckland",
        publicUrl: "https://www.linkedin.com/company/the-university-of-auckland/",
      },
    });
    expect(await tradingName.json()).toMatchObject({
      state: "associated",
      matchMethod: "exact_employer_name",
      selectedEmployer: {
        employerName: "UNIVERSITY OF AUCKLAND",
        tradingName: "The University of Auckland",
        nzbn: "9429041925300",
      },
      association: null,
    });
  });

  it("does not auto-select a trading name shared by multiple NZBNs", async () => {
    await call("/v1/employers/ingest", ingestBody([
      {
        employerName: "ALPHA GROUP LIMITED",
        tradingName: "Shared Services",
        nzbn: "9429000000020",
        expiryDateOfAccreditation: "2028-01-01T00:00:00",
      },
      {
        employerName: "BETA GROUP LIMITED",
        tradingName: "Shared Services",
        nzbn: "9429000000021",
        expiryDateOfAccreditation: "2028-01-01T00:00:00",
      },
    ]));

    const response = await call("/v1/employers/resolve", {
      identity: {
        ...linkedinIdentity,
        externalKey: "company:shared-services",
        displayName: "Shared Services",
        publicUrl: "https://www.linkedin.com/company/shared-services/",
      },
    });
    const body = await response.json<{
      state: string;
      matchMethod: string | null;
      selectedEmployer: unknown;
      candidates: unknown[];
    }>();
    expect(body).toMatchObject({
      state: "confirmation_required",
      matchMethod: null,
      selectedEmployer: null,
    });
    expect(body.candidates).toHaveLength(2);
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
    ).bind(Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60).run();

    const response = await call("/v1/employers/resolve", { identity: linkedinIdentity });
    expect(await response.json()).toMatchObject({
      state: "refresh_required",
      matchMethod: "exact_employer_name",
      association: null,
      selectedEmployer: { nzbn: "9429034908822" },
      inzQuery: "9429034908822",
    });
  });

  it("requires refresh as soon as a selected employer's stored expiry has passed", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
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
         '9429034908822', '2020-01-01T00:00:00',
         ?1, ?1, 'inz_official_import',
         '2026-07-27'
       )`,
    ).bind(nowSeconds).run();

    const response = await call("/v1/employers/resolve", { identity: linkedinIdentity });

    expect(await response.json()).toMatchObject({
      state: "refresh_required",
      matchMethod: "exact_employer_name",
      inzQuery: "9429034908822",
      selectedEmployer: {
        nzbn: "9429034908822",
        accreditationStatus: "expired",
      },
    });
  });

  it("authorizes one expired-employer refresh and applies a no-result cooldown", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
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
         '9429034908822', '2020-01-01T00:00:00',
         ?1, ?1, 'inz_official_import',
         '2026-07-27'
       )`,
    ).bind(nowSeconds).run();

    const authorized = await call("/v1/employers/refresh", {
      identity: linkedinIdentity,
      nzbn: "9429034908822",
      manual: false,
    });
    expect(await authorized.json()).toMatchObject({
      state: "authorized",
      inzQuery: "9429034908822",
      retryAt: null,
      resolution: { state: "refresh_required" },
    });

    const duplicate = await call("/v1/employers/refresh", {
      identity: linkedinIdentity,
      nzbn: "9429034908822",
      manual: false,
    });
    expect(await duplicate.json()).toMatchObject({
      state: "cooldown",
      inzQuery: null,
    });

    const storedNoResult = await call(
      "/v1/employers/no-match",
      noMatchBody(linkedinIdentity, "9429034908822"),
    );
    expect(storedNoResult.status).toBe(200);
    const control = await env.DB.prepare(
      `SELECT last_refresh_outcome, refresh_not_before
         FROM employers
        WHERE nzbn = '9429034908822'`,
    ).first<{ last_refresh_outcome: string; refresh_not_before: number }>();
    expect(control?.last_refresh_outcome).toBe("no_result");
    expect(control?.refresh_not_before).toBeGreaterThanOrEqual(nowSeconds + 86_399);

    const deferred = await call("/v1/employers/refresh", {
      identity: linkedinIdentity,
      nzbn: "9429034908822",
      manual: false,
    });
    expect(await deferred.json()).toMatchObject({
      state: "cooldown",
      inzQuery: null,
      resolution: { state: "refresh_required" },
    });
  });

  it("allows a manual refresh without creating a platform association", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO employers (
         employer_name, normalized_employer_name,
         trading_name, normalized_trading_name,
         nzbn, expiry_date_of_accreditation,
         first_seen_at, last_verified_at, last_verified_source,
         official_snapshot_date
       ) VALUES (
         'ONE NEW ZEALAND GROUP LIMITED', 'one new zealand group limited',
         'One New Zealand', 'one new zealand',
         '9429034908822', '2030-01-01T00:00:00',
         ?1, ?1, 'inz_official_import',
         '2026-07-27'
       )`,
    ).bind(nowSeconds).run();

    const response = await call("/v1/employers/refresh", {
      identity: linkedinIdentity,
      nzbn: "9429034908822",
      manual: true,
    });

    expect(await response.json()).toMatchObject({
      state: "authorized",
      inzQuery: "9429034908822",
    });
    const confirmations = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM platform_employer_confirmations",
    ).first<{ count: number }>();
    expect(confirmations?.count).toBe(0);
  });

  it("rejects an NZBN no-result without a current refresh authorization", async () => {
    await call("/v1/employers/ingest", ingestBody());

    const response = await call(
      "/v1/employers/no-match",
      noMatchBody(linkedinIdentity, "9429034908822"),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "refresh_not_authorized" },
    });
  });

  it("uses the same positive TTL for live lookups and official imports", async () => {
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
      state: "associated",
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
  it("stores and reuses an exact no-match observation for seven days", async () => {
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
    ).toBe(7 * 24 * 60 * 60 * 1000);

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

  it("expires at seven days and ignores an observation for a changed display name", async () => {
    await call("/v1/employers/no-match", noMatchBody());
    await env.DB.prepare(
      "UPDATE platform_entities SET last_no_match_at = ?1 WHERE platform = 'linkedin' AND external_key = 'company:onenz'",
    ).bind(Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60).run();

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
      state: "associated",
      matchMethod: "exact_employer_name",
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

  it("returns refresh_required at 30 days and keeps accreditation separate", async () => {
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
    ).bind(Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60).run();

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
