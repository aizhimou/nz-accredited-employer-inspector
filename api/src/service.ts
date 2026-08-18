import type { FreshnessPolicy } from "./config";
import { ApiError, InzResponseError } from "./errors";
import { parseInzResponse } from "./inz-response";
import { getAccreditationStatus, isRecentlyVerified } from "./time";
import { buildEmployerFtsQuery } from "./employer-search";
import type {
  AccreditedEmployer,
  EmployerAssociation,
  EmployerRefreshAuthorizationResponse,
  EmployerResolutionResponse,
  EmployerSearchResponse,
  NoMatchObservation,
  ParsedInzEmployer,
  PlatformIdentity,
} from "./types";
import {
  normalizeName,
  type EmployerRefreshRequest,
  type IngestRequest,
  type NoMatchRequest,
} from "./validation";

type VerificationSource = "inz_live_lookup" | "inz_official_import";

interface EmployerRow {
  employer_name: string;
  trading_name: string | null;
  nzbn: string;
  expiry_date_of_accreditation: string;
  last_verified_at: number;
  last_verified_source: VerificationSource;
}

interface EmployerCandidate extends AccreditedEmployer {
  verificationSource: VerificationSource;
}

interface EmployerRefreshControlRow {
  last_refresh_attempt_at: number | null;
  last_refresh_outcome: "pending" | "positive" | "no_result" | null;
  refresh_not_before: number | null;
}

interface ExactNameResult {
  candidates: EmployerCandidate[];
  exactNameEmployer: EmployerCandidate | null;
}

interface PlatformEntityRow {
  id: number;
  identity_strength: "strong" | "weak";
  last_no_match_query: string | null;
  last_no_match_at: number | null;
}

interface ConfirmationRow {
  nzbn: string;
  confirmation_count: number;
  self_count: number;
}

interface AssociationResolution {
  association: EmployerAssociation | null;
  selectedNzbn: string | null;
  confirmedNzbns: string[];
  noMatchQuery: string | null;
  noMatchAt: number | null;
}

const MAX_RETURNED_CANDIDATES = 10;
const EXACT_LOOKUP_LIMIT = MAX_RETURNED_CANDIDATES + 1;

function rowToEmployer(row: EmployerRow, nowMilliseconds: number): EmployerCandidate {
  return {
    employerName: row.employer_name,
    tradingName: row.trading_name,
    nzbn: row.nzbn,
    expiryDateOfAccreditation: row.expiry_date_of_accreditation,
    lastVerifiedAt: new Date(row.last_verified_at * 1000).toISOString(),
    accreditationStatus: getAccreditationStatus(
      row.expiry_date_of_accreditation,
      nowMilliseconds,
    ),
    verificationSource: row.last_verified_source,
  };
}

function toPublicEmployer(candidate: EmployerCandidate): AccreditedEmployer {
  const { verificationSource: _, ...employer } = candidate;
  return employer;
}

function isCandidateRecentlyVerified(
  candidate: EmployerCandidate,
  nowMilliseconds: number,
  positiveTtlSeconds: number,
): boolean {
  if (candidate.accreditationStatus === "expired") {
    return false;
  }
  const lastVerifiedAtSeconds = Math.floor(
    Date.parse(candidate.lastVerifiedAt) / 1000,
  );
  return isRecentlyVerified(
    lastVerifiedAtSeconds,
    nowMilliseconds,
    positiveTtlSeconds,
  );
}

function refreshRetryAt(refreshNotBefore: number | null): string | null {
  return refreshNotBefore === null
    ? null
    : new Date(refreshNotBefore * 1000).toISOString();
}

