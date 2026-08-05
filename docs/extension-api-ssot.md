# Extension ↔ Accredited Employer API SSOT

Status: active  
API version: `v1`  
Service version: `0.6.0`
Last updated: 2026-08-05  
Production base URL: `https://nz-accredited-employer-api.asimov.workers.dev`

This document is the single source of truth (SSOT) for the browser extension and Worker contract. Extension code must not infer behaviour by reading the `api/` implementation.

## 1. Product model

The product is a shared accredited-employer data source, not an INZ search-response cache.

- `employers` is the canonical asset. One row represents one NZBN and the latest accepted INZ accreditation observation.
- Immigration New Zealand (INZ) is the SSOT for employer name, trading name, NZBN, accreditation expiry, and verification time.
- LinkedIn/SEEK associations are community confirmations. They are useful identity mappings, but are not official INZ facts.
- A unique exact official-name match is a derived resolution, not a stored association: the normalised platform `displayName` must exactly equal the sole candidate's official INZ `employerName`.
- The Worker does not call INZ. A live INZ lookup only happens in the extension background after an explicit user action.
- The MVP has no general D1 search-cache table. It stores only exact, platform-bound INZ no-match observations for 24 hours.

These independent truth and provenance dimensions must stay visible in code and UI:

| Dimension | Source | Meaning |
| --- | --- | --- |
| Accreditation | INZ | Whether an NZBN is published and its accreditation expiry date. |
| Platform association | Extension users | Which NZBN corresponds to a LinkedIn company or SEEK advertiser/profile. |
| Automatic exact-name match | Worker-derived | The sole current candidate's official `employerName` exactly equals the platform display name after normalisation. It is not community-confirmed and is not persisted. |
| Platform no-match observation | INZ lookup submitted by extension | This exact platform identity and normalised display-name query returned no published INZ result within the last 24 hours. |

## 2. Components and responsibilities

- Content script: identifies the current platform entity, injects the widget, renders candidates, and captures an explicit association choice.
- Extension background service worker: owns `X-Client-ID`, calls the Worker, calls INZ after a user click when required, and submits successful INZ results.
- Cloudflare Worker: validates requests, searches/upserts `employers`, aggregates community confirmations, derives exact official-name matches, evaluates freshness/accreditation, stores short-lived exact no-match observations, and rate-limits clients.
- D1: stores canonical employers, platform associations/confirmations, and platform-bound no-match observation fields.
- INZ: official lookup called directly by the extension, never by the Worker.

```mermaid
sequenceDiagram
    actor User
    participant UI as Content script UI
    participant Ext as Extension background
    participant API as Cloudflare Worker
    participant D1 as D1
    participant INZ as INZ endpoint

    User->>UI: Click Check accreditation
    UI->>Ext: platform identity
    Ext->>API: POST /resolve
    API->>D1: association + fuzzy employer lookup
    D1-->>API: selected employer, candidates, fresh no-match, or lookup required

    alt Association or unique exact official-name match is fresh
        API-->>Ext: ASSOCIATED + selected employer + matchMethod
    else Selected employer needs refresh
        API-->>Ext: REFRESH_REQUIRED + NZBN query
        Ext->>INZ: POST query=NZBN
        INZ-->>Ext: positive payload or recognised 400 No Results
        alt Positive payload
            Ext->>API: POST /ingest with all results
            API->>D1: atomic employer upserts
            API-->>Ext: updated resolution
        else Recognised No Results
            Ext-->>UI: VERIFICATION_REQUIRED (no D1 write)
        end
    else Fresh exact no-match observation
        API-->>Ext: NO_PUBLISHED_INZ_MATCH (no INZ call)
    else No selected employer
        API-->>Ext: CONFIRMATION_REQUIRED or INZ_LOOKUP_REQUIRED
        opt Live lookup required
            Ext->>INZ: POST query=platform display name
            INZ-->>Ext: positive payload or recognised 400 No Results
            alt Positive payload
                Ext->>API: POST /ingest with all results
                API->>D1: atomic employer upserts
                API-->>Ext: ASSOCIATED exact match or CONFIRMATION_REQUIRED
            else Recognised No Results
                Ext->>API: POST /no-match with raw envelope
                API->>D1: upsert platform identity + 24h observation
                API-->>Ext: NO_PUBLISHED_INZ_MATCH
            end
        end
        User->>UI: Confirm one NZBN
        UI->>Ext: association choice
        Ext->>API: POST /associate
        API->>D1: platform entity + client confirmation
        API-->>Ext: ASSOCIATED + selected employer
    end
```

