import { NextRequest } from "next/server";
import { cookieJar } from "./cookie-jar";

type Handler = (request: NextRequest, context: { params: Promise<never> }) => Promise<Response>;

export interface ApiResult<T = any> {
  status: number;
  body: { data?: T; error?: { code: string; message: string; details?: Record<string, string> } };
  headers: Headers;
  /** Shortcut for `body.data`. */
  data: T;
}

/** A browser-like client with its own cookie jar, calling route handlers directly. */
export class ApiClient {
  private jar = new Map<string, string>();

  async call<T = any>(
    handler: unknown,
    options: { method?: string; path?: string; body?: unknown; params?: Record<string, string>; headers?: Record<string, string> } = {},
  ): Promise<ApiResult<T>> {
    const method = options.method ?? "GET";
    const request = new NextRequest(`http://localhost${options.path ?? "/api/test"}`, {
      method,
      headers: {
        host: "localhost",
        "content-type": "application/json",
        "user-agent": "vitest",
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    cookieJar.active = this.jar;
    const response = await (handler as Handler)(request, { params: Promise.resolve((options.params ?? {}) as never) });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    return { status: response.status, body, headers: response.headers, data: body.data };
  }

  get signedIn(): boolean {
    return this.jar.has("habit_session");
  }
}
