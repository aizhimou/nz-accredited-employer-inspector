export type Platform = "linkedin" | "seek";
export type PlatformIdentityKind =
  | "linkedin_company_url"
  | "seek_company_profile"
  | "seek_advertiser_name";
export type IdentityStrength = "strong" | "weak";

export interface PlatformIdentity {
  platform: Platform;
  externalKey: string;
  kind: PlatformIdentityKind;
  strength: IdentityStrength;
  displayName: string;
  publicUrl: string | null;
}

export interface AccreditedEmployer {
  employerName: string;
  tradingName: string | null;
  nzbn: string;
  expiryDateOfAccreditation: string;
  lastVerifiedAt: string;
  accreditationStatus: "accredited" | "expired";
}

export interface EmployerAssociation {
  nzbn: string | null;
  source: "self" | "community" | null;
  confirmationCount: number;
  alternativeConfirmationCount: number;
  disputed: boolean;
  identityStrength: IdentityStrength;
}

export interface NoMatchObservation {
  query: string;
  checkedAt: string;
  expiresAt: string;
}

export interface EmployerResolutionResponse {
  state:
    | "associated"
    | "refresh_required"
    | "confirmation_required"
    | "no_published_inz_match"
    | "inz_lookup_required";
  matchMethod: "platform_association" | "exact_employer_name" | null;
  selectedEmployer: AccreditedEmployer | null;
  candidates: AccreditedEmployer[];
  association: EmployerAssociation | null;
  noMatch: NoMatchObservation | null;
  inzQuery: string | null;
}

export interface CheckEmployerMessage {
  type: "check-employer";
  identity: PlatformIdentity;
}

export interface AssociateEmployerMessage {
  type: "associate-employer";
  identity: PlatformIdentity;
  nzbn: string;
}

export interface SearchEmployersMessage {
  type: "search-employers";
  identity: PlatformIdentity;
  query: string;
}

export type ExtensionMessage =
  | CheckEmployerMessage
  | AssociateEmployerMessage
  | SearchEmployersMessage;

export type LiveLookupStatus =
  | "not_needed"
  | "updated"
  | "no_published_inz_match"
  | "verification_required";

export interface LookupSuccess {
  ok: true;
  identity: PlatformIdentity;
  data: EmployerResolutionResponse;
  liveLookupStatus: LiveLookupStatus;
  requestId: string | null;
}

export interface LookupFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    requestId: string | null;
  };
}

export type LookupResponse = LookupSuccess | LookupFailure;

export interface EmployerSearchSuccess {
  ok: true;
  identity: PlatformIdentity;
  query: string;
  candidates: AccreditedEmployer[];
  requestId: string | null;
}

export type EmployerSearchResponse = EmployerSearchSuccess | LookupFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPlatformIdentity(value: unknown): value is PlatformIdentity {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.platform === "linkedin" || value.platform === "seek") &&
    typeof value.externalKey === "string" &&
    (value.kind === "linkedin_company_url" ||
      value.kind === "seek_company_profile" ||
      value.kind === "seek_advertiser_name") &&
    (value.strength === "strong" || value.strength === "weak") &&
    typeof value.displayName === "string" &&
    (value.publicUrl === null || typeof value.publicUrl === "string")
  );
}

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (!isRecord(value) || !isPlatformIdentity(value.identity)) {
    return false;
  }
  if (value.type === "check-employer") {
    return true;
  }
  if (value.type === "search-employers") {
    return (
      typeof value.query === "string" &&
      value.query.trim().length >= 3 &&
      value.query.trim().length <= 100
    );
  }
  return (
    value.type === "associate-employer" &&
    typeof value.nzbn === "string" &&
    /^\d{13}$/u.test(value.nzbn)
  );
}

