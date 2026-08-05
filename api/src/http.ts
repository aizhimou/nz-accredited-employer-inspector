import { ApiError } from "./errors";
import {
  associateEmployer,
  hashClientId,
  ingestEmployers,
  resolveEmployer,
  storeNoMatchObservation,
} from "./service";
import {
  parseAssociationRequest,
  parseIngestRequest,
  parseNoMatchRequest,
  parseResolveRequest,
  validateClientId,
} from "./validation";

const RESOLVE_PATH = "/v1/employers/resolve";
const INGEST_PATH = "/v1/employers/ingest";
const NO_MATCH_PATH = "/v1/employers/no-match";
const ASSOCIATE_PATH = "/v1/employers/associate";
const HEALTH_PATH = "/health";
const MAX_SUBMISSION_BYTES = 128 * 1024;

const CORS_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "X-Client-ID, Content-Type",
  "Access-Control-Expose-Headers": "X-Request-ID, Retry-After",
  "Access-Control-Max-Age": "86400",
};

function responseHeaders(
  requestId: string,
  additionalHeaders: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return {
    ...CORS_HEADERS,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Request-ID": requestId,
    ...additionalHeaders,
  };
}

function jsonResponse(
  body: unknown,
  status: number,
  requestId: string,
  additionalHeaders: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(body, {
    status,
    headers: responseHeaders(requestId, additionalHeaders),
  });
}

function errorResponse(error: ApiError, requestId: string): Response {
  const headers: Record<string, string> = { ...error.headers };
  if (error.retryAfter !== undefined) {
    headers["Retry-After"] = String(error.retryAfter);
  }
  return jsonResponse(
    { error: { code: error.code, message: error.message } },
    error.status,
    requestId,
    headers,
  );
}

async function readSubmissionJson(request: Request): Promise<unknown> {
  const mediaType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new ApiError(
      415,
      "unsupported_media_type",
      "Content-Type must be application/json.",
    );
  }

  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new ApiError(400, "invalid_content_length", "Content-Length is invalid.");
    }
    if (length > MAX_SUBMISSION_BYTES) {
      throw new ApiError(413, "payload_too_large", "The request body is too large.");
    }
  }

  if (request.body === null) {
    throw new ApiError(400, "invalid_json", "The request body must contain valid JSON.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_SUBMISSION_BYTES) {
        await reader.cancel();
        throw new ApiError(413, "payload_too_large", "The request body is too large.");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, "invalid_json", "The request body must contain valid JSON.");
  }
}

function logEvent(level: "info" | "error", event: Record<string, unknown>): void {
  const message = JSON.stringify(event);
  if (level === "error") {
    console.error(message);
  } else {
    console.log(message);
  }
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const startedAt = Date.now();

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...CORS_HEADERS, "X-Request-ID": requestId },
    });
  }

  try {
    if (url.pathname === HEALTH_PATH) {
      if (request.method !== "GET") {
        throw new ApiError(405, "method_not_allowed", "Only GET is allowed for this endpoint.");
      }
      return jsonResponse(
        {
          service: "nz-accredited-employer-api",
          version: env.SERVICE_VERSION,
          environment: env.ENVIRONMENT,
          status: "ok",
        },
        200,
        requestId,
      );
    }

    if (
      url.pathname !== RESOLVE_PATH &&
      url.pathname !== INGEST_PATH &&
      url.pathname !== NO_MATCH_PATH &&
      url.pathname !== ASSOCIATE_PATH
    ) {
      throw new ApiError(404, "not_found", "The requested endpoint was not found.");
    }
    if (request.method !== "POST") {
      throw new ApiError(
        405,
        "method_not_allowed",
        "Only POST is allowed for this endpoint.",
      );
    }

    const clientId = validateClientId(request.headers.get("X-Client-ID"));
    const clientLimit = await env.CLIENT_RATE_LIMITER.limit({
      key: `${clientId}:employers-v1`,
    });
    if (!clientLimit.success) {
      throw new ApiError(429, "rate_limit_exceeded", "Too many requests.", 60);
    }

    const body = await readSubmissionJson(request);
    const clientIdHash = await hashClientId(clientId);

    if (url.pathname === RESOLVE_PATH) {
      const input = parseResolveRequest(body);
      const result = await resolveEmployer(env.DB, input.identity, clientIdHash);
      logEvent("info", {
        event: "employer_resolve",
        requestId,
        platform: input.identity.platform,
        identityStrength: input.identity.strength,
        state: result.state,
        candidateCount: result.candidates.length,
        durationMs: Date.now() - startedAt,
      });
      return jsonResponse(result, 200, requestId);
    }

    const submissionLimit = await env.SUBMISSION_RATE_LIMITER.limit({
      key: `${clientId}:employers-v1:write`,
    });
    if (!submissionLimit.success) {
      throw new ApiError(429, "submission_rate_limit_exceeded", "Too many submissions.", 60);
    }

    if (url.pathname === INGEST_PATH) {
      const input = parseIngestRequest(body);
      const result = await ingestEmployers(env.DB, input, clientIdHash);
      logEvent("info", {
        event: "employer_ingest",
        requestId,
        platform: input.identity.platform,
        page: input.page,
        queryLength: input.query.length,
        state: result.state,
        candidateCount: result.candidates.length,
        durationMs: Date.now() - startedAt,
      });
      return jsonResponse(result, 200, requestId);
    }

    if (url.pathname === NO_MATCH_PATH) {
      const input = parseNoMatchRequest(body);
      const result = await storeNoMatchObservation(env.DB, input, clientIdHash);
      logEvent("info", {
        event: "employer_no_match",
        requestId,
        platform: input.identity.platform,
        identityStrength: input.identity.strength,
        queryLength: input.query.length,
        state: result.state,
        durationMs: Date.now() - startedAt,
      });
      return jsonResponse(result, 200, requestId);
    }

    const input = parseAssociationRequest(body);
    const result = await associateEmployer(
      env.DB,
      input.identity,
      input.nzbn,
      clientIdHash,
    );
    logEvent("info", {
      event: "employer_associate",
      requestId,
      platform: input.identity.platform,
      identityStrength: input.identity.strength,
      state: result.state,
      durationMs: Date.now() - startedAt,
    });
    return jsonResponse(result, 200, requestId);
  } catch (error) {
    const apiError =
      error instanceof ApiError
        ? error
        : new ApiError(500, "internal_error", "An unexpected error occurred.");

    logEvent(apiError.status >= 500 ? "error" : "info", {
      event: "request_error",
      requestId,
      path: url.pathname,
      status: apiError.status,
      code: apiError.code,
      durationMs: Date.now() - startedAt,
      ...(error instanceof Error ? { internalMessage: error.message } : {}),
    });
    return errorResponse(apiError, requestId);
  }
}