async function findExactNameCandidates(
  db: D1Database,
  displayName: string,
  nowMilliseconds: number,
): Promise<ExactNameResult> {
  const normalized = normalizeName(displayName);
  const rows = await db
    .prepare(
      `SELECT employer_name, trading_name, nzbn,
              expiry_date_of_accreditation, last_verified_at,
              last_verified_source
         FROM employers
        WHERE nzbn = ?1
           OR normalized_employer_name = ?2
           OR normalized_trading_name = ?2
        ORDER BY CASE
                   WHEN nzbn = ?1 THEN 0
                   WHEN normalized_employer_name = ?2 THEN 1
                   WHEN normalized_trading_name = ?2 THEN 2
                 END,
                 length(employer_name),
                 employer_name,
                 nzbn
        LIMIT ${EXACT_LOOKUP_LIMIT}`,
    )
    .bind(/^\d{13}$/u.test(normalized) ? normalized : "", normalized)
    .all<EmployerRow>();

  const exactNameRows = rows.results.filter((row) =>
    normalizeName(row.employer_name) === normalized ||
    (row.trading_name !== null && normalizeName(row.trading_name) === normalized)
  );
  const exactNameNzbns = new Set(exactNameRows.map((row) => row.nzbn));
  const exactNameRow = exactNameNzbns.size === 1 ? exactNameRows[0] ?? null : null;
  const candidates = rows.results
    .slice(0, MAX_RETURNED_CANDIDATES)
    .map((row) => rowToEmployer(row, nowMilliseconds));

  return {
    candidates,
    exactNameEmployer:
      exactNameRow === null ? null : rowToEmployer(exactNameRow, nowMilliseconds),
  };
}

export async function searchEmployerCandidates(
  db: D1Database,
  query: string,
  nowMilliseconds = Date.now(),
): Promise<EmployerSearchResponse> {
  const ftsQuery = buildEmployerFtsQuery(query);
  if (ftsQuery === null) {
    return { query, candidates: [] };
  }

  const normalized = normalizeName(query);
  const [exactNzbn, keywordRows] = await Promise.all([
    /^\d{13}$/u.test(normalized)
      ? findEmployer(db, normalized, nowMilliseconds)
      : Promise.resolve(null),
    db
      .prepare(
        `SELECT employers.employer_name, employers.trading_name, employers.nzbn,
                employers.expiry_date_of_accreditation, employers.last_verified_at,
                employers.last_verified_source
           FROM employer_names_fts
           JOIN employers ON employers.nzbn = employer_names_fts.nzbn
          WHERE employer_names_fts MATCH ?1
          ORDER BY bm25(employer_names_fts), employers.employer_name, employers.nzbn
          LIMIT ${MAX_RETURNED_CANDIDATES}`,
      )
      .bind(ftsQuery)
      .all<EmployerRow>(),
  ]);
  const candidates = mergeCandidates([
    exactNzbn === null ? [] : [exactNzbn],
    keywordRows.results.map((row) => rowToEmployer(row, nowMilliseconds)),
  ]);
  return { query, candidates: candidates.map(toPublicEmployer) };
}

async function findEmployer(
  db: D1Database,
  nzbn: string,
  nowMilliseconds: number,
): Promise<EmployerCandidate | null> {
  const row = await db
    .prepare(
      `SELECT employer_name, trading_name, nzbn,
              expiry_date_of_accreditation, last_verified_at,
              last_verified_source
         FROM employers
        WHERE nzbn = ?1`,
    )
    .bind(nzbn)
    .first<EmployerRow>();
  return row === null ? null : rowToEmployer(row, nowMilliseconds);
}

async function findEmployers(
  db: D1Database,
  nzbns: readonly string[],
  nowMilliseconds: number,
): Promise<EmployerCandidate[]> {
  const uniqueNzbns = [...new Set(nzbns)].slice(0, 50);
  if (uniqueNzbns.length === 0) {
    return [];
  }
  const placeholders = uniqueNzbns.map((_, index) => `?${index + 1}`).join(", ");
  const rows = await db
    .prepare(
      `SELECT employer_name, trading_name, nzbn,
              expiry_date_of_accreditation, last_verified_at,
              last_verified_source
         FROM employers
        WHERE nzbn IN (${placeholders})`,
    )
    .bind(...uniqueNzbns)
    .all<EmployerRow>();
  const byNzbn = new Map(
    rows.results.map((row) => [row.nzbn, rowToEmployer(row, nowMilliseconds)]),
  );
  return uniqueNzbns.flatMap((nzbn) => {
    const employer = byNzbn.get(nzbn);
    return employer === undefined ? [] : [employer];
  });
}