export function isEmployerSearchResponse(value: unknown): value is EmployerSearchResponse {
  if (!isRecord(value)) {
    return false;
  }
  if (value.ok === true) {
    return (
      isPlatformIdentity(value.identity) &&
      typeof value.query === "string" &&
      Array.isArray(value.candidates) &&
      value.candidates.every(isAccreditedEmployer) &&
      (value.requestId === null || typeof value.requestId === "string")
    );
  }
  return (
    value.ok === false &&
    isRecord(value.error) &&
    typeof value.error.code === "string" &&
    typeof value.error.message === "string" &&
    (value.error.requestId === null || typeof value.error.requestId === "string")
  );
}

function isAccreditedEmployer(value: unknown): value is AccreditedEmployer {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.employerName === "string" &&
    (value.tradingName === null || typeof value.tradingName === "string") &&
    typeof value.nzbn === "string" &&
    /^\d{13}$/u.test(value.nzbn) &&
    typeof value.expiryDateOfAccreditation === "string" &&
    typeof value.lastVerifiedAt === "string" &&
    (value.accreditationStatus === "accredited" || value.accreditationStatus === "expired")
  );
}

function isEmployerAssociation(value: unknown): value is EmployerAssociation {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.nzbn === null || (typeof value.nzbn === "string" && /^\d{13}$/u.test(value.nzbn))) &&
    (value.source === null || value.source === "self" || value.source === "community") &&
    typeof value.confirmationCount === "number" &&
    Number.isSafeInteger(value.confirmationCount) &&
    typeof value.alternativeConfirmationCount === "number" &&
    Number.isSafeInteger(value.alternativeConfirmationCount) &&
    typeof value.disputed === "boolean" &&
    (value.identityStrength === "strong" || value.identityStrength === "weak")
  );
}

function isNoMatchObservation(value: unknown): value is NoMatchObservation {
  return (
    isRecord(value) &&
    typeof value.query === "string" &&
    typeof value.checkedAt === "string" &&
    typeof value.expiresAt === "string"
  );
}

export function isEmployerResolutionResponse(
  value: unknown,
): value is EmployerResolutionResponse {
  if (!isRecord(value)) {
    return false;
  }
  const structurallyValid =
    (value.state === "associated" ||
      value.state === "refresh_required" ||
      value.state === "confirmation_required" ||
      value.state === "no_published_inz_match" ||
      value.state === "inz_lookup_required") &&
    (value.matchMethod === null ||
      value.matchMethod === "platform_association" ||
      value.matchMethod === "exact_employer_name") &&
    (value.selectedEmployer === null || isAccreditedEmployer(value.selectedEmployer)) &&
    Array.isArray(value.candidates) &&
    value.candidates.every(isAccreditedEmployer) &&
    (value.association === null || isEmployerAssociation(value.association)) &&
    (value.noMatch === null || isNoMatchObservation(value.noMatch)) &&
    (value.inzQuery === null || typeof value.inzQuery === "string");
  if (!structurallyValid) {
    return false;
  }

  if (value.selectedEmployer === null) {
    return value.matchMethod === null;
  }
  if (value.matchMethod === "platform_association") {
    return value.association !== null;
  }
  return value.matchMethod === "exact_employer_name" && value.association === null;
}

export function isLookupResponse(value: unknown): value is LookupResponse {
  if (!isRecord(value)) {
    return false;
  }
  if (value.ok === true) {
    return (
      isPlatformIdentity(value.identity) &&
      isEmployerResolutionResponse(value.data) &&
      (value.liveLookupStatus === "not_needed" ||
        value.liveLookupStatus === "updated" ||
        value.liveLookupStatus === "no_published_inz_match" ||
        value.liveLookupStatus === "verification_required") &&
      (value.requestId === null || typeof value.requestId === "string")
    );
  }
  if (value.ok !== false || !isRecord(value.error)) {
    return false;
  }
  return (
    typeof value.error.code === "string" &&
    typeof value.error.message === "string" &&
    (value.error.requestId === null || typeof value.error.requestId === "string")
  );
}
