import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSection, loginPath } from "./src/features/auth/redirects";
import { isSupabaseConfigured, supabaseConfig } from "./src/utils/supabase/config";
import { authSiteOrigin } from "./src/features/auth/site-url";

export async function middleware(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.next();
  const { url, key } = supabaseConfig();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookieOptions: { secure: authSiteOrigin().startsWith("https:") },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (changes, headers) => {
        for (const { name, value } of changes) request.cookies.set(name, value);
        // Rebuild the request override so Server Components also see refreshed cookies.
        const updated = NextResponse.next({ request });
        for (const cookie of response.cookies.getAll()) updated.cookies.set(cookie);
        for (const { name, value, options } of changes) updated.cookies.set(name, value, options);
        for (const [name, value] of Object.entries(headers ?? {})) updated.headers.set(name, value);
        response = updated;
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const userId = claims?.is_anonymous === true ? undefined : claims?.sub;
  const { pathname, search } = request.nextUrl;
  const seller = isSection(pathname, "/seller");
  const admin = isSection(pathname, "/admin");
  const protectedRoute = seller || admin || ["/checkout", "/orders", "/profile"].some((section) => isSection(pathname, section));

  function redirectTo(path: string) {
    const redirected = NextResponse.redirect(new URL(path, request.nextUrl));
    for (const cookie of response.cookies.getAll()) redirected.cookies.set(cookie);
    redirected.headers.set("Cache-Control", "private, no-store");
    return redirected;
  }

  if (protectedRoute && !userId) return redirectTo(loginPath(pathname + search));
  if (userId && (seller || admin)) {
    const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (error || !profile) return redirectTo("/");
    if (admin && profile.role !== "admin") return redirectTo("/");
    if (seller) {
      const onboarding = pathname === "/seller/onboarding";
      if (profile.role === "buyer" && !onboarding) return redirectTo("/seller/onboarding");
      if (profile.role !== "buyer" && onboarding) return redirectTo(profile.role === "admin" ? "/admin" : "/seller");
    }
  }
  if (protectedRoute || userId) response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|marketplace/|favicon.ico|robots.txt|sitemap.xml).*)"],
};