async function readAssociation(
  db: D1Database,
  identity: PlatformIdentity,
  clientIdHash: string,
): Promise<AssociationResolution> {
  const entity = await db
    .prepare(
      `SELECT id, identity_strength, last_no_match_query, last_no_match_at
         FROM platform_entities
        WHERE platform = ?1 AND external_key = ?2`,
    )
    .bind(identity.platform, identity.externalKey)
    .first<PlatformEntityRow>();

  if (entity === null) {
    return {
      association: null,
      selectedNzbn: null,
      confirmedNzbns: [],
      noMatchQuery: null,
      noMatchAt: null,
    };
  }

  const confirmations = await db
    .prepare(
      `SELECT nzbn,
              COUNT(*) AS confirmation_count,
              SUM(CASE WHEN client_id_hash = ?2 THEN 1 ELSE 0 END) AS self_count
         FROM platform_employer_confirmations
        WHERE platform_entity_id = ?1
        GROUP BY nzbn
        ORDER BY confirmation_count DESC, nzbn ASC`,
    )
    .bind(entity.id, clientIdHash)
    .all<ConfirmationRow>();

  if (confirmations.results.length === 0) {
    return {
      association: null,
      selectedNzbn: null,
      confirmedNzbns: [],
      noMatchQuery: entity.last_no_match_query,
      noMatchAt: entity.last_no_match_at,
    };
  }

  const self = confirmations.results.find((row) => row.self_count > 0);
  const top = confirmations.results[0];
  if (top === undefined) {
    throw new Error("Confirmation aggregation returned no top row.");
  }
  const second = confirmations.results[1];
  const uniqueCommunityWinner = second === undefined || top.confirmation_count > second.confirmation_count;
  const selected = self ?? (uniqueCommunityWinner ? top : null);
  const totalConfirmations = confirmations.results.reduce(
    (total, row) => total + row.confirmation_count,
    0,
  );

  return {
    selectedNzbn: selected?.nzbn ?? null,
    confirmedNzbns: confirmations.results.map((row) => row.nzbn),
    association: {
      nzbn: selected?.nzbn ?? null,
      source: self !== undefined ? "self" : selected === null ? null : "community",
      confirmationCount: selected?.confirmation_count ?? top.confirmation_count,
      alternativeConfirmationCount:
        totalConfirmations - (selected?.confirmation_count ?? top.confirmation_count),
      disputed: confirmations.results.length > 1,
      identityStrength: entity.identity_strength,
    },
    noMatchQuery: entity.last_no_match_query,
    noMatchAt: entity.last_no_match_at,
  };
}

function getFreshNoMatch(
  association: AssociationResolution,
  displayName: string,
  nowMilliseconds: number,
  negativeTtlSeconds: number,
): NoMatchObservation | null {
  const query = association.noMatchQuery;
  const checkedAt = association.noMatchAt;
  const nowSeconds = Math.floor(nowMilliseconds / 1000);
  if (
    query === null ||
    checkedAt === null ||
    query !== normalizeName(displayName) ||
    checkedAt > nowSeconds ||
    nowSeconds - checkedAt >= negativeTtlSeconds
  ) {
    return null;
  }
  return {
    query,
    checkedAt: new Date(checkedAt * 1000).toISOString(),
    expiresAt: new Date((checkedAt + negativeTtlSeconds) * 1000).toISOString(),
  };
}

function mergeCandidates(
  groups: readonly (readonly EmployerCandidate[])[],
): EmployerCandidate[] {
  const seen = new Set<string>();
  const merged: EmployerCandidate[] = [];
  for (const group of groups) {
    for (const employer of group) {
      if (!seen.has(employer.nzbn) && merged.length < MAX_RETURNED_CANDIDATES) {
        seen.add(employer.nzbn);
        merged.push(employer);
      }
    }
  }
  return merged;
}

export async function hashClientId(clientId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientId));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function joinExtensionWaitlist(
  db: D1Database,
  email: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ state: "subscribed" }> {
  await db
    .prepare(
      `INSERT INTO extension_waitlist (email, created_at)
       VALUES (?1, ?2)
       ON CONFLICT(email) DO NOTHING`,
    )
    .bind(email, nowSeconds)
    .run();
  return { state: "subscribed" };
}

