import { NextResponse, type NextRequest } from "next/server";
import { createRouteSupabase } from "@/utils/supabase/route";
import { isSupabaseConfigured } from "@/utils/supabase/config";
import { recoveryCookie, recoveryMaxAge, recoverySession } from "@/features/auth/recovery";
import { safeRedirect } from "@/features/auth/redirects";
import { authSiteOrigin } from "@/features/auth/site-url";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const destination = safeRedirect(searchParams.get("redirect"));
  const origin = authSiteOrigin();
  const failure = new URL(type === "recovery" ? "/forgot-password" : "/login", origin);
  failure.searchParams.set("notice", "link-expired");
  if (type !== "recovery") failure.searchParams.set("redirect", destination);
  const response = NextResponse.redirect(failure, 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (!isSupabaseConfigured || !token_hash || (type !== "email" && type !== "recovery")) return response;

  const supabase = createRouteSupabase(request, response);
  const { error } = await supabase.auth.verifyOtp({ token_hash, type });
  if (error) return response;
  if (type === "recovery") {
    const session = await recoverySession(supabase);
    if (!session) return response;
    response.cookies.set(recoveryCookie, session + "." + (Date.now() + recoveryMaxAge * 1000), {
      maxAge: recoveryMaxAge, httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", path: "/",
    });
    response.headers.set("Location", new URL("/update-password", origin).href);
  } else {
    response.cookies.delete(recoveryCookie);
    response.headers.set("Location", new URL(destination, origin).href);
  }
  return response;
}
