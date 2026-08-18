#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const D1_API_BASE_URL = "https://api.cloudflare.com/client/v4";
const INZ_API_URL = "https://www.immigration.govt.nz/list-api/getAPIResults/";
const INZ_COLLECTION_ID = "2";
const NZBN_PATTERN = /^\d{13}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const EXPIRY_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const MAX_NAME_LENGTH = 300;

const aucklandDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Pacific/Auckland",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredEnvironmentVariable(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function positiveIntegerEnvironmentVariable(name, defaultValue, minimum = 1) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return defaultValue;
  }
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
  }
  return parsed;
}

function optionalPositiveIntegerEnvironmentVariable(name) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return null;
  }
  return positiveIntegerEnvironmentVariable(name, 1);
}

export function readConfig() {
  return {
    cloudflareApiToken: requiredEnvironmentVariable("CLOUDFLARE_API_TOKEN"),
    cloudflareAccountId: requiredEnvironmentVariable("CLOUDFLARE_ACCOUNT_ID"),
    cloudflareDatabaseId: requiredEnvironmentVariable("CLOUDFLARE_D1_DATABASE_ID"),
    refreshIntervalMilliseconds: positiveIntegerEnvironmentVariable(
      "REFRESH_INTERVAL_MS",
      3_000,
      3_000,
    ),
    inzTimeoutMilliseconds: positiveIntegerEnvironmentVariable("INZ_TIMEOUT_MS", 5_000),
    d1TimeoutMilliseconds: positiveIntegerEnvironmentVariable("D1_TIMEOUT_MS", 30_000),
    refreshAttemptCooldownSeconds: positiveIntegerEnvironmentVariable(
      "REFRESH_ATTEMPT_COOLDOWN_SECONDS",
      900,
    ),
    refreshNoResultCooldownSeconds: positiveIntegerEnvironmentVariable(
      "REFRESH_NO_RESULT_COOLDOWN_SECONDS",
      86_400,
    ),
    maxEmployers: optionalPositiveIntegerEnvironmentVariable("MAX_EMPLOYERS"),
  };
}

export function isValidDateOnly(value) {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function getExpiryDate(value) {
  if (typeof value !== "string" || !EXPIRY_PATTERN.test(value)) {
    return null;
  }
  const dateOnly = value.slice(0, 10);
  return isValidDateOnly(dateOnly) ? dateOnly : null;
}

export function getAucklandDate(epochMilliseconds = Date.now()) {
  const values = Object.fromEntries(
    aucklandDateFormatter
      .formatToParts(epochMilliseconds)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  if (!values.year || !values.month || !values.day) {
    throw new Error("Could not calculate the current Auckland date.");
  }
  return `${values.year}-${values.month}-${values.day}`;
}

export function addCalendarDays(dateOnly, days) {
  if (!isValidDateOnly(dateOnly) || !Number.isSafeInteger(days)) {
    throw new Error("A valid date and integer day offset are required.");
  }
  const [year, month, day] = dateOnly.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function normalizeName(value) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function validateName(value, fieldName) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_NAME_LENGTH ||
    CONTROL_CHARACTERS.test(value)
  ) {
    throw new Error(`INZ returned an invalid ${fieldName}.`);
  }
  return value;
}

function readNonNegativeInteger(record, key) {
  const value = record[key];
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`INZ returned an invalid ${key} value.`);
  }
  return value;
}

function parseEmployerFields(value) {
  if (!isRecord(value) || !isRecord(value.field_schema)) {
    throw new Error("INZ returned a result without field_schema.");
  }
  const rawFields = value.field_schema.raw;
  if (!Array.isArray(rawFields)) {
    throw new Error("INZ returned a result without raw fields.");
  }

  const fields = new Map();
  for (const rawField of rawFields) {
    if (
      isRecord(rawField) &&
      typeof rawField.APIColumn === "string" &&
      typeof rawField.Value === "string"
    ) {
      fields.set(rawField.APIColumn, rawField.Value.trim());
    }
  }

  const employerName = validateName(fields.get("employerName"), "employer name");
  const rawTradingName = fields.get("tradingName");
  const tradingName =
    rawTradingName === undefined || rawTradingName === ""
      ? null
      : validateName(rawTradingName, "trading name");
  const nzbn = fields.get("nzbn");
  const expiryDateOfAccreditation = fields.get("expiryDateOfAccreditation");

  if (typeof nzbn !== "string" || !NZBN_PATTERN.test(nzbn)) {
    throw new Error("INZ returned a result with an invalid NZBN.");
  }
  if (getExpiryDate(expiryDateOfAccreditation) === null) {
    throw new Error("INZ returned a result with an invalid accreditation expiry date.");
  }

  return { employerName, tradingName, nzbn, expiryDateOfAccreditation };
}

