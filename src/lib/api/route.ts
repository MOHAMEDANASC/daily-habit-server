import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { ApiError, Errors, type FieldErrors } from "@/lib/api/errors";
import { getCurrentUser, type SessionUser } from "@/lib/auth/session";
import { logger } from "@/lib/logger";

/** Success envelope: `{ data }`. Failures are `{ error: { code, message, details? } }`. */
export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}

export function created<T>(data: T): NextResponse {
  return ok(data, 201);
}

function errorResponse(error: ApiError): NextResponse {
  return NextResponse.json(
    { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } },
    { status: error.status, headers: error.headers },
  );
}

function fieldErrors(error: ZodError): FieldErrors {
  const details: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    details[key] ??= issue.message;
  }
  return details;
}

function toApiError(error: unknown, request: NextRequest): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError) return Errors.validation(fieldErrors(error));
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return Errors.conflict("That record already exists.");
    if (error.code === "P2025") return Errors.notFound();
  }
  logger.error("Unhandled API error", { path: request.nextUrl.pathname, method: request.method, error });
  return new ApiError(500, "INTERNAL_ERROR", "Something went wrong on our side. Please try again.");
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Reject cross-site state-changing requests (defence in depth on top of SameSite=Lax cookies). */
function assertSameOrigin(request: NextRequest): void {
  if (SAFE_METHODS.has(request.method)) return;
  const origin = request.headers.get("origin");
  if (!origin) return; // non-browser clients (curl, server-to-server) do not send Origin
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    // malformed Origin header
  }
  if (!host || originHost !== host) throw Errors.forbidden("Cross-origin requests are not allowed.");
}

export interface ApiContext<P> {
  request: NextRequest;
  params: P;
  user: SessionUser;
}

type Params = Record<string, string>;
type NextContext<P> = { params: Promise<P> };

/** Wrap a route handler: same-origin check â†’ authentication â†’ handler â†’ uniform errors. */
export function apiRoute<P extends Params = Params>(handler: (context: ApiContext<P>) => Promise<Response>) {
  return async (request: NextRequest, context: NextContext<P>): Promise<Response> => {
    try {
      assertSameOrigin(request);
      const user = await getCurrentUser();
      if (!user) throw Errors.unauthorized();
      return await handler({ request, params: await context.params, user });
    } catch (error) {
      return errorResponse(toApiError(error, request));
    }
  };
}

/** Wrap a public route handler (login, register, password reset, cron). */
export function publicRoute<P extends Params = Params>(
  handler: (context: { request: NextRequest; params: P }) => Promise<Response>,
) {
  return async (request: NextRequest, context: NextContext<P>): Promise<Response> => {
    try {
      assertSameOrigin(request);
      return await handler({ request, params: await context.params });
    } catch (error) {
      return errorResponse(toApiError(error, request));
    }
  };
}

const MAX_BODY_BYTES = 64 * 1024;

export async function parseJson<T>(request: NextRequest, schema: ZodType<T>): Promise<T> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw Errors.badRequest("The request body must be valid JSON.");
  }
  return schema.parse(body);
}

export function parseQuery<T>(request: NextRequest, schema: ZodType<T>): T {
  return schema.parse(Object.fromEntries(request.nextUrl.searchParams));
}

export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}
