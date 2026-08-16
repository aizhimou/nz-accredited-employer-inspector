import {
  type EmployerResolutionResponse,
  type EmployerSearchResponse,
  isEmployerSearchResponse,
  isEmployerResolutionResponse,
  type LiveLookupStatus,
  type LookupFailure,
  type LookupResponse,
  type LookupSuccess,
  type PlatformIdentity,
} from "./contracts";

export const API_BASE_URL = "https://nzaei.zemo.bio/api";
export const INZ_API_URL = "https://www.immigration.govt.nz/list-api/getAPIResults/";

const INZ_COLLECTION_ID = "2";
const INZ_TIMEOUT_MILLISECONDS = 5_000;

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface ApiErrorBody {
  error: { code: string; message: string };
}

interface InzNoResultsBody {
  Title: "No Results";
  Message: string;
}

interface ApiResolution {
  data: EmployerResolutionResponse;
  requestId: string | null;
}

interface EmployerRefreshAuthorization {
  state: "authorized" | "cooldown" | "not_required";
  resolution: EmployerResolutionResponse;
  inzQuery: string | null;
  retryAt: string | null;
}

interface ApiRefreshAuthorization {
  data: EmployerRefreshAuthorization;
  requestId: string | null;
}

class LookupError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId: string | null = null,
  ) {
    super(message);
    this.name = "LookupError";
  }
}

class InzNoResultsError extends Error {
  constructor(readonly inzResponse: InzNoResultsBody) {
    super("INZ returned no published result.");
    this.name = "InzNoResultsError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (!isRecord(value) || !isRecord(value.error)) {
    return false;
  }
  return typeof value.error.code === "string" && typeof value.error.message === "string";
}

function isInzNoResultsBody(value: unknown): value is InzNoResultsBody {
  return (
    isRecord(value) &&
    value.Title === "No Results" &&
    typeof value.Message === "string" &&
    value.Message.trimStart().startsWith("Your search found no results.")
  );
}

function isEmployerRefreshAuthorization(
  value: unknown,
): value is EmployerRefreshAuthorization {
  return (
    isRecord(value) &&
    (value.state === "authorized" ||
      value.state === "cooldown" ||
      value.state === "not_required") &&
    isEmployerResolutionResponse(value.resolution) &&
    (value.inzQuery === null || typeof value.inzQuery === "string") &&
    (value.retryAt === null || typeof value.retryAt === "string")
  );
}

async function toApiError(response: Response): Promise<LookupError> {
  const requestId = response.headers.get("X-Request-ID");
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new LookupError(
      "api_unavailable",
      `The accreditation service returned HTTP ${response.status}.`,
      requestId,
    );
  }
  return isApiErrorBody(body)
    ? new LookupError(body.error.code, body.error.message, requestId)
    : new LookupError(
        "api_unavailable",
        `The accreditation service returned HTTP ${response.status}.`,
        requestId,
      );
}

async function callApi(
  path: string,
  body: unknown,
  clientId: string,
  fetchFn: FetchLike,
): Promise<ApiResolution> {
  let response: Response;
  try {
    response = await fetchFn(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-ID": clientId },
      body: JSON.stringify(body),
    });
  } catch {
    throw new LookupError("api_unavailable", "Could not reach the accreditation service.");
  }
  if (!response.ok) {
    throw await toApiError(response);
  }
  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    throw new LookupError(
      "invalid_api_response",
      "The accreditation service returned invalid JSON.",
      response.headers.get("X-Request-ID"),
    );
  }
  if (!isEmployerResolutionResponse(responseBody)) {
    throw new LookupError(
      "invalid_api_response",
      "The accreditation service returned an invalid employer resolution.",
      response.headers.get("X-Request-ID"),
    );
  }
  return { data: responseBody, requestId: response.headers.get("X-Request-ID") };
}

