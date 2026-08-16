import { ApiError } from "./errors";
import type { PlatformIdentity } from "./types";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const NZBN_PATTERN = /^\d{13}$/u;
const LINKEDIN_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export interface ResolveRequest {
  identity: PlatformIdentity;
}

export interface EmployerSearchRequest {
  query: string;
}

export interface IngestRequest extends ResolveRequest {
  query: string;
  page: number;
  inzResponse: unknown;
}

export interface AssociationRequest extends ResolveRequest {
  nzbn: string;
}

export interface EmployerRefreshRequest extends AssociationRequest {
  manual: boolean;
}

export interface NoMatchRequest extends ResolveRequest {
  query: string;
  normalizedQuery: string;
  targetNzbn: string | null;
  inzResponse: {
    Title: "No Results";
    Message: string;
  };
}

export interface WaitlistRequest {
  email: string;
  website: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function validateText(
  value: unknown,
  fieldName: string,
  minimumLength: number,
  maximumLength: number,
): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_identity", `${fieldName} must be a string.`);
  }
  const text = value.trim();
  if (
    text.length < minimumLength ||
    text.length > maximumLength ||
    CONTROL_CHARACTERS.test(text)
  ) {
    throw new ApiError(400, "invalid_identity", `${fieldName} is invalid.`);
  }
  return text;
}

function validateQuery(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_submission", "The query must be a string.");
  }
  const query = value.trim();
  if (query.length < 3 || query.length > 100 || CONTROL_CHARACTERS.test(query)) {
    throw new ApiError(
      400,
      "invalid_submission",
      "The query must contain between 3 and 100 valid characters.",
    );
  }
  return query;
}

function validatePage(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new ApiError(
      400,
      "invalid_submission",
      "The page must be an integer from 1 to 100.",
    );
  }
  return value;
}

function parsePublicUrl(value: unknown, hostname: string): URL | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_identity", "publicUrl must be a URL or null.");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, "invalid_identity", "publicUrl must be a valid URL.");
  }
  if (url.protocol !== "https:" || url.hostname !== hostname || url.search !== "" || url.hash !== "") {
    throw new ApiError(400, "invalid_identity", "publicUrl is invalid for the platform.");
  }
  return url;
}

function parseIdentity(value: unknown): PlatformIdentity {
  if (!isRecord(value)) {
    throw new ApiError(400, "invalid_identity", "identity must be a JSON object.");
  }

  const displayName = validateText(value.displayName, "displayName", 1, 300);
  const externalKey = validateText(value.externalKey, "externalKey", 3, 400).toLowerCase();

  if (value.platform === "linkedin") {
    if (value.kind !== "linkedin_company_url" || value.strength !== "strong") {
      throw new ApiError(400, "invalid_identity", "LinkedIn identity fields are inconsistent.");
    }
    const url = parsePublicUrl(value.publicUrl, "www.linkedin.com");
    const match = url?.pathname.match(/^\/company\/([^/]+)\/?$/u);
    const slug = match?.[1]?.toLowerCase();
    if (slug === undefined || !LINKEDIN_SLUG_PATTERN.test(slug) || externalKey !== `company:${slug}`) {
      throw new ApiError(400, "invalid_identity", "LinkedIn company identity is invalid.");
    }
    return {
      platform: "linkedin",
      externalKey,
      kind: "linkedin_company_url",
      strength: "strong",
      displayName,
      publicUrl: `https://www.linkedin.com/company/${slug}/`,
    };
  }

  if (value.platform !== "seek") {
    throw new ApiError(400, "invalid_identity", "platform must be linkedin or seek.");
  }

  if (value.kind === "seek_company_profile") {
    if (value.strength !== "strong") {
      throw new ApiError(400, "invalid_identity", "SEEK company profile strength is invalid.");
    }
    const url = parsePublicUrl(value.publicUrl, "nz.seek.com");
    const path = url?.pathname.replace(/\/$/u, "").toLowerCase();
    if (path === undefined || !/^\/companies\/[a-z0-9][a-z0-9-]{0,199}$/u.test(path)) {
      throw new ApiError(400, "invalid_identity", "SEEK company profile URL is invalid.");
    }
    if (externalKey !== `company:${path}`) {
      throw new ApiError(400, "invalid_identity", "SEEK company externalKey is invalid.");
    }
    return {
      platform: "seek",
      externalKey,
      kind: "seek_company_profile",
      strength: "strong",
      displayName,
      publicUrl: `https://nz.seek.com${path}`,
    };
  }

  if (value.kind !== "seek_advertiser_name" || value.strength !== "weak" || value.publicUrl !== null) {
    throw new ApiError(400, "invalid_identity", "SEEK advertiser identity fields are inconsistent.");
  }
  if (externalKey !== `advertiser:${normalizeName(displayName)}`) {
    throw new ApiError(400, "invalid_identity", "SEEK advertiser externalKey is invalid.");
  }
  return {
    platform: "seek",
    externalKey,
    kind: "seek_advertiser_name",
    strength: "weak",
    displayName,
    publicUrl: null,
  };
}

