"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseConfig } from "./config";

export function createBrowserSupabase() {
  const { url, key } = supabaseConfig();
  return createBrowserClient(url, key, {
    cookieOptions: { secure: typeof window !== "undefined" && window.location.protocol === "https:" },
  });
}
