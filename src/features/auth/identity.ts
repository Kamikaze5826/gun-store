import { cache } from "react";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/utils/supabase/server";
import { isSupabaseConfigured } from "@/utils/supabase/config";
import { loginPath } from "./redirects";

export type Viewer = {
  id: string;
  email: string;
  displayName: string;
  avatar: string | null;
  role: "buyer" | "seller" | "admin";
  hasShop: boolean;
};

function avatarUrl(value: unknown) {
  if (typeof value !== "string") return null;
  if (/^\/(?!\/)[^\\\r\n]+$/.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export const getViewer = cache(async (): Promise<Viewer | null> => {
  if (!isSupabaseConfigured) return null;
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub || claims.is_anonymous === true) return null;

  const { data: profile } = await supabase.from("profiles").select("role,display_name,avatar_path")
    .eq("id", claims.sub).maybeSingle();
  if (!profile || !["buyer", "seller", "admin"].includes(profile.role)) return null;
  const shop = profile.role === "seller" ? await supabase.from("shops").select("id")
    .eq("owner_id", claims.sub).limit(1).maybeSingle() : null;
  const email = typeof claims.email === "string" ? claims.email : "";
  const metadata = claims.user_metadata;
  const inferredName = typeof metadata?.full_name === "string" ? metadata.full_name.trim().slice(0, 100) : "";
  return {
    id: claims.sub, email, role: profile.role,
    displayName: profile.display_name?.trim() || inferredName || email.split("@")[0] || "Tài khoản",
    avatar: avatarUrl(profile.avatar_path) ?? avatarUrl(metadata?.avatar_url),
    hasShop: Boolean(shop?.data),
  };
});

export async function requireViewer(path: string) {
  if (!isSupabaseConfigured) return null;
  const viewer = await getViewer();
  if (!viewer) redirect(loginPath(path));
  return viewer;
}
