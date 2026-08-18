import assert from "node:assert/strict";
import test from "node:test";

import {
  D1Client,
  addCalendarDays,
  fetchInzEmployer,
  getAucklandDate,
  isInzNoResultsBody,
  normalizeName,
  parseInzResponse,
  refreshEmployer,
} from "./refresh-expiring-employers.mjs";

function createInzResponse({
  employerName = "CATCH DESIGN LIMITED",
  tradingName = "Bastion Digital",
  nzbn = "9429034641101",
  expiryDateOfAccreditation = "2027-02-17T00:00:00",
} = {}) {
  return {
    results: JSON.stringify([
      {
        field_schema: {
          raw: [
            { APIColumn: "employerName", Value: employerName },
            { APIColumn: "tradingName", Value: tradingName },
            { APIColumn: "nzbn", Value: nzbn },
            {
              APIColumn: "expiryDateOfAccreditation",
              Value: expiryDateOfAccreditation,
            },
          ],
        },
      },
    ]),
    current: 1,
    totalPages: 1,
    totalResults: 1,
  };
}

test("calculates Auckland dates and calendar-day cutoffs", () => {
  assert.equal(getAucklandDate(Date.parse("2026-08-04T11:30:00Z")), "2026-08-04");
  assert.equal(getAucklandDate(Date.parse("2026-08-04T12:30:00Z")), "2026-08-05");
  assert.equal(addCalendarDays("2026-12-27", 7), "2027-01-03");
});

test("parses and normalizes a positive INZ employer", () => {
  const response = parseInzResponse(createInzResponse());
  assert.deepEqual(response.results, [
    {
      employerName: "CATCH DESIGN LIMITED",
      tradingName: "Bastion Digital",
      nzbn: "9429034641101",
      expiryDateOfAccreditation: "2027-02-17T00:00:00",
    },
  ]);
  assert.equal(normalizeName("  Catch   Design LIMITED  "), "catch design limited");
});

test("rejects a malformed positive INZ employer", () => {
  assert.throws(
    () => parseInzResponse(createInzResponse({ nzbn: "not-an-nzbn" })),
    /invalid NZBN/u,
  );
});

test("recognizes only the expected INZ no-result envelope", () => {
  assert.equal(
    isInzNoResultsBody({
      Title: "No Results",
      Message: "Your search found no results.\n Please refine your search.",
    }),
    true,
  );
  assert.equal(
    isInzNoResultsBody({ Title: "No Results", Message: "Temporary service failure." }),
    false,
  );
});

test("fetches an exact positive INZ result", async () => {
  const outcome = await fetchInzEmployer("9429034641101", {
    fetchFn: async (_url, init) => {
      assert.ok(init.body instanceof FormData);
      assert.equal(init.body.get("query"), "9429034641101");
      assert.equal(init.body.get("collection"), "2");
      assert.equal(init.body.get("page"), "1");
      return Response.json(createInzResponse());
    },
  });
  assert.equal(outcome.kind, "positive");
  assert.equal(outcome.employer.nzbn, "9429034641101");
});

test("returns no_result only for the recognized 400 envelope", async () => {
  const outcome = await fetchInzEmployer("9429034641101", {
    fetchFn: async () =>
      Response.json(
        {
          Title: "No Results",
          Message: "Your search found no results. Please refine your search.",
        },
        { status: 400 },
      ),
  });
  assert.deepEqual(outcome, { kind: "no_result" });
});

test("sends parameterized SQL to the D1 REST API", async () => {
  const client = new D1Client(
    {
      cloudflareApiToken: "test-token",
      cloudflareAccountId: "test-account",
      cloudflareDatabaseId: "test-database",
      d1TimeoutMilliseconds: 1_000,
    },
    async (url, init) => {
      assert.match(String(url), /accounts\/test-account\/d1\/database\/test-database\/query$/u);
      assert.equal(init.headers.Authorization, "Bearer test-token");
      assert.deepEqual(JSON.parse(init.body), {
        sql: "SELECT ?1 AS value",
        params: [42],
      });
      return Response.json({
        success: true,
        result: [{ success: true, results: [{ value: 42 }], meta: { changes: 0 } }],
      });
    },
  );

  assert.deepEqual(await client.query("SELECT ?1 AS value", [42]), {
    rows: [{ value: 42 }],
    changes: 0,
  });
});

test("claims and stores a positive refresh outcome", async () => {
  const queries = [];
  const d1 = {
    async query(sql, params) {
      queries.push({ sql, params });
      return {
        rows: [],
        changes: sql.includes("last_refresh_outcome = 'positive'") ? 3 : 1,
      };
    },
  };
  const times = [Date.parse("2026-08-18T00:00:00Z"), Date.parse("2026-08-18T00:00:02Z")];
  const outcome = await refreshEmployer(
    d1,
    {
      nzbn: "9429034641101",
      employerName: "OLD NAME LIMITED",
      expiryDateOfAccreditation: "2026-08-01T00:00:00",
    },
    "2026-08-26",
    {
      refreshAttemptCooldownSeconds: 900,
      refreshNoResultCooldownSeconds: 86_400,
      inzTimeoutMilliseconds: 5_000,
    },
    {
      now: () => times.shift(),
      fetchFn: async () => Response.json(createInzResponse()),
    },
  );

  assert.equal(outcome.kind, "positive");
  assert.equal(queries.length, 2);
  assert.match(queries[0].sql, /last_refresh_outcome = 'pending'/u);
  assert.match(queries[1].sql, /last_refresh_outcome = 'positive'/u);
  assert.equal(queries[1].params[0], "9429034641101");
  assert.equal(queries[1].params[2], "catch design limited");
  assert.equal(queries[1].params[8], Date.parse("2026-08-18T00:00:00Z") / 1_000);
});

test("claims and stores a no-result refresh outcome without replacing official fields", async () => {
  const queries = [];
  const d1 = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [], changes: 1 };
    },
  };
  const times = [Date.parse("2026-08-18T00:00:00Z"), Date.parse("2026-08-18T00:00:02Z")];
  const outcome = await refreshEmployer(
    d1,
    {
      nzbn: "9429034641101",
      employerName: "OLD NAME LIMITED",
      expiryDateOfAccreditation: "2026-08-01T00:00:00",
    },
    "2026-08-26",
    {
      refreshAttemptCooldownSeconds: 900,
      refreshNoResultCooldownSeconds: 86_400,
      inzTimeoutMilliseconds: 5_000,
    },
    {
      now: () => times.shift(),
      fetchFn: async () =>
        Response.json(
          {
            Title: "No Results",
            Message: "Your search found no results. Please refine your search.",
          },
          { status: 400 },
        ),
    },
  );

  assert.deepEqual(outcome, { kind: "no_result" });
  assert.equal(queries.length, 2);
  assert.match(queries[1].sql, /last_refresh_outcome = 'no_result'/u);
  assert.doesNotMatch(queries[1].sql, /last_verified_at/u);
  assert.doesNotMatch(queries[1].sql, /employer_name/u);
  assert.equal(
    queries[1].params[2] - queries[1].params[1],
    86_400,
  );
});
