import type { APIRoute } from "astro";

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
    expiryDateOfAccreditation: { type: "string", format: "date" },
    lastVerifiedAt: { type: "string", format: "date-time" },
    accreditationStatus: { type: "string", enum: ["accredited", "expired"] },
  },
} as const;

const commonHeaders = {
  "X-Request-ID": {
    description: "Unique request identifier for support and diagnostics.",
    schema: { type: "string", format: "uuid" },
  },
} as const;

const successfulHeaders = {
  ...commonHeaders,
  "Cache-Control": {
    description: "Successful responses are cacheable for 60 seconds in clients and 5 minutes at the edge.",
    schema: { type: "string", example: "public, max-age=60, s-maxage=300" },
  },
} as const;

const errorResponses = {
  "400": { $ref: "#/components/responses/Error" },
  "404": { $ref: "#/components/responses/Error" },
  "429": { $ref: "#/components/responses/RateLimitError" },
  "500": { $ref: "#/components/responses/Error" },
} as const;

export const GET: APIRoute = () => {
  const document = {
    openapi: "3.1.0",
    info: {
      title: "NZ Accredited Employer Inspector Public API",
      version: "1.0.0",
      description: "A free, unauthenticated, read-only API for looking up New Zealand accredited employer records. Use the dated R2 CSV snapshots for bulk imports. This independent project is not an Immigration New Zealand product and does not provide immigration or legal advice.",
      license: { name: "NOASSERTION", identifier: "NOASSERTION" },
      contact: { name: "Zemo Ai", url: "https://zemo.bio/" },
    },
    externalDocs: {
      description: "Public API guide",
      url: "https://nzaei.zemo.bio/public-api/",
    },
    servers: [{ url: "https://nzaei.zemo.bio/api/public/v1" }],
    paths: {
      "/employers/{nzbn}": {
        get: {
          operationId: "getEmployerByNzbn",
          summary: "Look up an employer by NZBN",
          parameters: [{
            name: "nzbn",
            in: "path",
            required: true,
            description: "13-digit New Zealand Business Number.",
            schema: { type: "string", pattern: "^[0-9]{13}$" },
          }],
          responses: {
            "200": {
              description: "Employer record",
              headers: successfulHeaders,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/EmployerResponse" },
                },
              },
            },
            ...errorResponses,
          },
        },
        head: {
          operationId: "headEmployerByNzbn",
          summary: "Get employer response headers without a body",
          parameters: [{
            name: "nzbn",
            in: "path",
            required: true,
            schema: { type: "string", pattern: "^[0-9]{13}$" },
          }],
          responses: {
            "200": { description: "Employer response headers", headers: successfulHeaders },
            ...errorResponses,
          },
        },
      },
      "/employers/search": {
        get: {
          operationId: "searchEmployers",
          summary: "Search employer and trading names",
          description: "Every query token must match an indexed employer or trading name. Results are BM25-ranked and capped at 10.",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              schema: { type: "string", minLength: 3, maxLength: 100 },
              example: "One New Zealand",
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 10, default: 10 },
            },
          ],
          responses: {
            "200": {
              description: "Matching employer records",
              headers: successfulHeaders,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/EmployerSearchResponse" },
                },
              },
            },
            ...errorResponses,
          },
        },
        head: {
          operationId: "headEmployerSearch",
          summary: "Get search response headers without a body",
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string", minLength: 3, maxLength: 100 } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 10, default: 10 } },
          ],
          responses: {
            "200": { description: "Search response headers", headers: successfulHeaders },
            ...errorResponses,
          },
        },
      },
    },
    components: {
      schemas: {
        AccreditedEmployer: employerSchema,
        EmployerResponse: {
          type: "object",
          additionalProperties: false,
          required: ["data"],
          properties: { data: { $ref: "#/components/schemas/AccreditedEmployer" } },
        },
        EmployerSearchResponse: {
          type: "object",
          additionalProperties: false,
          required: ["data", "meta"],
          properties: {
            data: {
              type: "array",
              maxItems: 10,
              items: { $ref: "#/components/schemas/AccreditedEmployer" },
            },
            meta: {
              type: "object",
              additionalProperties: false,
              required: ["query", "count"],
              properties: {
                query: { type: "string" },
                count: { type: "integer", minimum: 0, maximum: 10 },
              },
            },
          },
        },
        Error: {
          type: "object",
          additionalProperties: false,
          required: ["error", "meta"],
          properties: {
            error: {
              type: "object",
              additionalProperties: false,
              required: ["code", "message"],
              properties: { code: { type: "string" }, message: { type: "string" } },
            },
            meta: {
              type: "object",
              additionalProperties: false,
              required: ["requestId"],
              properties: { requestId: { type: "string", format: "uuid" } },
            },
          },
        },
      },
      responses: {
        Error: {
          description: "Client or server error",
          headers: commonHeaders,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        RateLimitError: {
          description: "Rate limit exceeded",
          headers: {
            ...commonHeaders,
            "Retry-After": {
              description: "Seconds to wait before retrying.",
              schema: { type: "integer", const: 10 },
            },
          },
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
    },
  };

  return new Response(JSON.stringify(document, null, 2), {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Type": "application/vnd.oai.openapi+json;version=3.1",
    },
  });
};
