import type { APIRoute } from "astro";

const platformIdentitySchema = {
  type: "object",
  additionalProperties: false,
  required: ["platform", "externalKey", "kind", "strength", "displayName", "publicUrl"],
  properties: {
    platform: { type: "string", enum: ["linkedin", "seek"] },
    externalKey: { type: "string" },
    kind: {
      type: "string",
      enum: ["linkedin_company_url", "seek_company_profile", "seek_advertiser_name"],
    },
    strength: { type: "string", enum: ["strong", "weak"] },
    displayName: { type: "string", minLength: 1, maxLength: 300 },
    publicUrl: { type: ["string", "null"], format: "uri" },
  },
} as const;

const employerSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "employerName",
    "tradingName",
    "nzbn",
    "expiryDateOfAccreditation",
    "lastVerifiedAt",
    "accreditationStatus",
  ],
  properties: {
    employerName: { type: "string" },
    tradingName: { type: ["string", "null"] },
    nzbn: { type: "string", pattern: "^[0-9]{13}$" },
    expiryDateOfAccreditation: { type: "string" },
    lastVerifiedAt: { type: "string", format: "date-time" },
    accreditationStatus: { type: "string", enum: ["accredited", "expired"] },
  },
} as const;

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "state",
    "matchMethod",
    "selectedEmployer",
    "candidates",
    "association",
    "noMatch",
    "inzQuery",
  ],
  properties: {
    state: {
      type: "string",
      enum: [
        "associated",
        "refresh_required",
        "confirmation_required",
        "no_published_inz_match",
        "inz_lookup_required",
      ],
    },
    matchMethod: {
      type: ["string", "null"],
      enum: ["platform_association", "exact_employer_name", null],
    },
    selectedEmployer: { anyOf: [{ $ref: "#/components/schemas/AccreditedEmployer" }, { type: "null" }] },
    candidates: { type: "array", maxItems: 10, items: { $ref: "#/components/schemas/AccreditedEmployer" } },
    association: {
      anyOf: [
        { $ref: "#/components/schemas/EmployerAssociation" },
        { type: "null" },
      ],
    },
    noMatch: { anyOf: [{ $ref: "#/components/schemas/NoMatchObservation" }, { type: "null" }] },
    inzQuery: { type: ["string", "null"] },
  },
} as const;

const operationResponses = {
  "200": {
    description: "Employer resolution",
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/EmployerResolutionResponse" } },
    },
  },
  "400": { $ref: "#/components/responses/Error" },
  "409": { $ref: "#/components/responses/Error" },
  "429": { $ref: "#/components/responses/Error" },
  "500": { $ref: "#/components/responses/Error" },
} as const;

const clientHeader = {
  name: "X-Client-ID",
  in: "header",
  required: true,
  description: "Random UUID persisted by the extension installation. It is a rate-limit and confirmation key, not authentication.",
  schema: { type: "string", format: "uuid" },
} as const;