There is no automatic lookup on page load, automatic pagination, list traversal, pre-warming, or bulk search. A single click may perform at most one INZ request.

## 3. Platform identity

Every resolve/ingest/no-match/associate request contains the same `PlatformIdentity` for the current page:

```ts
type Platform = "linkedin" | "seek";
type PlatformIdentityKind =
  | "linkedin_company_url"
  | "seek_company_profile"
  | "seek_advertiser_name";
type IdentityStrength = "strong" | "weak";

interface PlatformIdentity {
  platform: Platform;
  externalKey: string;
  kind: PlatformIdentityKind;
  strength: IdentityStrength;
  displayName: string;
  publicUrl: string | null;
}
```

Canonical construction rules:

| Page | `externalKey` | `kind` | `strength` | `publicUrl` |
| --- | --- | --- | --- | --- |
| LinkedIn company | `company:<lowercase pathname slug>` | `linkedin_company_url` | `strong` | Canonical `https://www.linkedin.com/company/<slug>/` URL. |
| SEEK with company profile | `company:<lowercase profile pathname>` | `seek_company_profile` | `strong` | Canonical `https://nz.seek.com<pathname>` URL. |
| SEEK without company profile | `advertiser:<normalised advertiser name>` | `seek_advertiser_name` | `weak` | `null`. |

Normalised advertiser names use Unicode NFKC, trim, collapsed whitespace, and lowercase. Do not remove company suffixes.

`seek_advertiser_name` is explicitly weak and is not guaranteed globally unique. The UI must label a community association based on this identity as user-confirmed and allow it to be changed.

## 4. Client identity

Every `/v1/*` request requires:

```http
X-Client-ID: 11111111-1111-4111-8111-111111111111
```

The extension creates this once using `crypto.randomUUID()`, persists it in extension local storage, and reuses it. It must not derive the ID from LinkedIn/SEEK account data.

The Worker hashes the UUID before persisting a confirmation. `X-Client-ID` is a rate-limit key and a way to recognise the same installation's selection; it is not authentication or proof of provenance.

## 5. Employer and resolution fields

```ts
type AccreditationStatus = "accredited" | "expired";
type ResolutionState =
  | "associated"
  | "refresh_required"
  | "confirmation_required"
  | "no_published_inz_match"
  | "inz_lookup_required";
type MatchMethod = "platform_association" | "exact_employer_name";

interface AccreditedEmployer {
  /** Employer Name — official INZ field, Type: Title. */
  employerName: string;
  /** Trading Name — official INZ field, Type: PlainText. */
  tradingName: string | null;
  /** New Zealand Business Number — official INZ field, exactly 13 digits. */
  nzbn: string;
  /** Original INZ ISO local datetime string. */
  expiryDateOfAccreditation: string;
  /** Worker-owned ISO UTC time when this NZBN was last accepted from INZ. */
  lastVerifiedAt: string;
  /** Evaluated using the Pacific/Auckland calendar date. */
  accreditationStatus: AccreditationStatus;
}

interface EmployerAssociation {
  /** Null when community confirmation counts are tied. */
  nzbn: string | null;
  source: "self" | "community" | null;
  confirmationCount: number;
  alternativeConfirmationCount: number;
  disputed: boolean;
  identityStrength: "strong" | "weak";
}

interface NoMatchObservation {
  /** The exact normalised display-name query observed by INZ. */
  query: string;
  checkedAt: string;
  expiresAt: string;
}

interface EmployerResolutionResponse {
  state: ResolutionState;
  /** Null when selectedEmployer is null. */
  matchMethod: MatchMethod | null;
  selectedEmployer: AccreditedEmployer | null;
  candidates: AccreditedEmployer[];
  association: EmployerAssociation | null;
  noMatch: NoMatchObservation | null;
  /** Query sent to INZ for inz_lookup_required or refresh_required. */
  inzQuery: string | null;
}
```

Rules:

- `associated`: a selected employer exists and `lastVerifiedAt` is less than 7 days old. Do not call INZ. Selection may come from a stored platform association or an automatic exact-name match; inspect `matchMethod`.
- `refresh_required`: a selected employer exists but was last verified 7 or more days ago. `inzQuery` is the selected employer's NZBN. Selection provenance remains in `matchMethod`.
- `confirmation_required`: D1 has one or more plausible candidates but no usable association. The UI lists all candidates and asks the user to confirm; it must not silently pick a fuzzy match.
- `no_published_inz_match`: there is no association or positive candidate, and this exact platform identity plus normalised display-name query has a no-match observation less than 24 hours old. Do not call INZ.
- `inz_lookup_required`: neither an association nor a local candidate exists. `inzQuery` is the platform display name.
- `candidates` are ordered with the selected employer first, followed by live-INZ results, community-confirmed alternatives, then exact/fuzzy local matches. At most 50 are returned; live INZ order is preserved.
- `matchMethod: "platform_association"` means `association` is non-null and the selected NZBN came from this installation or the unique community winner.
- `matchMethod: "exact_employer_name"` means `association` is null and all automatic-match conditions passed: no selected platform association exists, exactly one candidate is visible, and normalised `identity.displayName` exactly equals normalised official `candidate.employerName`. Unicode NFKC, trim, collapsed whitespace, and lowercase are the only name normalisation; company suffixes and punctuation are not removed.
- `tradingName` equality, substring containment, fuzzy candidates, and a set containing more than one candidate never auto-select an employer.
- Automatic exact-name selection is recalculated on every resolution. It does not create `platform_entities` or `platform_employer_confirmations`, and can disappear if the canonical candidate set changes.
- The extension keeps every alternative candidate returned by the API visible. Each non-selected candidate has a `Use this employer` action, which changes this installation's association. When no alternative candidate is available, the current UI does not provide a separate `Change association` or forced live-search action.
- `disputed` is true when confirmations for the same platform identity point to more than one NZBN.
- The current installation's confirmation wins for that installation. Without one, a unique highest community confirmation count is selected. A tied highest count yields no selected employer and requires confirmation.

Accreditation is current while the Auckland calendar date is not later than the date portion of `expiryDateOfAccreditation`. Association confidence and accreditation status are separate; an accurately associated employer may be expired.

Resolution precedence is strict: selected manual/community association, unique exact official-name match, other positive canonical candidates requiring confirmation, fresh exact no-match observation, then live INZ lookup. Positive official data therefore always overrides a previous no-match observation, and a stored association always overrides an automatic match.

## 6. Public API

### 6.1 Health

```http
GET /health
```

No `X-Client-ID`, D1 access, or rate limit.

```json
{
  "service": "nz-accredited-employer-api",
  "version": "0.6.0",
  "environment": "production",
  "status": "ok"
}
```

### 6.2 Resolve a platform entity

```http
POST /v1/employers/resolve
Content-Type: application/json
X-Client-ID: <uuid>
```

Request:

```json
{
  "identity": {
    "platform": "seek",
    "externalKey": "company:/companies/anz-171714174098706",
    "kind": "seek_company_profile",
    "strength": "strong",
    "displayName": "ANZ Bank New Zealand Limited",
    "publicUrl": "https://nz.seek.com/companies/anz-171714174098706"
  }
}
```

Success: `200 EmployerResolutionResponse`.

This endpoint is read-only. It searches `employers.normalized_employer_name` and `normalized_trading_name` using:

1. exact NZBN/name/trading-name match;
2. one normalised string containing the other;
3. stable deterministic ordering and a 20-row limit.

A fuzzy candidate is never automatically written as an association.

After applying association precedence, `/resolve` automatically selects a candidate only when the returned canonical candidate set contains exactly one row and normalised `identity.displayName` exactly equals that row's normalised official `employerName`. The response uses the existing freshness state (`associated` or `refresh_required`), sets `matchMethod: "exact_employer_name"`, keeps `association: null`, and performs no D1 write. Exact `tradingName` or containment matches still return `confirmation_required`.