export function parseInzResponse(value) {
  if (!isRecord(value) || typeof value.results !== "string") {
    throw new Error("INZ returned an invalid response.");
  }

  let rawResults;
  try {
    rawResults = JSON.parse(value.results);
  } catch {
    throw new Error("INZ returned malformed result JSON.");
  }
  if (!Array.isArray(rawResults) || rawResults.length > 50) {
    throw new Error("INZ returned an invalid result list.");
  }

  const results = rawResults.map(parseEmployerFields);
  if (new Set(results.map((employer) => employer.nzbn)).size !== results.length) {
    throw new Error("INZ returned a duplicate NZBN.");
  }

  const current = readNonNegativeInteger(value, "current");
  const totalPages = readNonNegativeInteger(value, "totalPages");
  const totalResults = readNonNegativeInteger(value, "totalResults");
  if (
    results.length > totalResults ||
    (totalResults === 0 && (results.length > 0 || totalPages !== 0)) ||
    (totalResults > 0 &&
      (results.length === 0 || totalPages === 0 || current === 0 || current > totalPages))
  ) {
    throw new Error("INZ result totals are inconsistent.");
  }

  return { results, current, totalPages, totalResults };
}

export function isInzNoResultsBody(value) {
  return (
    isRecord(value) &&
    value.Title === "No Results" &&
    typeof value.Message === "string" &&
    value.Message.trimStart().startsWith("Your search found no results.")
  );
}

function formatCloudflareErrors(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.errors)) {
    return "Cloudflare D1 request failed.";
  }
  const messages = payload.errors
    .filter(isRecord)
    .map((error) => error.message)
    .filter((message) => typeof message === "string" && message.length > 0);
  return messages.length > 0 ? messages.join("; ") : "Cloudflare D1 request failed.";
}

export class D1Client {
  constructor(config, fetchFn = fetch) {
    this.config = config;
    this.fetchFn = fetchFn;
  }

  async query(sql, params = []) {
    const url =
      `${D1_API_BASE_URL}/accounts/${encodeURIComponent(this.config.cloudflareAccountId)}` +
      `/d1/database/${encodeURIComponent(this.config.cloudflareDatabaseId)}/query`;

    let response;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.cloudflareApiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql, params }),
        signal: AbortSignal.timeout(this.config.d1TimeoutMilliseconds),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown network error";
      throw new Error(`Could not reach Cloudflare D1: ${reason}`);
    }

    const responseText = await response.text();
    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new Error(`Cloudflare D1 returned HTTP ${response.status} with invalid JSON.`);
    }
    if (!response.ok || !isRecord(payload) || payload.success !== true) {
      throw new Error(formatCloudflareErrors(payload));
    }
    if (!Array.isArray(payload.result) || payload.result.length !== 1) {
      throw new Error("Cloudflare D1 returned an unexpected query result.");
    }

    const statement = payload.result[0];
    if (!isRecord(statement) || statement.success === false) {
      throw new Error("Cloudflare D1 did not execute the SQL statement successfully.");
    }
    const rows = Array.isArray(statement.results) ? statement.results : [];
    const changes =
      isRecord(statement.meta) && Number.isSafeInteger(statement.meta.changes)
        ? statement.meta.changes
        : 0;
    return { rows, changes };
  }
}