export async function resolveEmployer(
  db: D1Database,
  identity: PlatformIdentity,
  clientIdHash: string,
  freshnessPolicy: FreshnessPolicy,
  preferredNzbns: readonly string[] = [],
  nowMilliseconds = Date.now(),
  allowExactNameMatch = true,
): Promise<EmployerResolutionResponse> {
  const association = await readAssociation(db, identity, clientIdHash);
  const [preferred, confirmed, localResult, selectedEmployer] = await Promise.all([
    findEmployers(db, preferredNzbns, nowMilliseconds),
    findEmployers(db, association.confirmedNzbns, nowMilliseconds),
    findExactNameCandidates(db, identity.displayName, nowMilliseconds),
    association.selectedNzbn === null
      ? Promise.resolve(null)
      : findEmployer(db, association.selectedNzbn, nowMilliseconds),
  ]);

  const selected = selectedEmployer === null ? [] : [selectedEmployer];
  const exactNameEmployer =
    allowExactNameMatch ? localResult.exactNameEmployer : null;
  const exact = exactNameEmployer === null ? [] : [exactNameEmployer];
  const candidates = mergeCandidates([
    selected,
    exact,
    preferred,
    confirmed,
    localResult.candidates,
  ]);
  const publicCandidates = candidates.map(toPublicEmployer);

  if (selectedEmployer !== null) {
    const fresh = isCandidateRecentlyVerified(
      selectedEmployer,
      nowMilliseconds,
      freshnessPolicy.positiveTtlSeconds,
    );
    return {
      state: fresh ? "associated" : "refresh_required",
      matchMethod: "platform_association",
      selectedEmployer: toPublicEmployer(selectedEmployer),
      candidates: publicCandidates,
      association: association.association,
      noMatch: null,
      inzQuery: fresh ? null : selectedEmployer.nzbn,
    };
  }

  if (exactNameEmployer !== null) {
    const fresh = isCandidateRecentlyVerified(
      exactNameEmployer,
      nowMilliseconds,
      freshnessPolicy.positiveTtlSeconds,
    );
    return {
      state: fresh ? "associated" : "refresh_required",
      matchMethod: "exact_employer_name",
      selectedEmployer: toPublicEmployer(exactNameEmployer),
      candidates: publicCandidates,
      association: null,
      noMatch: null,
      inzQuery: fresh ? null : exactNameEmployer.nzbn,
    };
  }

  if (candidates.length > 0) {
    return {
      state: "confirmation_required",
      matchMethod: null,
      selectedEmployer: null,
      candidates: publicCandidates,
      association: association.association,
      noMatch: null,
      inzQuery: null,
    };
  }

  const noMatch = getFreshNoMatch(
    association,
    identity.displayName,
    nowMilliseconds,
    freshnessPolicy.negativeTtlSeconds,
  );
  if (noMatch !== null) {
    return {
      state: "no_published_inz_match",
      matchMethod: null,
      selectedEmployer: null,
      candidates: [],
      association: association.association,
      noMatch,
      inzQuery: null,
    };
  }

  return {
    state: "inz_lookup_required",
    matchMethod: null,
    selectedEmployer: null,
    candidates: [],
    association: association.association,
    noMatch: null,
    inzQuery: identity.displayName,
  };
}