async function authorizeRefresh(
  identity: PlatformIdentity,
  nzbn: string,
  manual: boolean,
  clientId: string,
  fetchFn: FetchLike,
): Promise<ApiRefreshAuthorization> {
  let response: Response;
  try {
    response = await fetchFn(`${API_BASE_URL}/v1/employers/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-ID": clientId },
      body: JSON.stringify({ identity, nzbn, manual }),
    });
  } catch {
    throw new LookupError("api_unavailable", "Could not reach the accreditation service.");
  }
  if (!response.ok) {
    throw await toApiError(response);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new LookupError(
      "invalid_api_response",
      "The accreditation service returned invalid JSON.",
      response.headers.get("X-Request-ID"),
    );
  }
  if (!isEmployerRefreshAuthorization(body)) {
    throw new LookupError(
      "invalid_api_response",
      "The accreditation service returned an invalid refresh authorization.",
      response.headers.get("X-Request-ID"),
    );
  }
  return { data: body, requestId: response.headers.get("X-Request-ID") };
}

async function fetchInzResponse(query: string, fetchFn: FetchLike): Promise<unknown> {
  const formData = new FormData();
  formData.set("query", query);
  formData.set("collection", INZ_COLLECTION_ID);
  formData.set("page", "1");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), INZ_TIMEOUT_MILLISECONDS);
  try {
    const response = await fetchFn(INZ_API_URL, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: formData,
      signal: controller.signal,
    });
    let body: unknown;
    try {
      body = JSON.parse(await response.text()) as unknown;
    } catch {
      if (!response.ok) {
        throw new LookupError(
          "inz_unavailable",
          "Immigration New Zealand returned temporary error.",
        );
      }
      throw new LookupError(
        "invalid_inz_response",
        "Immigration New Zealand returned invalid JSON.",
      );
    }

    if (response.ok) {
      return body;
    }
    if (response.status === 400 && isInzNoResultsBody(body)) {
      throw new InzNoResultsError(body);
    }
    throw new LookupError(
      "inz_unavailable",
      "Immigration New Zealand returned temporary error.",
    );
  } catch (error) {
    if (error instanceof LookupError || error instanceof InzNoResultsError) {
      throw error;
    }
    throw new LookupError(
      "inz_unavailable",
      controller.signal.aborted
        ? "Immigration New Zealand did not respond within 5 seconds."
        : "Could not reach Immigration New Zealand.",
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function toSuccess(
  identity: PlatformIdentity,
  resolution: ApiResolution,
  liveLookupStatus: LiveLookupStatus,
  refreshAvailableAt: string | null = null,
): LookupSuccess {
  return {
    ok: true,
    identity,
    data: resolution.data,
    liveLookupStatus,
    refreshAvailableAt,
    requestId: resolution.requestId,
  };
}


async function performEmployerRefresh(
  identity: PlatformIdentity,
  nzbn: string,
  manual: boolean,
  clientId: string,
  fetchFn: FetchLike,
): Promise<LookupSuccess> {
  const authorization = await authorizeRefresh(
    identity,
    nzbn,
    manual,
    clientId,
    fetchFn,
  );
  const resolution = {
    data: authorization.data.resolution,
    requestId: authorization.requestId,
  };
  if (authorization.data.state === "cooldown") {
    return toSuccess(
      identity,
      resolution,
      "refresh_deferred",
      authorization.data.retryAt,
    );
  }
  if (authorization.data.state === "not_required") {
    return toSuccess(identity, resolution, "not_needed");
  }

  const query = authorization.data.inzQuery;
  if (query === null) {
    throw new LookupError(
      "invalid_api_response",
      "The accreditation service omitted the authorized INZ query.",
      authorization.requestId,
    );
  }

  try {
    const inzResponse = await fetchInzResponse(query, fetchFn);
    const updated = await callApi(
      "/v1/employers/ingest",
      { identity, query, page: 1, inzResponse },
      clientId,
      fetchFn,
    );
    return toSuccess(identity, updated, "updated");
  } catch (error) {
    if (error instanceof InzNoResultsError) {
      const stored = await callApi(
        "/v1/employers/no-match",
        { identity, query, inzResponse: error.inzResponse },
        clientId,
        fetchFn,
      );
      return toSuccess(identity, stored, "verification_required");
    }
    throw error;
  }
}

function toFailure(error: unknown): LookupFailure {
  if (error instanceof LookupError) {
    return {
      ok: false,
      error: { code: error.code, message: error.message, requestId: error.requestId },
    };
  }
  return {
    ok: false,
    error: {
      code: "unexpected_error",
      message: "An unexpected error occurred while checking accreditation.",
      requestId: null,
    },
  };
}

export async function lookupEmployer(
  identity: PlatformIdentity,
  clientId: string,
  fetchFn: FetchLike = fetch,
): Promise<LookupResponse> {
  try {
    const resolution = await callApi(
      "/v1/employers/resolve",
      { identity },
      clientId,
      fetchFn,
    );
    if (
      resolution.data.state === "associated" ||
      resolution.data.state === "confirmation_required" ||
      resolution.data.state === "no_published_inz_match"
    ) {
      return toSuccess(
        identity,
        resolution,
        resolution.data.state === "no_published_inz_match"
          ? "no_published_inz_match"
          : "not_needed",
      );
    }

    if (resolution.data.state === "refresh_required") {
      const nzbn = resolution.data.selectedEmployer?.nzbn;
      if (nzbn === undefined) {
        throw new LookupError(
          "invalid_api_response",
          "The accreditation service omitted the employer requiring refresh.",
          resolution.requestId,
        );
      }
      return await performEmployerRefresh(identity, nzbn, false, clientId, fetchFn);
    }

    const query = resolution.data.inzQuery;
    if (query === null) {
      throw new LookupError(
        "invalid_api_response",
        "The accreditation service omitted the required INZ query.",
        resolution.requestId,
      );
    }

    try {
      const inzResponse = await fetchInzResponse(query, fetchFn);
      const updated = await callApi(
        "/v1/employers/ingest",
        { identity, query, page: 1, inzResponse },
        clientId,
        fetchFn,
      );
      return toSuccess(identity, updated, "updated");
    } catch (error) {
      if (error instanceof InzNoResultsError) {
        const stored = await callApi(
          "/v1/employers/no-match",
          { identity, query, inzResponse: error.inzResponse },
          clientId,
          fetchFn,
        );
        return toSuccess(identity, stored, "no_published_inz_match");
      }
      throw error;
    }
  } catch (error) {
    return toFailure(error);
  }
}

export async function associateEmployer(
  identity: PlatformIdentity,
  nzbn: string,
  clientId: string,
  fetchFn: FetchLike = fetch,
): Promise<LookupResponse> {
  try {
    const resolution = await callApi(
      "/v1/employers/associate",
      { identity, nzbn },
      clientId,
      fetchFn,
    );
    if (resolution.data.state !== "refresh_required") {
      return toSuccess(identity, resolution, "not_needed");
    }
    return await performEmployerRefresh(identity, nzbn, false, clientId, fetchFn);
  } catch (error) {
    return toFailure(error);
  }
}

export async function refreshEmployer(
  identity: PlatformIdentity,
  nzbn: string,
  clientId: string,
  fetchFn: FetchLike = fetch,
): Promise<LookupResponse> {
  try {
    return await performEmployerRefresh(identity, nzbn, true, clientId, fetchFn);
  } catch (error) {
    return toFailure(error);
  }
}

export async function searchEmployers(
  identity: PlatformIdentity,
  query: string,
  clientId: string,
  fetchFn: FetchLike = fetch,
): Promise<EmployerSearchResponse> {
  try {
    let response: Response;
    try {
      response = await fetchFn(`${API_BASE_URL}/v1/employers/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Client-ID": clientId },
        body: JSON.stringify({ query }),
      });
    } catch {
      throw new LookupError("api_unavailable", "Could not reach the accreditation service.");
    }
    if (!response.ok) {
      throw await toApiError(response);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new LookupError(
        "invalid_api_response",
        "The accreditation service returned invalid JSON.",
        response.headers.get("X-Request-ID"),
      );
    }
    const result: unknown = {
      ok: true,
      identity,
      ...(isRecord(body) ? body : {}),
      requestId: response.headers.get("X-Request-ID"),
    };
    if (!isEmployerSearchResponse(result) || !result.ok) {
      throw new LookupError(
        "invalid_api_response",
        "The accreditation service returned an invalid employer search result.",
        response.headers.get("X-Request-ID"),
      );
    }
    return result;
  } catch (error) {
    return toFailure(error);
  }
}
