import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerSupabase } from "@/utils/supabase/server";
import { isSupabaseConfigured } from "@/utils/supabase/config";

export const recoveryCookie = "marketplace-password-recovery";
export const recoveryMaxAge = 15 * 60;

export async function recoverySession(client: SupabaseClient) {
  const { data } = await client.auth.getClaims();
  const session = data?.claims?.session_id;
  return typeof session === "string" && data?.claims?.is_anonymous !== true ? session : null;
}

export async function canRecoverPassword(client?: SupabaseClient) {
  if (!isSupabaseConfigured) return false;
  const value = (await cookies()).get(recoveryCookie)?.value;
  if (!value) return false;
  const [session, expiresAt] = value.split(".");
  if (!session || !Number.isSafeInteger(Number(expiresAt)) || Number(expiresAt) <= Date.now()) return false;
  return session === await recoverySession(client ?? await createServerSupabase());
}
