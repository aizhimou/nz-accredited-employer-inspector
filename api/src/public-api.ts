import { ApiError } from "./errors";
import { getEmployerByNzbn, searchEmployerCandidates } from "./service";

const PUBLIC_API_PREFIX = "/public/v1";
const EMPLOYER_SEARCH_PATH = `${PUBLIC_API_PREFIX}/employers/search`;
const EMPLOYER_PATH_PREFIX = `${PUBLIC_API_PREFIX}/employers/`;
const PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS = 10;
const PUBLIC_API_CACHE_CONTROL = "public, max-age=60, s-maxage=300";
const MAX_SEARCH_RESULTS = 10;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const NZBN_PATTERN = /^\d{13}$/u;

const CORS_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "X-Request-ID, Retry-After",
  "Access-Control-Max-Age": "86400",
};

interface PublicSearchInput {
  query: string;
  limit: number;
}

function normalizedPathname(request: Request): string {
  const pathname = new URL(request.url).pathname;
  return pathname.startsWith("/api/")
    ? pathname.slice("/api".length)
    : pathname;
}

function responseHeaders(
  requestId: string,
  additionalHeaders: Readonly<Record<string, string>> = {},
): Headers {
  return new Headers({
    ...CORS_HEADERS,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Request-ID": requestId,
    ...additionalHeaders,
  });
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
    {
      error: { code: error.code, message: error.message },
      meta: { requestId },
    },
    error.status,
    requestId,
    headers,
  );
}

function responseForMethod(response: Response, method: string, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Request-ID", requestId);
  return new Response(method === "HEAD" ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function assertOnlySearchParameters(url: URL): void {
  for (const key of url.searchParams.keys()) {
    if (key !== "q" && key !== "limit") {
      throw new ApiError(400, "invalid_parameter", `Unsupported query parameter: ${key}.`);
    }
  }
}

function readSingleSearchParameter(url: URL, name: "q" | "limit"): string | null {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) {
    throw new ApiError(400, "invalid_parameter", `${name} may be supplied only once.`);
  }
  return values[0] ?? null;
}

function parseSearchInput(url: URL): PublicSearchInput {
  assertOnlySearchParameters(url);
  const value = readSingleSearchParameter(url, "q");
  if (value === null) {
    throw new ApiError(400, "missing_parameter", "q is required.");
  }
  const query = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (query.length < 3 || query.length > 100 || CONTROL_CHARACTERS.test(query)) {
    throw new ApiError(
      400,
      "invalid_parameter",
      "q must contain between 3 and 100 valid characters.",
    );
  }

  const rawLimit = readSingleSearchParameter(url, "limit");
  if (rawLimit === null) {
    return { query, limit: MAX_SEARCH_RESULTS };
  }
  if (!/^[1-9]\d*$/u.test(rawLimit)) {
    throw new ApiError(400, "invalid_parameter", "limit must be an integer from 1 to 10.");
  }
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit > MAX_SEARCH_RESULTS) {
    throw new ApiError(400, "invalid_parameter", "limit must be an integer from 1 to 10.");
  }
  return { query, limit };
}

function parseEmployerNzbn(pathname: string, url: URL): string {
  if (url.search !== "") {
    throw new ApiError(400, "invalid_parameter", "This endpoint does not accept query parameters.");
  }
  const nzbn = pathname.slice(EMPLOYER_PATH_PREFIX.length);
  if (!NZBN_PATTERN.test(nzbn)) {
    throw new ApiError(400, "invalid_nzbn", "nzbn must contain exactly 13 digits.");
  }
  return nzbn;
}

function isSupportedEndpoint(pathname: string): boolean {
  return pathname === EMPLOYER_SEARCH_PATH || pathname.startsWith(EMPLOYER_PATH_PREFIX);
}

function logEvent(level: "info" | "error", event: Record<string, unknown>): void {
  const message = JSON.stringify(event);
  if (level === "error") {
    console.error(message);
  } else {
    console.log(message);
  }
}

async function findCachedResponse(cacheKey: Request): Promise<Response | null> {
  return (await caches.default.match(cacheKey)) ?? null;
}

function cacheResponse(
  ctx: ExecutionContext,
  cacheKey: Request,
  response: Response,
  requestId: string,
): void {
  ctx.waitUntil(
    caches.default.put(cacheKey, response.clone()).catch((error: unknown) => {
      logEvent("error", {
        event: "public_api_cache_write_failed",
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }),
  );
}

function cacheKeyFor(url: URL): Request {
  return new Request(url.toString(), { method: "GET" });
}

export function isPublicApiRequest(request: Request): boolean {
  return normalizedPathname(request).startsWith(`${PUBLIC_API_PREFIX}/`);
}

export async function handlePublicApiRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const pathname = normalizedPathname(request);
  const startedAt = Date.now();

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: responseHeaders(requestId),
    });
  }

  try {
    if (!isSupportedEndpoint(pathname)) {
      throw new ApiError(404, "not_found", "The requested endpoint was not found.");
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      throw new ApiError(
        405,
        "method_not_allowed",
        "Only GET and HEAD are allowed for this endpoint.",
        undefined,
        { Allow: "GET, HEAD, OPTIONS" },
      );
    }

    const clientIp = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const rateLimit = await env.PUBLIC_API_RATE_LIMITER.limit({
      key: `${clientIp}:public-api-v1`,
    });
    if (!rateLimit.success) {
      throw new ApiError(
        429,
        "rate_limit_exceeded",
        "Too many requests. Try again shortly.",
        PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS,
      );
    }

    const cacheKey = cacheKeyFor(url);
    const cached = await findCachedResponse(cacheKey);
    if (cached !== null) {
      logEvent("info", {
        event: "public_api_request",
        requestId,
        path: pathname,
        method: request.method,
        cache: "hit",
        status: cached.status,
        durationMs: Date.now() - startedAt,
      });
      return responseForMethod(cached, request.method, requestId);
    }

    let response: Response;
    if (pathname === EMPLOYER_SEARCH_PATH) {
      const input = parseSearchInput(url);
      const result = await searchEmployerCandidates(env.DB, input.query);
      response = jsonResponse(
        {
          data: result.candidates.slice(0, input.limit),
          meta: { query: input.query, count: Math.min(result.candidates.length, input.limit) },
        },
        200,
        requestId,
        { "Cache-Control": PUBLIC_API_CACHE_CONTROL },
      );
    } else {
      const nzbn = parseEmployerNzbn(pathname, url);
      const employer = await getEmployerByNzbn(env.DB, nzbn);
      if (employer === null) {
        throw new ApiError(404, "employer_not_found", "No employer was found for the supplied NZBN.");
      }
      response = jsonResponse(
        { data: employer },
        200,
        requestId,
        { "Cache-Control": PUBLIC_API_CACHE_CONTROL },
      );
    }

    cacheResponse(ctx, cacheKey, response, requestId);
    logEvent("info", {
      event: "public_api_request",
      requestId,
      path: pathname,
      method: request.method,
      cache: "miss",
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
    return responseForMethod(response, request.method, requestId);
  } catch (error) {
    const apiError = error instanceof ApiError
      ? error
      : new ApiError(500, "internal_error", "An unexpected error occurred.");
    logEvent(apiError.status >= 500 ? "error" : "info", {
      event: "public_api_request_error",
      requestId,
      path: pathname,
      method: request.method,
      status: apiError.status,
      code: apiError.code,
      durationMs: Date.now() - startedAt,
      ...(error instanceof Error ? { internalMessage: error.message } : {}),
    });
    return errorResponse(apiError, requestId);
  }
}
