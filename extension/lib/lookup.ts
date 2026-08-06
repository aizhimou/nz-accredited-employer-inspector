import {
  type EmployerResolutionResponse,
  isEmployerResolutionResponse,
  type LiveLookupStatus,
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
): LookupSuccess {
  return {
    ok: true,
    identity,
    data: resolution.data,
    liveLookupStatus,
    requestId: resolution.requestId,
  };
}

function toFailure(error: unknown): LookupResponse {
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
        if (resolution.data.state === "refresh_required") {
          return toSuccess(identity, resolution, "verification_required");
        }
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

    const query = resolution.data.inzQuery;
    if (query === null) {
      throw new LookupError(
        "invalid_api_response",
        "The accreditation service omitted the required INZ refresh query.",
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
        return toSuccess(identity, resolution, "verification_required");
      }
      throw error;
    }
  } catch (error) {
    return toFailure(error);
  }
}
