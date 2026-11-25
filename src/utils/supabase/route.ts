import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { supabaseConfig } from "./config";
import { authSiteOrigin } from "@/features/auth/site-url";

export function createRouteSupabase(request: NextRequest, response: NextResponse) {
  const { url, key } = supabaseConfig();
  return createServerClient(url, key, {
    cookieOptions: { secure: authSiteOrigin().startsWith("https:") },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (changes, headers) => {
        for (const { name, value, options } of changes) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
        for (const [name, value] of Object.entries(headers ?? {})) response.headers.set(name, value);
      },
    },
  });
}