If no association/candidate exists, the Worker compares `(platform, externalKey)` and the normalised current `displayName` with the stored no-match observation. A matching observation is fresh for exactly 24 hours from Worker `checkedAt`; at the boundary it is expired and `/resolve` returns `inz_lookup_required`.

### 6.3 Ingest a successful INZ response

```http
POST /v1/employers/ingest
Content-Type: application/json
X-Client-ID: <uuid>
```

Maximum request body: 128 KiB as UTF-8.

```ts
interface EmployerIngestRequest {
  identity: PlatformIdentity;
  query: string;
  page: number; // 1–100; normally 1
  inzResponse: unknown;
}
```

The extension submits a normal successful INZ top-level JSON object unchanged. The Worker:

1. parses the JSON-string `results` field;
2. extracts `employerName`, `tradingName`, `nzbn`, and `expiryDateOfAccreditation` by `APIColumn`;
3. validates every result; one invalid result rejects the whole request;
4. rejects zero-result payloads because recognised INZ `400 No Results` uses `/no-match`;
5. atomically upserts every returned employer by NZBN and clears any existing no-match observation for this platform identity in one D1 `batch()`;
6. sets Worker time as `last_verified_at` and returns a fresh `EmployerResolutionResponse`.

All valid results are stored even when only one is later associated with the platform page. A client-supplied timestamp or accreditation boolean is never accepted.

`inzResponse.current` must equal `page`. Up to 50 results may be submitted. Duplicate NZBNs are rejected.

Success: `200 EmployerResolutionResponse`. Immediately after an unassociated live lookup, the normal state is `confirmation_required` and `candidates` contains every employer from the submitted INZ page (up to 50), in INZ order, followed by other local candidates without duplicates. If the submitted INZ response reports `totalResults: 1`, the combined candidate set contains exactly one employer, and its official `employerName` exactly matches the normalised platform display name, the response is instead `associated` with `matchMethod: "exact_employer_name"` and no association write. `noMatch` is `null` in either case.

### 6.4 Store a recognised no-match observation

```http
POST /v1/employers/no-match
Content-Type: application/json
X-Client-ID: <uuid>
```

```ts
interface EmployerNoMatchRequest {
  identity: PlatformIdentity;
  /** Must normalise to identity.displayName. */
  query: string;
  /** Raw recognised INZ HTTP 400 JSON envelope. */
  inzResponse: unknown;
}
```

The Worker accepts the observation only when `Title` is exactly `No Results`, `Message` starts with `Your search found no results.` after leading whitespace, and the normalised query exactly equals the normalised platform display name. It creates/updates `platform_entities`, uses Worker time, and returns `state: "no_published_inz_match"` with `noMatch.checkedAt` and `noMatch.expiresAt`.

If a fresh identical observation already exists, submitting it again does not move `checkedAt` or extend `expiresAt`. A new observation is accepted only after expiry or when the platform display-name query changes. Before writing, the Worker resolves the identity again; if an association or positive candidate is already visible, it returns that positive resolution without writing the observation. This check and the subsequent observation write are separate D1 operations, so a concurrent positive ingest may leave an irrelevant negative observation stored. Resolution precedence still guarantees that positive data wins and the observation is not returned.

### 6.5 Confirm or change an association

```http
POST /v1/employers/associate
Content-Type: application/json
X-Client-ID: <uuid>
```

```json
{
  "identity": {
    "platform": "linkedin",
    "externalKey": "company:onenz",
    "kind": "linkedin_company_url",
    "strength": "strong",
    "displayName": "One New Zealand",
    "publicUrl": "https://www.linkedin.com/company/onenz/"
  },
  "nzbn": "9429034908822"
}
```

The NZBN must already exist in `employers`. The Worker atomically upserts the platform entity metadata, clears its no-match observation, and writes this installation's confirmation. Re-submitting another NZBN changes the installation's association.

Success: `200 EmployerResolutionResponse` with `state: "associated"` or `"refresh_required"`, `matchMethod: "platform_association"`, and the employer freshness result.

## 7. Extension orchestration

For each explicit user click:

