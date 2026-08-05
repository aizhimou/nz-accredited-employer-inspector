import { ApiError, InzResponseError } from "./errors";
import { parseInzResponse } from "./inz-response";
import { getAccreditationStatus, isRecentlyVerified } from "./time";
import type {
  AccreditedEmployer,
  EmployerAssociation,
  EmployerResolutionResponse,
  NoMatchObservation,
  ParsedInzEmployer,
  PlatformIdentity,
} from "./types";
import {
  normalizeName,
  type IngestRequest,
  type NoMatchRequest,
} from "./validation";

const NO_MATCH_TTL_SECONDS = 24 * 60 * 60;

interface EmployerRow {
  employer_name: string;
  trading_name: string | null;
  nzbn: string;
  expiry_date_of_accreditation: string;
  last_verified_at: number;
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

function rowToEmployer(row: EmployerRow, nowMilliseconds: number): AccreditedEmployer {
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
  };
}

async function findLocalCandidates(
  db: D1Database,
  displayName: string,
  nowMilliseconds: number,
): Promise<AccreditedEmployer[]> {
  const normalized = normalizeName(displayName);
  const rows = await db
    .prepare(
      `SELECT employer_name, trading_name, nzbn,
              expiry_date_of_accreditation, last_verified_at
         FROM employers
        WHERE nzbn = ?1
           OR normalized_employer_name = ?2
           OR normalized_trading_name = ?2
           OR instr(normalized_employer_name, ?2) > 0
           OR (normalized_trading_name IS NOT NULL AND instr(normalized_trading_name, ?2) > 0)
           OR instr(?2, normalized_employer_name) > 0
           OR (normalized_trading_name IS NOT NULL AND instr(?2, normalized_trading_name) > 0)
        ORDER BY CASE
                   WHEN nzbn = ?1 THEN 0
                   WHEN normalized_employer_name = ?2 THEN 1
                   WHEN normalized_trading_name = ?2 THEN 2
                   ELSE 3
                 END,
                 length(employer_name),
                 employer_name,
                 nzbn
        LIMIT 20`,
    )
    .bind(/^\d{13}$/u.test(normalized) ? normalized : "", normalized)
    .all<EmployerRow>();

  return rows.results.map((row) => rowToEmployer(row, nowMilliseconds));
}

