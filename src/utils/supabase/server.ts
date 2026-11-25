import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig } from "./config";
import { authSiteOrigin } from "@/features/auth/site-url";

async function requestClient(writable: boolean) {
  const cookieStore = await cookies();
  const { url, key } = supabaseConfig();
  return createServerClient(url, key, {
    cookieOptions: { secure: authSiteOrigin().startsWith("https:") },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (changes) => {
        if (writable) for (const { name, value, options } of changes) cookieStore.set(name, value, options);
      },
    },
  });
}

// Middleware refreshes requests before they reach a read-only Server Component.
export const createServerSupabase = () => requestClient(false);
export const createActionSupabase = () => requestClient(true);
