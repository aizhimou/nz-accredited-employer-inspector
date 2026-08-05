export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class InzResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InzResponseError";
  }
}
