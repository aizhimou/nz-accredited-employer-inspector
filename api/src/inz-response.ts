import { InzResponseError } from "./errors";
import { getExpiryDate } from "./time";
import type { ParsedInzEmployer, ParsedInzResponse } from "./types";

const MAX_RESULTS_PER_PAGE = 50;
const MAX_NAME_LENGTH = 300;
const NZBN_PATTERN = /^\d{13}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonNegativeInteger(record: UnknownRecord, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new InzResponseError(`INZ returned an invalid ${key} value.`);
  }
  return value;
}

function validateName(value: string | undefined, fieldName: string): string {
  if (
    value === undefined ||
    value.length === 0 ||
    value.length > MAX_NAME_LENGTH ||
    CONTROL_CHARACTERS.test(value)
  ) {
    throw new InzResponseError(`INZ returned an invalid ${fieldName}.`);
  }
  return value;
}

function parseFields(value: unknown): ParsedInzEmployer {
  if (!isRecord(value) || !isRecord(value.field_schema)) {
    throw new InzResponseError("INZ returned a result without field_schema.");
  }

  const rawFields = value.field_schema.raw;
  if (!Array.isArray(rawFields)) {
    throw new InzResponseError("INZ returned a result without raw fields.");
  }

  const fields = new Map<string, string>();
  for (const rawField of rawFields) {
    if (!isRecord(rawField)) {
      continue;
    }
    const apiColumn = rawField.APIColumn;
    const fieldValue = rawField.Value;
    if (typeof apiColumn === "string" && typeof fieldValue === "string") {
      fields.set(apiColumn, fieldValue.trim());
    }
  }

  const employerName = validateName(fields.get("employerName"), "employer name");
  const rawTradingName = fields.get("tradingName");
  const tradingName = rawTradingName === undefined || rawTradingName === ""
    ? null
    : validateName(rawTradingName, "trading name");
  const nzbn = fields.get("nzbn");
  const expiryDateOfAccreditation = fields.get("expiryDateOfAccreditation");

  if (nzbn === undefined || !NZBN_PATTERN.test(nzbn)) {
    throw new InzResponseError("INZ returned a result with an invalid NZBN.");
  }
  if (
    expiryDateOfAccreditation === undefined ||
    getExpiryDate(expiryDateOfAccreditation) === null
  ) {
    throw new InzResponseError(
      "INZ returned a result with an invalid accreditation expiry date.",
    );
  }

  return { employerName, tradingName, nzbn, expiryDateOfAccreditation };
}

export function parseInzResponse(value: unknown): ParsedInzResponse {
  if (!isRecord(value)) {
    throw new InzResponseError("INZ returned a non-object response.");
  }

  if (typeof value.results !== "string") {
    throw new InzResponseError("INZ returned a non-string results field.");
  }

  let rawResults: unknown;
  try {
    rawResults = JSON.parse(value.results) as unknown;
  } catch {
    throw new InzResponseError("INZ returned malformed result JSON.");
  }
  if (!Array.isArray(rawResults) || rawResults.length > MAX_RESULTS_PER_PAGE) {
    throw new InzResponseError("INZ returned an invalid result list.");
  }

  const results = rawResults.map(parseFields);
  const seenNzbns = new Set<string>();
  for (const result of results) {
    if (seenNzbns.has(result.nzbn)) {
      throw new InzResponseError("INZ returned a duplicate NZBN.");
    }
    seenNzbns.add(result.nzbn);
  }

  const current = readNonNegativeInteger(value, "current");
  const totalPages = readNonNegativeInteger(value, "totalPages");
  const totalResults = readNonNegativeInteger(value, "totalResults");

  if (results.length > totalResults) {
    throw new InzResponseError("INZ result totals are inconsistent.");
  }
  if (totalResults === 0 && (results.length > 0 || totalPages !== 0)) {
    throw new InzResponseError("INZ result totals are inconsistent.");
  }
  if (
    totalResults > 0 &&
    (results.length === 0 || totalPages === 0 || current === 0 || current > totalPages)
  ) {
    throw new InzResponseError("INZ pagination is inconsistent.");
  }

  return { results, current, totalPages, totalResults };
}