function parseEnvelope(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ApiError(400, "invalid_submission", "The request body must be a JSON object.");
  }
  return value;
}

export function parseResolveRequest(value: unknown): ResolveRequest {
  const record = parseEnvelope(value);
  return { identity: parseIdentity(record.identity) };
}

export function parseEmployerSearchRequest(value: unknown): EmployerSearchRequest {
  const record = parseEnvelope(value);
  return { query: validateQuery(record.query) };
}

export function parseIngestRequest(value: unknown): IngestRequest {
  const record = parseEnvelope(value);
  if (!("inzResponse" in record)) {
    throw new ApiError(400, "invalid_submission", "inzResponse is required.");
  }
  const query = validateQuery(record.query);
  return {
    identity: parseIdentity(record.identity),
    query,
    page: validatePage(record.page),
    inzResponse: record.inzResponse,
  };
}

export function parseAssociationRequest(value: unknown): AssociationRequest {
  const record = parseEnvelope(value);
  if (typeof record.nzbn !== "string" || !NZBN_PATTERN.test(record.nzbn)) {
    throw new ApiError(400, "invalid_nzbn", "nzbn must contain exactly 13 digits.");
  }
  return { identity: parseIdentity(record.identity), nzbn: record.nzbn };
}

export function parseEmployerRefreshRequest(value: unknown): EmployerRefreshRequest {
  const record = parseEnvelope(value);
  const association = parseAssociationRequest(record);
  if (typeof record.manual !== "boolean") {
    throw new ApiError(400, "invalid_submission", "manual must be a boolean.");
  }
  return { ...association, manual: record.manual };
}

export function parseNoMatchRequest(value: unknown): NoMatchRequest {
  const record = parseEnvelope(value);
  const identity = parseIdentity(record.identity);
  const query = validateQuery(record.query);
  const normalizedQuery = normalizeName(query);
  const targetNzbn = NZBN_PATTERN.test(query) ? query : null;
  if (targetNzbn === null && normalizedQuery !== normalizeName(identity.displayName)) {
    throw new ApiError(
      400,
      "query_mismatch",
      "The no-match query must match the platform display name.",
    );
  }
  if (
    !isRecord(record.inzResponse) ||
    record.inzResponse.Title !== "No Results" ||
    typeof record.inzResponse.Message !== "string" ||
    !record.inzResponse.Message.trimStart().startsWith("Your search found no results.")
  ) {
    throw new ApiError(
      400,
      "invalid_no_match_response",
      "The submitted INZ no-match response is invalid.",
    );
  }
  return {
    identity,
    query,
    normalizedQuery,
    targetNzbn,
    inzResponse: {
      Title: "No Results",
      Message: record.inzResponse.Message,
    },
  };
}

export function parseWaitlistRequest(value: unknown): WaitlistRequest {
  const record = parseEnvelope(value);
  if (typeof record.email !== "string") {
    throw new ApiError(400, "invalid_email", "A valid email address is required.");
  }
  const email = record.email.normalize("NFKC").trim().toLowerCase();
  if (email.length > 254 || CONTROL_CHARACTERS.test(email) || !EMAIL_PATTERN.test(email)) {
    throw new ApiError(400, "invalid_email", "A valid email address is required.");
  }

  const website = record.website ?? "";
  if (typeof website !== "string" || website.length > 300) {
    throw new ApiError(400, "invalid_submission", "The request body is invalid.");
  }
  return { email, website: website.trim() };
}

export function validateClientId(value: string | null): string {
  if (value === null || !UUID_PATTERN.test(value)) {
    throw new ApiError(
      400,
      "invalid_client_id",
      "A valid UUID is required in the X-Client-ID header.",
    );
  }
  return value.toLowerCase();
}
