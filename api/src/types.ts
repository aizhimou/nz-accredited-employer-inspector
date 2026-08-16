export interface AccreditedEmployer {
  /** Employer Name (INZ Type: Title). */
  employerName: string;

  /** Trading Name (INZ Type: PlainText). */
  tradingName: string | null;

  /** New Zealand Business Number (INZ Type: PlainText). */
  nzbn: string;

  /** Expiry Date of Accreditation (INZ Type: Date). */
  expiryDateOfAccreditation: string;

  /** Worker-owned verification time, formatted as ISO UTC. */
  lastVerifiedAt: string;

  /** Evaluated using the Pacific/Auckland calendar date. */
  accreditationStatus: "accredited" | "expired";
}

export type ParsedInzEmployer = Omit<
  AccreditedEmployer,
  "lastVerifiedAt" | "accreditationStatus"
>;

export interface ParsedInzResponse {
  results: ParsedInzEmployer[];
  current: number;
  totalPages: number;
  totalResults: number;
}

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

export type ResolutionState =
  | "associated"
  | "refresh_required"
  | "confirmation_required"
  | "no_published_inz_match"
  | "inz_lookup_required";

export type MatchMethod =
  | "platform_association"
  | "exact_employer_name";

export interface EmployerResolutionResponse {
  state: ResolutionState;
  /** How selectedEmployer was resolved; null when no employer is selected. */
  matchMethod: MatchMethod | null;
  selectedEmployer: AccreditedEmployer | null;
  candidates: AccreditedEmployer[];
  association: EmployerAssociation | null;
  noMatch: NoMatchObservation | null;
  inzQuery: string | null;
}

export interface EmployerSearchResponse {
  query: string;
  candidates: AccreditedEmployer[];
}

export interface EmployerRefreshAuthorizationResponse {
  state: "authorized" | "cooldown" | "not_required";
  resolution: EmployerResolutionResponse;
  inzQuery: string | null;
  retryAt: string | null;
}