export async function fetchInzEmployer(
  nzbn,
  { fetchFn = fetch, timeoutMilliseconds = 5_000 } = {},
) {
  const formData = new FormData();
  formData.set("query", nzbn);
  formData.set("collection", INZ_COLLECTION_ID);
  formData.set("page", "1");

  let response;
  try {
    response = await fetchFn(INZ_API_URL, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: formData,
      signal: AbortSignal.timeout(timeoutMilliseconds),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown network error";
    throw new Error(`Could not reach INZ: ${reason}`);
  }

  const responseText = await response.text();
  let body;
  try {
    body = JSON.parse(responseText);
  } catch {
    throw new Error(`INZ returned HTTP ${response.status} with invalid JSON.`);
  }

  if (response.status === 400 && isInzNoResultsBody(body)) {
    return { kind: "no_result" };
  }
  if (!response.ok) {
    throw new Error(`INZ returned unexpected HTTP ${response.status}.`);
  }

  const parsed = parseInzResponse(body);
  if (parsed.current !== 1) {
    throw new Error("INZ returned a different page from the one requested.");
  }
  const matches = parsed.results.filter((employer) => employer.nzbn === nzbn);
  if (matches.length !== 1) {
    throw new Error("INZ positive response did not contain the requested NZBN exactly once.");
  }
  return { kind: "positive", employer: matches[0] };
}

function assertEligibleEmployerRow(value) {
  if (
    !isRecord(value) ||
    typeof value.nzbn !== "string" ||
    !NZBN_PATTERN.test(value.nzbn) ||
    typeof value.employer_name !== "string" ||
    getExpiryDate(value.expiry_date_of_accreditation) === null
  ) {
    throw new Error("Cloudflare D1 returned an invalid employer row.");
  }
  return {
    nzbn: value.nzbn,
    employerName: value.employer_name,
    expiryDateOfAccreditation: value.expiry_date_of_accreditation,
  };
}

export async function fetchEligibleEmployers(d1, cutoffExclusiveDate, nowSeconds) {
  const result = await d1.query(
    `SELECT nzbn, employer_name, expiry_date_of_accreditation
       FROM employers
      WHERE expiry_date_of_accreditation < ?1
        AND (refresh_not_before IS NULL OR refresh_not_before <= ?2)
      ORDER BY expiry_date_of_accreditation, nzbn`,
    [cutoffExclusiveDate, nowSeconds],
  );
  return result.rows.map(assertEligibleEmployerRow);
}

async function claimEmployer(d1, employer, cutoffExclusiveDate, nowSeconds, leaseUntil) {
  const result = await d1.query(
    `UPDATE employers
        SET last_refresh_attempt_at = ?2,
            last_refresh_outcome = 'pending',
            refresh_not_before = ?3
      WHERE nzbn = ?1
        AND expiry_date_of_accreditation < ?4
        AND (refresh_not_before IS NULL OR refresh_not_before <= ?2)`,
    [employer.nzbn, nowSeconds, leaseUntil, cutoffExclusiveDate],
  );
  return result.changes === 1;
}

async function storePositiveResult(d1, employer, claimedAt, verifiedAt, retryAt) {
  const result = await d1.query(
    `UPDATE employers
        SET employer_name = ?2,
            normalized_employer_name = ?3,
            trading_name = ?4,
            normalized_trading_name = ?5,
            expiry_date_of_accreditation = ?6,
            last_verified_at = ?7,
            last_verified_source = 'inz_live_lookup',
            last_refresh_attempt_at = ?7,
            last_refresh_outcome = 'positive',
            refresh_not_before = ?8
      WHERE nzbn = ?1
        AND last_refresh_outcome = 'pending'
        AND last_refresh_attempt_at = ?9`,
    [
      employer.nzbn,
      employer.employerName,
      normalizeName(employer.employerName),
      employer.tradingName,
      employer.tradingName === null ? null : normalizeName(employer.tradingName),
      employer.expiryDateOfAccreditation,
      verifiedAt,
      retryAt,
      claimedAt,
    ],
  );
  if (result.changes < 1) {
    throw new Error("The refresh claim changed before the positive result could be stored.");
  }
}

async function storeNoResult(d1, nzbn, claimedAt, checkedAt, retryAt) {
  const result = await d1.query(
    `UPDATE employers
        SET last_refresh_attempt_at = ?2,
            last_refresh_outcome = 'no_result',
            refresh_not_before = ?3
      WHERE nzbn = ?1
        AND last_refresh_outcome = 'pending'
        AND last_refresh_attempt_at = ?4`,
    [nzbn, checkedAt, retryAt, claimedAt],
  );
  if (result.changes !== 1) {
    throw new Error("The refresh claim changed before the no-result outcome could be stored.");
  }
}

export async function refreshEmployer(
  d1,
  candidate,
  cutoffExclusiveDate,
  config,
  { fetchFn = fetch, now = Date.now } = {},
) {
  const claimedAt = Math.floor(now() / 1_000);
  const leaseUntil = claimedAt + config.refreshAttemptCooldownSeconds;
  const claimed = await claimEmployer(
    d1,
    candidate,
    cutoffExclusiveDate,
    claimedAt,
    leaseUntil,
  );
  if (!claimed) {
    return { kind: "skipped" };
  }

  const inzResult = await fetchInzEmployer(candidate.nzbn, {
    fetchFn,
    timeoutMilliseconds: config.inzTimeoutMilliseconds,
  });
  const completedAt = Math.floor(now() / 1_000);

  if (inzResult.kind === "no_result") {
    await storeNoResult(
      d1,
      candidate.nzbn,
      claimedAt,
      completedAt,
      completedAt + config.refreshNoResultCooldownSeconds,
    );
    return { kind: "no_result" };
  }

  const expiryDate = getExpiryDate(inzResult.employer.expiryDateOfAccreditation);
  const currentAucklandDate = getAucklandDate(completedAt * 1_000);
  const cooldownSeconds =
    expiryDate !== null && expiryDate < currentAucklandDate
      ? config.refreshNoResultCooldownSeconds
      : config.refreshAttemptCooldownSeconds;
  await storePositiveResult(
    d1,
    inzResult.employer,
    claimedAt,
    completedAt,
    completedAt + cooldownSeconds,
  );
  return {
    kind: "positive",
    employer: inzResult.employer,
    previousExpiryDate: candidate.expiryDateOfAccreditation,
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatProgress(current, total) {
  return `[${current}/${total}]`;
}

export async function run() {
  const config = readConfig();
  const d1 = new D1Client(config);
  const startedAt = Date.now();
  const aucklandToday = getAucklandDate(startedAt);
  const cutoffInclusiveDate = addCalendarDays(aucklandToday, 7);
  const cutoffExclusiveDate = addCalendarDays(aucklandToday, 8);

  console.log(`Loading employers expiring on or before ${cutoffInclusiveDate} (Auckland)...`);
  let employers = await fetchEligibleEmployers(
    d1,
    cutoffExclusiveDate,
    Math.floor(startedAt / 1_000),
  );
  if (config.maxEmployers !== null) {
    employers = employers.slice(0, config.maxEmployers);
  }
  console.log(`Found ${employers.length.toLocaleString("en-NZ")} eligible employers.`);

  const counts = { positive: 0, no_result: 0, failed: 0, skipped: 0 };
  let stopRequested = false;
  const requestStop = () => {
    stopRequested = true;
    console.log("Stop requested; finishing the current employer before exiting.");
  };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);

  try {
    for (const [index, employer] of employers.entries()) {
      if (stopRequested) {
        break;
      }
      const progress = formatProgress(index + 1, employers.length);
      let madeInzRequest = false;
      try {
        const outcome = await refreshEmployer(d1, employer, cutoffExclusiveDate, config);
        madeInzRequest = outcome.kind !== "skipped";
        counts[outcome.kind] += 1;
        if (outcome.kind === "positive") {
          console.log(
            `${progress} ${employer.nzbn} positive: ` +
              `${outcome.previousExpiryDate} -> ${outcome.employer.expiryDateOfAccreditation}`,
          );
        } else if (outcome.kind === "no_result") {
          console.log(`${progress} ${employer.nzbn} no_result; retry after cooldown.`);
        } else {
          console.log(`${progress} ${employer.nzbn} skipped; no longer eligible or already claimed.`);
        }
      } catch (error) {
        madeInzRequest = true;
        counts.failed += 1;
        const message = error instanceof Error ? error.message : "Unknown error.";
        console.error(`${progress} ${employer.nzbn} failed: ${message}`);
      }

      if (madeInzRequest && !stopRequested && index < employers.length - 1) {
        await sleep(config.refreshIntervalMilliseconds);
      }
    }
  } finally {
    process.removeListener("SIGINT", requestStop);
    process.removeListener("SIGTERM", requestStop);
  }

  console.log(
    `Done: positive=${counts.positive}, no_result=${counts.no_result}, ` +
      `failed=${counts.failed}, skipped=${counts.skipped}`,
  );
  if (counts.failed > 0) {
    process.exitCode = 1;
  }
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  run().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown fatal error.";
    console.error(`Fatal: ${message}`);
    process.exitCode = 1;
  });
}