export const GET: APIRoute = () => {
  const document = {
    openapi: "3.1.0",
    info: {
      title: "NZ Accredited Employer API",
      version: "0.7.1",
      description:
        "Product API for resolving platform employers, accepting validated INZ observations, storing user-confirmed associations, and collecting the temporary Chrome Web Store notification list. The Worker does not call INZ.",
      license: {
        name: "Repository license",
        identifier: "NOASSERTION",
      },
      contact: {
        name: "Zemo Ai",
        url: "https://zemo.bio/",
      },
      "x-privacy-policy": "https://nzaei.zemo.bio/privacy/",
    },
    externalDocs: {
      description: "Canonical extension and API contract",
      url: "https://github.com/aizhimou/nz-accredited-employer-inspector/blob/main/docs/extension-api-ssot.md",
    },
    servers: [{ url: "https://nzaei.zemo.bio/api" }],
    paths: {
      "/health": {
        get: {
          operationId: "getHealth",
          summary: "Get service health",
          responses: {
            "200": {
              description: "Service health",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["service", "version", "environment", "status"],
                    properties: {
                      service: { type: "string" },
                      version: { type: "string" },
                      environment: { type: "string" },
                      status: { type: "string", const: "ok" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/v1/employers/resolve": {
        post: {
          operationId: "resolveEmployer",
          summary: "Resolve a LinkedIn or SEEK platform identity",
          description: "Read-only. Returns an association, exact-name match, candidates, a fresh no-match observation, or a query for one user-triggered INZ lookup. Selected records require refresh after 30 days or once their stored expiry passes.",
          parameters: [clientHeader],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ResolveRequest" } },
            },
          },
          responses: operationResponses,
        },
      },
      "/v1/employers/search": {
        post: {
          operationId: "searchEmployers",
          summary: "Search local official employer candidates",
          description: "Read-only recovery search. Uses an independent query, never calls INZ, and never creates an association.",
          parameters: [clientHeader],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/EmployerSearchRequest" } },
            },
          },
          responses: {
            "200": {
              description: "Ranked local employer candidates",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/EmployerSearchResponse" } },
              },
            },
            "400": { $ref: "#/components/responses/Error" },
            "429": { $ref: "#/components/responses/Error" },
            "500": { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/employers/ingest": {
        post: {
          operationId: "ingestInzResponse",
          summary: "Validate and ingest a positive INZ response",
          parameters: [clientHeader],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/IngestRequest" } },
            },
          },
          responses: operationResponses,
        },
      },
      "/v1/employers/no-match": {
        post: {
          operationId: "recordNoMatch",
          summary: "Record a recognised INZ no-match response",
          description: "A display-name no-match is bound to the platform identity/query for seven days. An authorized NZBN refresh no-match instead applies a 24-hour employer cooldown without changing lastVerifiedAt.",
          parameters: [clientHeader],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/NoMatchRequest" } },
            },
          },
          responses: operationResponses,
        },
      },
      "/v1/employers/refresh": {
        post: {
          operationId: "authorizeEmployerRefresh",
          summary: "Authorize one automatic or manual employer refresh",
          description: "Atomically claims a short per-NZBN refresh lease. The extension, not the Worker, performs the INZ request. Manual refresh never creates an association.",
          parameters: [clientHeader],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/EmployerRefreshRequest" } },
            },
          },
          responses: {
            "200": {
              description: "Refresh authorization, cooldown, or not-required result",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/EmployerRefreshAuthorizationResponse" } },
              },
            },
            "400": { $ref: "#/components/responses/Error" },
            "404": { $ref: "#/components/responses/Error" },
            "409": { $ref: "#/components/responses/Error" },
            "429": { $ref: "#/components/responses/Error" },
            "500": { $ref: "#/components/responses/Error" },
          },
        },
      },
      "/v1/employers/associate": {
        post: {
          operationId: "associateEmployer",
          summary: "Confirm or change this installation's employer association",
          parameters: [clientHeader],
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/AssociationRequest" } },
            },
          },
          responses: operationResponses,
        },
      },
      "/v1/waitlist": {
        post: {
          operationId: "joinExtensionWaitlist",
          summary: "Join the Chrome Web Store release notification list",
          description: "Stores a normalized, unique email address for one release notification. Does not require an extension client ID.",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/WaitlistRequest" } },
            },
          },
          responses: {
            "200": {
              description: "The address was accepted or was already present",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["state"],
                    properties: { state: { type: "string", const: "subscribed" } },
                  },
                },
              },
            },
            "400": { $ref: "#/components/responses/Error" },
            "429": { $ref: "#/components/responses/Error" },
            "500": { $ref: "#/components/responses/Error" },
          },
        },
      },
    },
    components: {
      schemas: {
        PlatformIdentity: platformIdentitySchema,
        AccreditedEmployer: employerSchema,
        EmployerAssociation: {
          type: "object",
          required: ["nzbn", "source", "confirmationCount", "alternativeConfirmationCount", "disputed", "identityStrength"],
          properties: {
            nzbn: { type: ["string", "null"], pattern: "^[0-9]{13}$" },
            source: { type: ["string", "null"], enum: ["self", "community", null] },
            confirmationCount: { type: "integer", minimum: 0 },
            alternativeConfirmationCount: { type: "integer", minimum: 0 },
            disputed: { type: "boolean" },
            identityStrength: { type: "string", enum: ["strong", "weak"] },
          },
        },
        NoMatchObservation: {
          type: "object",
          required: ["query", "checkedAt", "expiresAt"],
          properties: {
            query: { type: "string" },
            checkedAt: { type: "string", format: "date-time" },
            expiresAt: { type: "string", format: "date-time" },
          },
        },
        EmployerResolutionResponse: responseSchema,
        ResolveRequest: {
          type: "object",
          required: ["identity"],
          properties: { identity: { $ref: "#/components/schemas/PlatformIdentity" } },
        },
        EmployerSearchRequest: {
          type: "object",
          additionalProperties: false,
          required: ["query"],
          properties: {
            query: { type: "string", minLength: 3, maxLength: 100 },
          },
        },
        EmployerSearchResponse: {
          type: "object",
          additionalProperties: false,
          required: ["query", "candidates"],
          properties: {
            query: { type: "string" },
            candidates: {
              type: "array",
              maxItems: 10,
              items: { $ref: "#/components/schemas/AccreditedEmployer" },
            },
          },
        },
        IngestRequest: {
          type: "object",
          required: ["identity", "query", "page", "inzResponse"],
          properties: {
            identity: { $ref: "#/components/schemas/PlatformIdentity" },
            query: { type: "string", minLength: 3, maxLength: 100 },
            page: { type: "integer", minimum: 1, maximum: 100 },
            inzResponse: { description: "Raw successful INZ top-level JSON object" },
          },
        },
        NoMatchRequest: {
          type: "object",
          required: ["identity", "query", "inzResponse"],
          properties: {
            identity: { $ref: "#/components/schemas/PlatformIdentity" },
            query: { type: "string", minLength: 3, maxLength: 100 },
            inzResponse: {
              type: "object",
              required: ["Title", "Message"],
              properties: {
                Title: { type: "string", const: "No Results" },
                Message: { type: "string" },
              },
            },
          },
        },
        AssociationRequest: {
          type: "object",
          required: ["identity", "nzbn"],
          properties: {
            identity: { $ref: "#/components/schemas/PlatformIdentity" },
            nzbn: { type: "string", pattern: "^[0-9]{13}$" },
          },
        },
        EmployerRefreshRequest: {
          type: "object",
          additionalProperties: false,
          required: ["identity", "nzbn", "manual"],
          properties: {
            identity: { $ref: "#/components/schemas/PlatformIdentity" },
            nzbn: { type: "string", pattern: "^[0-9]{13}$" },
            manual: { type: "boolean" },
          },
        },
        EmployerRefreshAuthorizationResponse: {
          type: "object",
          additionalProperties: false,
          required: ["state", "resolution", "inzQuery", "retryAt"],
          properties: {
            state: { type: "string", enum: ["authorized", "cooldown", "not_required"] },
            resolution: { $ref: "#/components/schemas/EmployerResolutionResponse" },
            inzQuery: { type: ["string", "null"] },
            retryAt: { type: ["string", "null"], format: "date-time" },
          },
        },
        WaitlistRequest: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string", format: "email", maxLength: 254 },
            website: { type: "string", maxLength: 300, description: "Spam honeypot; genuine clients leave this empty." },
          },
        },
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: { code: { type: "string" }, message: { type: "string" } },
            },
          },
        },
      },
      responses: {
        Error: {
          description: "Application error",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
    },
  };

  return new Response(JSON.stringify(document, null, 2), {
    headers: { "Content-Type": "application/vnd.oai.openapi+json;version=3.1" },
  });
};