function employerUpsert(
  db: D1Database,
  employer: ParsedInzEmployer,
  verifiedAt: number,
  freshnessPolicy: FreshnessPolicy,
): D1PreparedStatement {
  const refreshCooldownSeconds =
    getAccreditationStatus(employer.expiryDateOfAccreditation, verifiedAt * 1000) === "expired"
      ? freshnessPolicy.refreshNoMatchCooldownSeconds
      : freshnessPolicy.refreshAttemptCooldownSeconds;
  return db
    .prepare(
      `INSERT INTO employers (
         employer_name, normalized_employer_name,
         trading_name, normalized_trading_name,
         nzbn, expiry_date_of_accreditation,
         first_seen_at, last_verified_at, last_verified_source,
         last_refresh_attempt_at, last_refresh_outcome, refresh_not_before
       ) VALUES (
         ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, 'inz_live_lookup',
         ?7, 'positive', ?8
       )
       ON CONFLICT(nzbn) DO UPDATE SET
         employer_name = excluded.employer_name,
         normalized_employer_name = excluded.normalized_employer_name,
         trading_name = excluded.trading_name,
         normalized_trading_name = excluded.normalized_trading_name,
         expiry_date_of_accreditation = excluded.expiry_date_of_accreditation,
         last_verified_at = excluded.last_verified_at,
         last_verified_source = excluded.last_verified_source,
         last_refresh_attempt_at = excluded.last_refresh_attempt_at,
         last_refresh_outcome = excluded.last_refresh_outcome,
         refresh_not_before = excluded.refresh_not_before`,
    )
    .bind(
      employer.employerName,
      normalizeName(employer.employerName),
      employer.tradingName,
      employer.tradingName === null ? null : normalizeName(employer.tradingName),
      employer.nzbn,
      employer.expiryDateOfAccreditation,
      verifiedAt,
      verifiedAt + refreshCooldownSeconds,
    );
}

export async function ingestEmployers(
  db: D1Database,
  request: IngestRequest,
  clientIdHash: string,
  freshnessPolicy: FreshnessPolicy,
  nowMilliseconds = Date.now(),
): Promise<EmployerResolutionResponse> {
  let parsed;
  try {
    parsed = parseInzResponse(request.inzResponse);
  } catch (error) {
    if (error instanceof InzResponseError) {
      throw new ApiError(
        400,
        "invalid_inz_response",
        "The submitted INZ response is invalid.",
      );
    }
    throw error;
  }

  if (parsed.current !== request.page) {
    throw new ApiError(
      400,
      "page_mismatch",
      "The submitted INZ response page does not match the requested page.",
    );
  }
  if (parsed.results.length === 0) {
    throw new ApiError(
      400,
      "empty_inz_response",
      "INZ no-result responses are not stored.",
    );
  }

  const verifiedAt = Math.floor(nowMilliseconds / 1000);
  await db.batch([
    ...parsed.results.map((employer) =>
      employerUpsert(db, employer, verifiedAt, freshnessPolicy)
    ),
    db
      .prepare(
        `UPDATE platform_entities
            SET last_no_match_query = NULL,
                last_no_match_at = NULL,
                display_name = ?3,
                public_url = ?4,
                identity_kind = ?5,
                identity_strength = ?6,
                last_seen_at = ?7
          WHERE platform = ?1 AND external_key = ?2`,
      )
      .bind(
        request.identity.platform,
        request.identity.externalKey,
        request.identity.displayName,
        request.identity.publicUrl,
        request.identity.kind,
        request.identity.strength,
        verifiedAt,
      ),
  ]);
  return resolveEmployer(
    db,
    request.identity,
    clientIdHash,
    freshnessPolicy,
    parsed.results.map((employer) => employer.nzbn),
    nowMilliseconds,
    parsed.totalResults === 1,
  );
}

