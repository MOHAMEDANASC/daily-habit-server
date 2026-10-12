export type FieldErrors = Record<string, string>;

/** An error that is safe to show to the client. Anything else becomes a generic 500. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: FieldErrors,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const Errors = {
  badRequest: (message = "The request is invalid.", details?: FieldErrors) =>
    new ApiError(400, "BAD_REQUEST", message, details),
  validation: (details: FieldErrors) => new ApiError(400, "VALIDATION_ERROR", "Please check the highlighted fields.", details),
  unauthorized: (message = "You need to sign in to continue.") => new ApiError(401, "UNAUTHORIZED", message),
  forbidden: (message = "You do not have permission to do that.") => new ApiError(403, "FORBIDDEN", message),
  notFound: (what = "Resource") => new ApiError(404, "NOT_FOUND", `${what} not found.`),
  conflict: (message: string, details?: FieldErrors) => new ApiError(409, "CONFLICT", message, details),
  tooManyRequests: (retryAfterSeconds: number) =>
    new ApiError(429, "RATE_LIMITED", "Too many attempts. Please wait a moment and try again.", undefined, {
      "Retry-After": String(retryAfterSeconds),
    }),
};