async function findEmployer(
  db: D1Database,
  nzbn: string,
  nowMilliseconds: number,
): Promise<AccreditedEmployer | null> {
  const row = await db
    .prepare(
      `SELECT employer_name, trading_name, nzbn,
              expiry_date_of_accreditation, last_verified_at
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
): Promise<AccreditedEmployer[]> {
  const uniqueNzbns = [...new Set(nzbns)].slice(0, 50);
  if (uniqueNzbns.length === 0) {
    return [];
  }
  const placeholders = uniqueNzbns.map((_, index) => `?${index + 1}`).join(", ");
  const rows = await db
    .prepare(
      `SELECT employer_name, trading_name, nzbn,
              expiry_date_of_accreditation, last_verified_at
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
): NoMatchObservation | null {
  const query = association.noMatchQuery;
  const checkedAt = association.noMatchAt;
  const nowSeconds = Math.floor(nowMilliseconds / 1000);
  if (
    query === null ||
    checkedAt === null ||
    query !== normalizeName(displayName) ||
    checkedAt > nowSeconds ||
    nowSeconds - checkedAt >= NO_MATCH_TTL_SECONDS
  ) {
    return null;
  }
  return {
    query,
    checkedAt: new Date(checkedAt * 1000).toISOString(),
    expiresAt: new Date((checkedAt + NO_MATCH_TTL_SECONDS) * 1000).toISOString(),
  };
}

function mergeCandidates(
  groups: readonly (readonly AccreditedEmployer[])[],
): AccreditedEmployer[] {
  const seen = new Set<string>();
  const merged: AccreditedEmployer[] = [];
  for (const group of groups) {
    for (const employer of group) {
      if (!seen.has(employer.nzbn) && merged.length < 50) {
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

export async function resolveEmployer(
  db: D1Database,
  identity: PlatformIdentity,
  clientIdHash: string,
  preferredNzbns: readonly string[] = [],
  nowMilliseconds = Date.now(),
  allowExactNameMatch = true,
): Promise<EmployerResolutionResponse> {
  const association = await readAssociation(db, identity, clientIdHash);
  const [preferred, confirmed, local, selectedEmployer] = await Promise.all([
    findEmployers(db, preferredNzbns, nowMilliseconds),
    findEmployers(db, association.confirmedNzbns, nowMilliseconds),
    findLocalCandidates(db, identity.displayName, nowMilliseconds),
    association.selectedNzbn === null
      ? Promise.resolve(null)
      : findEmployer(db, association.selectedNzbn, nowMilliseconds),
  ]);

  const selected = selectedEmployer === null ? [] : [selectedEmployer];
  const candidates = mergeCandidates([selected, preferred, confirmed, local]);

  if (selectedEmployer !== null) {
    const lastVerifiedAtSeconds = Math.floor(
      Date.parse(selectedEmployer.lastVerifiedAt) / 1000,
    );
    const fresh = isRecentlyVerified(lastVerifiedAtSeconds, nowMilliseconds);
    return {
      state: fresh ? "associated" : "refresh_required",
      matchMethod: "platform_association",
      selectedEmployer,
      candidates,
      association: association.association,
      noMatch: null,
      inzQuery: fresh ? null : selectedEmployer.nzbn,
    };
  }

  const exactNameEmployer =
    allowExactNameMatch &&
    candidates.length === 1 &&
    normalizeName(candidates[0]?.employerName ?? "") ===
      normalizeName(identity.displayName)
      ? candidates[0]
      : undefined;
  if (exactNameEmployer !== undefined) {
    const lastVerifiedAtSeconds = Math.floor(
      Date.parse(exactNameEmployer.lastVerifiedAt) / 1000,
    );
    const fresh = isRecentlyVerified(lastVerifiedAtSeconds, nowMilliseconds);
    return {
      state: fresh ? "associated" : "refresh_required",
      matchMethod: "exact_employer_name",
      selectedEmployer: exactNameEmployer,
      candidates,
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
      candidates,
      association: association.association,
      noMatch: null,
      inzQuery: null,
    };
  }

  const noMatch = getFreshNoMatch(association, identity.displayName, nowMilliseconds);
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
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO employers (
         employer_name, normalized_employer_name,
         trading_name, normalized_trading_name,
         nzbn, expiry_date_of_accreditation,
         first_seen_at, last_verified_at, last_verified_source
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, 'inz_live_lookup')
       ON CONFLICT(nzbn) DO UPDATE SET
         employer_name = excluded.employer_name,
         normalized_employer_name = excluded.normalized_employer_name,
         trading_name = excluded.trading_name,
         normalized_trading_name = excluded.normalized_trading_name,
         expiry_date_of_accreditation = excluded.expiry_date_of_accreditation,
         last_verified_at = excluded.last_verified_at,
         last_verified_source = excluded.last_verified_source`,
    )
    .bind(
      employer.employerName,
      normalizeName(employer.employerName),
      employer.tradingName,
      employer.tradingName === null ? null : normalizeName(employer.tradingName),
      employer.nzbn,
      employer.expiryDateOfAccreditation,
      verifiedAt,
    );
}

export async function ingestEmployers(
  db: D1Database,
  request: IngestRequest,
  clientIdHash: string,
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
    ...parsed.results.map((employer) => employerUpsert(db, employer, verifiedAt)),
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
    parsed.results.map((employer) => employer.nzbn),
    nowMilliseconds,
    parsed.totalResults === 1,
  );
}

export async function storeNoMatchObservation(
  db: D1Database,
  request: NoMatchRequest,
  clientIdHash: string,
  nowMilliseconds = Date.now(),
): Promise<EmployerResolutionResponse> {
  const current = await resolveEmployer(
    db,
    request.identity,
    clientIdHash,
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
      NO_MATCH_TTL_SECONDS,
    )
    .run();

  return resolveEmployer(
    db,
    request.identity,
    clientIdHash,
    [],
    nowMilliseconds,
  );
}

export async function associateEmployer(
  db: D1Database,
  identity: PlatformIdentity,
  nzbn: string,
  clientIdHash: string,
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

  return resolveEmployer(db, identity, clientIdHash, [nzbn], nowMilliseconds);
}