export async function storeNoMatchObservation(
  db: D1Database,
  request: NoMatchRequest,
  clientIdHash: string,
  freshnessPolicy: FreshnessPolicy,
  nowMilliseconds = Date.now(),
): Promise<EmployerResolutionResponse> {
  if (request.targetNzbn !== null) {
    const nowSeconds = Math.floor(nowMilliseconds / 1000);
    const control = await db
      .prepare(
        `SELECT last_refresh_attempt_at, last_refresh_outcome, refresh_not_before
           FROM employers
          WHERE nzbn = ?1`,
      )
      .bind(request.targetNzbn)
      .first<EmployerRefreshControlRow>();
    if (control === null) {
      throw new ApiError(404, "employer_not_found", "The employer does not exist.");
    }
    if (
      control.last_refresh_outcome === "no_result" &&
      control.refresh_not_before !== null &&
      control.refresh_not_before > nowSeconds
    ) {
      return resolveEmployer(
        db,
        request.identity,
        clientIdHash,
        freshnessPolicy,
        [request.targetNzbn],
        nowMilliseconds,
      );
    }
    if (
      control.last_refresh_outcome !== "pending" ||
      control.last_refresh_attempt_at === null ||
      control.last_refresh_attempt_at > nowSeconds ||
      nowSeconds - control.last_refresh_attempt_at >
        freshnessPolicy.refreshAttemptCooldownSeconds
    ) {
      throw new ApiError(
        409,
        "refresh_not_authorized",
        "The employer refresh must be authorized before recording no results.",
      );
    }
    await db
      .prepare(
        `UPDATE employers
            SET last_refresh_attempt_at = ?2,
                last_refresh_outcome = 'no_result',
                refresh_not_before = ?3
          WHERE nzbn = ?1
            AND last_refresh_outcome = 'pending'
            AND last_refresh_attempt_at = ?4`,
      )
      .bind(
        request.targetNzbn,
        nowSeconds,
        nowSeconds + freshnessPolicy.refreshNoMatchCooldownSeconds,
        control.last_refresh_attempt_at,
      )
      .run();
    return resolveEmployer(
      db,
      request.identity,
      clientIdHash,
      freshnessPolicy,
      [request.targetNzbn],
      nowMilliseconds,
    );
  }

  const current = await resolveEmployer(
    db,
    request.identity,
    clientIdHash,
    freshnessPolicy,
    [],
    nowMilliseconds,
  );
  if (current.state !== "inz_lookup_required") {
    return current;
  }

  const nowSeconds = Math.floor(nowMilliseconds / 1000);
  await db
    .prepare(
      `INSERT INTO platform_entities (
         platform, external_key, identity_kind, identity_strength,
         display_name, public_url, first_seen_at, last_seen_at,
         last_no_match_query, last_no_match_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?7)
       ON CONFLICT(platform, external_key) DO UPDATE SET
         identity_kind = excluded.identity_kind,
         identity_strength = excluded.identity_strength,
         display_name = excluded.display_name,
         public_url = excluded.public_url,
         last_seen_at = excluded.last_seen_at,
         last_no_match_query = CASE
           WHEN platform_entities.last_no_match_query = excluded.last_no_match_query
            AND platform_entities.last_no_match_at IS NOT NULL
            AND platform_entities.last_no_match_at > excluded.last_no_match_at - ?9
           THEN platform_entities.last_no_match_query
           ELSE excluded.last_no_match_query
         END,
         last_no_match_at = CASE
           WHEN platform_entities.last_no_match_query = excluded.last_no_match_query
            AND platform_entities.last_no_match_at IS NOT NULL
            AND platform_entities.last_no_match_at > excluded.last_no_match_at - ?9
           THEN platform_entities.last_no_match_at
           ELSE excluded.last_no_match_at
         END`,
    )
    .bind(
      request.identity.platform,
      request.identity.externalKey,
      request.identity.kind,
      request.identity.strength,
      request.identity.displayName,
      request.identity.publicUrl,
      nowSeconds,
      request.normalizedQuery,
      freshnessPolicy.negativeTtlSeconds,
    )
    .run();

  return resolveEmployer(
    db,
    request.identity,
    clientIdHash,
    freshnessPolicy,
    [],
    nowMilliseconds,
  );
}