1. Build `PlatformIdentity` from the current page.
2. Call `/resolve`.
3. Branch on `state`:
   - `associated`: render selected employer, accreditation status, official data timestamp, match provenance, and alternatives. For `platform_association`, show association source/count. For `exact_employer_name`, show `Automatic exact official-name match` and `Not community-confirmed`. No INZ request.
   - `confirmation_required`: render every candidate with a confirm action and do not call INZ because D1 already has plausible official records. The current extension has no forced `Search INZ again` action in this state.
   - `no_published_inz_match`: render `noMatch.checkedAt`/`expiresAt` and do not call INZ.
   - `inz_lookup_required`: make exactly one INZ request using `inzQuery`; positive → `/ingest`; recognised no-result → `/no-match` with the raw envelope, then render the returned resolution.
   - `refresh_required`: make exactly one INZ request using the NZBN `inzQuery`; positive → `/ingest`; recognised no-result → local `verification_required` UI state, retain the old employer only as clearly dated context, preserve the exact-name/association provenance, and perform no Worker write.
4. After `/ingest`, render candidates and require user confirmation unless an association resolves the entity or the unique exact official-name rule passes.
5. On confirm/change, call `/associate` and render its returned resolution.

The first implementation may run the live action immediately after the same initial click for `inz_lookup_required`/`refresh_required`. It must never perform another live call in a retry loop.

## 8. INZ request and no-result handling

Endpoint:

```text
https://www.immigration.govt.nz/list-api/getAPIResults/
```

```ts
const formData = new FormData();
formData.set("query", query);
formData.set("collection", "2");
formData.set("page", String(page));

await fetch("https://www.immigration.govt.nz/list-api/getAPIResults/", {
  method: "POST",
  headers: { Accept: "application/json" },
  body: formData,
  signal: AbortSignal.timeout(5_000),
});
```

Do not set multipart `Content-Type`; `fetch` generates the boundary. Parse the body as JSON even when INZ labels it `text/plain`.

INZ currently represents no published match as HTTP `400`:

```json
{
  "Title": "No Results",
  "Message": "Your search found no results.\n You may wish to refine your search or check if your spelling is correct",
  "BackgroundClass": "bg--grey"
}
```

Treat it as no result only when all are true:

- status is exactly `400`;
- `Title` is exactly `No Results`;
- trimmed-leading `Message` starts with `Your search found no results.`.

For that recognised envelope after an unassociated display-name lookup:

- do not call `/ingest`;
- call `/no-match` with the raw envelope; do not synthesise an empty INZ result;
- do not create an `employers` row;
- show `No published INZ match` and its 24-hour observation window;
- show `Live verification needs review` for a stale associated NZBN;
- include a new-tab link to the official [INZ accredited employer list](https://www.immigration.govt.nz/work/requirements-for-work-visas/approved-employers/accredited-employer-list/).

Every other non-2xx response, malformed JSON, or timeout is an error and is not submitted.

## 9. D1 data model

### `employers` — canonical asset

One row per NZBN:

| Column | Meaning |
| --- | --- |
| `nzbn` | Primary key, exactly 13 digits. |
| `employer_name` | Latest official INZ employer name. |
| `normalized_employer_name` | Worker-normalised search field. |
| `trading_name` | Latest nullable official INZ trading name. |
| `normalized_trading_name` | Nullable Worker-normalised search field. |
| `expiry_date_of_accreditation` | Latest official INZ local datetime string. |
| `first_seen_at` | Worker Unix seconds for first accepted observation/import. |
| `last_verified_at` | Worker Unix seconds for latest accepted INZ observation/import. |
| `last_verified_source` | `inz_live_lookup` or `inz_official_import`. |

Future official bulk data is imported directly into this table with `last_verified_source = 'inz_official_import'`. Live user-driven INZ results continuously supplement and update the same rows.

### `platform_entities` — platform identity metadata

One row per `(platform, external_key)`. Stores identity kind/strength, latest display name/public URL metadata, first/last seen times, and nullable `last_no_match_query` / `last_no_match_at` observation fields. A no-match is query evidence, not an accreditation claim.

### `platform_employer_confirmations` — community mapping

One row per `(platform_entity_id, client_id_hash)`. Stores the selected NZBN and created/updated times. A client changes its mapping by updating this row. Aggregation produces the community association counts returned by the API.

Automatic exact-name matches have no table and no stored flag. They are derived from the current `employers` candidate set on each resolution, so they cannot inflate community confirmation counts.

`employer_searches` and `employer_search_results` are removed. D1 is not used as a query-response cache.

No-match observations need no cleanup job: `/resolve` ignores them at 24 hours, and a later positive ingest/association clears them. The timestamp is not extended by duplicate fresh submissions.

## 10. Trust and provenance

This public client-submission architecture can validate payload shape and rate-limit abuse, but cannot cryptographically prove that a payload came from INZ. No secret embedded in a public extension can solve that.

Current controls:

- 128 KiB body limit and strict INZ schema/data validation;
- valid 13-digit NZBN, expiry date, duplicate, pagination, and field-length checks;
- Worker-owned timestamps and source labels;
- atomic upsert of every accepted INZ result;
- strict no-match envelope/query validation, exact platform scoping, and a 24-hour lifetime;
- 30 requests/minute/client and 10 writes/minute/client;
- hashed client IDs in association confirmation rows;
- visible distinction between official employer data and community mappings;
- visible distinction between stored platform associations and derived exact official-name matches;
- official INZ link and a user-changeable association.

This is an MVP placeholder, not protection against a determined attacker fabricating a valid-looking payload. Stronger provenance requires an INZ-approved server-side integration, signed source data, or moderated import/audit workflows.

## 11. Headers and errors

All JSON application responses include `X-Request-ID`, `Cache-Control: no-store`, `Access-Control-Allow-Origin: *`, and `X-Content-Type-Options: nosniff`. CORS permits `GET, POST, OPTIONS` and `X-Client-ID, Content-Type`. `X-Request-ID` and `Retry-After` are exposed. An `OPTIONS` request receives a global `204` preflight response with the CORS headers and `X-Request-ID`; it does not include `Cache-Control` or `X-Content-Type-Options`, and its path is not route-validated.

Errors use:

```json
{ "error": { "code": "invalid_identity", "message": "The platform identity is invalid." } }
```

Main error codes:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_client_id` | Missing/invalid `X-Client-ID`. |
| 400 | `invalid_identity` | Platform identity fields or combinations are invalid. |
| 400 | `invalid_submission` | JSON envelope/query/page is invalid. |
| 400 | `invalid_inz_response` | INZ payload failed validation. |
| 400 | `empty_inz_response` | No-result payloads must not be ingested. |
| 400 | `invalid_no_match_response` | `/no-match` payload is not the recognised INZ envelope. |
| 400 | `query_mismatch` | No-match query does not normalise to the platform display name. |
| 400 | `page_mismatch` | Request page and INZ current page differ. |
| 400 | `invalid_nzbn` | Association NZBN is malformed. |
| 404 | `employer_not_found` | Association NZBN is not in canonical employers. |
| 404 | `not_found` | Unknown API path. |
| 405 | `method_not_allowed` | Wrong method. |
| 413 | `payload_too_large` | Body exceeds 128 KiB. |
| 415 | `unsupported_media_type` | JSON endpoint without `application/json`. |
| 429 | `rate_limit_exceeded` | Request limiter rejected; use `Retry-After: 60`. |
| 429 | `submission_rate_limit_exceeded` | Write limiter rejected. |
| 500 | `internal_error` | Worker/D1 failure; show retry UI without a loop. |

Cloudflare platform failures may be non-JSON. For a non-JSON API failure, the extension includes the HTTP status in the displayed error message and retains `X-Request-ID` when available. The extension's error contract does not expose HTTP status as a separate field.

## 12. Compatibility

- The four `v1` routes are `/v1/employers/resolve`, `/v1/employers/ingest`, `/v1/employers/no-match`, and `/v1/employers/associate`.
- Additive fields are allowed in `v1`; clients ignore unknown response fields. Service `0.6.0` adds required `matchMethod` to distinguish stored platform associations from automatic exact-name selection while retaining the existing resolution-state values.
- Removing/renaming fields or changing orchestration semantics requires a new API version.
- INZ `Title` and `Type` metadata are documentation only and are not stored.
- The Worker owns normalisation, fuzzy lookup, exact official-name selection, official payload parsing, timestamps, freshness, accreditation evaluation, aggregation, and D1 writes.
- The extension owns source-page identity extraction, user-triggered INZ calls, recognised no-result handling, candidate confirmation/change UI, and provenance display.
