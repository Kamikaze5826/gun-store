import { createClient } from "npm:@supabase/supabase-js@2";
import { env, HttpError } from "./http.ts";

const options = { auth: { persistSession: false, autoRefreshToken: false } };

export function serviceClient() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), options);
}

export async function authenticate(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = /^Bearer (\S+)$/i.exec(authorization ?? "")?.[1];
  if (!token) throw new HttpError(401, "AUTH_REQUIRED");
  const client = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    ...options, global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous) throw new HttpError(401, "AUTH_REQUIRED");
  return { user: data.user, client };
}

export function checkDatabase(error: { code: string; message: string } | null, trustedAction = false) {
  if (!error) return;
  const code = /^[A-Z][A-Z_]+$/.test(error.message) ? error.message : "DATABASE_ERROR";
  if (error.code === "42501") throw new HttpError(403, code);
  if (error.code === "22023" && !trustedAction) throw new HttpError(422, code);
  if (["23505", "40001", "40P01"].includes(error.code) && !trustedAction) {
    throw new HttpError(409, code === "DATABASE_ERROR" ? "RETRY_OPERATION" : code);
  }
  console.error("PostgreSQL:", error.code, code);
  throw new HttpError(500, "DATABASE_ERROR");
}