export async function authorizeEmployerRefresh(
  db: D1Database,
  request: EmployerRefreshRequest,
  clientIdHash: string,
  freshnessPolicy: FreshnessPolicy,
  nowMilliseconds = Date.now(),
): Promise<EmployerRefreshAuthorizationResponse> {
  const employer = await findEmployer(db, request.nzbn, nowMilliseconds);
  if (employer === null) {
    throw new ApiError(404, "employer_not_found", "The employer does not exist.");
  }

  const resolution = await resolveEmployer(
    db,
    request.identity,
    clientIdHash,
    freshnessPolicy,
    [request.nzbn],
    nowMilliseconds,
  );
  if (
    !request.manual &&
    (resolution.state !== "refresh_required" ||
      resolution.selectedEmployer?.nzbn !== request.nzbn)
  ) {
    return {
      state: "not_required",
      resolution,
      inzQuery: null,
      retryAt: null,
    };
  }

  const nowSeconds = Math.floor(nowMilliseconds / 1000);
  const control = await db
    .prepare(
      `SELECT last_refresh_attempt_at, last_refresh_outcome, refresh_not_before
         FROM employers
        WHERE nzbn = ?1`,
    )
    .bind(request.nzbn)
    .first<EmployerRefreshControlRow>();
  if (control === null) {
    throw new ApiError(404, "employer_not_found", "The employer does not exist.");
  }
  if (control.refresh_not_before !== null && control.refresh_not_before > nowSeconds) {
    return {
      state: "cooldown",
      resolution,
      inzQuery: null,
      retryAt: refreshRetryAt(control.refresh_not_before),
    };
  }

  const leaseUntil = nowSeconds + freshnessPolicy.refreshAttemptCooldownSeconds;
  const claimed = await db
    .prepare(
      `UPDATE employers
          SET last_refresh_attempt_at = ?2,
              last_refresh_outcome = 'pending',
              refresh_not_before = ?3
        WHERE nzbn = ?1
          AND (refresh_not_before IS NULL OR refresh_not_before <= ?2)`,
    )
    .bind(request.nzbn, nowSeconds, leaseUntil)
    .run();
  if (claimed.meta.changes === 1) {
    return {
      state: "authorized",
      resolution,
      inzQuery: request.nzbn,
      retryAt: null,
    };
  }

  const latest = await db
    .prepare(
      `SELECT last_refresh_attempt_at, last_refresh_outcome, refresh_not_before
         FROM employers
        WHERE nzbn = ?1`,
    )
    .bind(request.nzbn)
    .first<EmployerRefreshControlRow>();
  return {
    state: "cooldown",
    resolution,
    inzQuery: null,
    retryAt: refreshRetryAt(latest?.refresh_not_before ?? leaseUntil),
  };
}

export async function associateEmployer(
  db: D1Database,
  identity: PlatformIdentity,
  nzbn: string,
  clientIdHash: string,
  freshnessPolicy: FreshnessPolicy,
  nowMilliseconds = Date.now(),
): Promise<EmployerResolutionResponse> {
  if (await findEmployer(db, nzbn, nowMilliseconds) === null) {
    throw new ApiError(
      404,
      "employer_not_found",
      "The employer must exist before it can be associated.",
    );
  }

  const nowSeconds = Math.floor(nowMilliseconds / 1000);
  await db.batch([
    db
      .prepare(
        `INSERT INTO platform_entities (
           platform, external_key, identity_kind, identity_strength,
           display_name, public_url, first_seen_at, last_seen_at,
           last_no_match_query, last_no_match_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, NULL, NULL)
         ON CONFLICT(platform, external_key) DO UPDATE SET
           identity_kind = excluded.identity_kind,
           identity_strength = excluded.identity_strength,
           display_name = excluded.display_name,
           public_url = excluded.public_url,
           last_seen_at = excluded.last_seen_at,
           last_no_match_query = NULL,
           last_no_match_at = NULL`,
      )
      .bind(
        identity.platform,
        identity.externalKey,
        identity.kind,
        identity.strength,
        identity.displayName,
        identity.publicUrl,
        nowSeconds,
      ),
    db
      .prepare(
        `INSERT INTO platform_employer_confirmations (
           platform_entity_id, client_id_hash, nzbn, created_at, updated_at
         )
         SELECT id, ?3, ?4, ?5, ?5
           FROM platform_entities
          WHERE platform = ?1 AND external_key = ?2
         ON CONFLICT(platform_entity_id, client_id_hash) DO UPDATE SET
           nzbn = excluded.nzbn,
           updated_at = excluded.updated_at`,
      )
      .bind(identity.platform, identity.externalKey, clientIdHash, nzbn, nowSeconds),
  ]);

  return resolveEmployer(
    db,
    identity,
    clientIdHash,
    freshnessPolicy,
    [nzbn],
    nowMilliseconds,
  );
}
