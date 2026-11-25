import { NextResponse, type NextRequest } from "next/server";
import { createRouteSupabase } from "@/utils/supabase/route";
import { isSupabaseConfigured } from "@/utils/supabase/config";
import { recoveryCookie } from "@/features/auth/recovery";
import { safeRedirect } from "@/features/auth/redirects";
import { authSiteOrigin } from "@/features/auth/site-url";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const destination = safeRedirect(searchParams.get("redirect"));
  const failure = new URL("/login", authSiteOrigin());
  failure.searchParams.set("notice", "oauth-failed");
  failure.searchParams.set("redirect", destination);
  const response = NextResponse.redirect(failure, 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  const code = searchParams.get("code");
  if (!isSupabaseConfigured || !code) return response;
  const { error } = await createRouteSupabase(request, response).auth.exchangeCodeForSession(code);
  if (!error) {
    response.cookies.delete(recoveryCookie);
    response.headers.set("Location", new URL(destination, authSiteOrigin()).href);
  }
  return response;
}
