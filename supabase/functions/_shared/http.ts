import { z } from "npm:zod@4";

export class HttpError extends Error {
  constructor(public status: number, public code: string, public details?: unknown) {
    super(code);
  }
}

export function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function cors(request: Request) {
  const headers = new Headers({
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, apikey, x-client-info, content-type, stripe-signature, x-marketplace-maintenance",
    "access-control-max-age": "600",
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    vary: "Origin",
  });
  const origin = request.headers.get("origin");
  const configured = Deno.env.get("APP_URL");
  if (origin && configured && origin === new URL(configured).origin) {
    headers.set("access-control-allow-origin", origin);
  }
  return headers;
}

export function endpoint(handler: (request: Request) => Promise<unknown>) {
  return async (request: Request) => {
    const headers = cors(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    try {
      if (request.method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED");
      return Response.json(await handler(request), { headers });
    } catch (error) {
      if (error instanceof HttpError) {
        return Response.json({ code: error.code, details: error.details }, { status: error.status, headers });
      }
      console.error("Edge handler failed:", error instanceof Error ? error.name : "unknown");
      return Response.json({ code: "INTERNAL_ERROR" }, { status: 500, headers });
    }
  };
}

export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (Number(request.headers.get("content-length")) > 65_536) throw new HttpError(413, "BODY_TOO_LARGE");
  const body = await request.text();
  if (body.length > 65_536) throw new HttpError(413, "BODY_TOO_LARGE");
  let payload: unknown;
  try { payload = JSON.parse(body); } catch { throw new HttpError(400, "INVALID_JSON"); }
  const result = schema.safeParse(payload);
  if (!result.success) throw new HttpError(400, "INVALID_INPUT", result.error.issues);
  return result.data;
}
