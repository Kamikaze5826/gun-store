"use server";

import type { AuthError } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { createActionSupabase } from "@/utils/supabase/server";
import { isSupabaseConfigured } from "@/utils/supabase/config";
import { canRecoverPassword, recoveryCookie } from "./recovery";
import { loginPath, safeRedirect } from "./redirects";
import { forgotSchema, loginSchema, onboardingSchema, profileSchema, registerSchema, updatePasswordSchema } from "./schemas";
import { authSiteOrigin } from "./site-url";
import { isAdminUsername, isLoopbackHost, localAdminEmail, localAdminEnabled } from "./local-admin";

type ActionResult = { error: string } | { redirect?: string; message?: string };
const configurationError = { error: "Chưa cấu hình kết nối Supabase." };
const invalid = { error: "Thông tin chưa hợp lệ. Hãy kiểm tra lại biểu mẫu." };

function authError(error: AuthError): ActionResult {
  switch (error.code) {
    case "invalid_credentials": return { error: "Email hoặc mật khẩu không đúng." };
    case "email_not_confirmed": return { error: "Email chưa được xác nhận. Hãy kiểm tra hộp thư." };
    case "user_already_exists":
    case "email_exists": return { error: "Email đã được đăng ký. Hãy đăng nhập hoặc đặt lại mật khẩu." };
    case "weak_password": return { error: "Mật khẩu chưa đạt yêu cầu bảo mật. Hãy chọn mật khẩu mạnh hơn." };
    case "same_password": return { error: "Mật khẩu mới cần khác mật khẩu hiện tại." };
    case "over_request_rate_limit":
    case "over_email_send_rate_limit": return { error: "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau." };
    default: return { error: "Chưa thể thực hiện yêu cầu xác thực. Vui lòng thử lại." };
  }
}

function endpoint(path: string, destination?: string) {
  const url = new URL(path, authSiteOrigin());
  if (destination) url.searchParams.set("redirect", safeRedirect(destination));
  return url.href;
}

export async function loginWithPassword(input: unknown, destination: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return configurationError;
  const credentials = loginSchema.safeParse(input);
  if (!credentials.success) return invalid;
  const supabase = await createActionSupabase();
  const { email, password } = credentials.data;
  const localAccount = isAdminUsername(email) || email.toLowerCase() === localAdminEmail;
  if (localAccount && (!localAdminEnabled || !isLoopbackHost(new URL(authSiteOrigin()).hostname) ||
    !isLoopbackHost(URL.parse("http://" + (await headers()).get("host"))?.hostname))) return invalid;
  const { error } = await supabase.auth.signInWithPassword({ email: localAccount ? localAdminEmail : email, password });
  if (error) return authError(error);
  (await cookies()).delete(recoveryCookie);
  return { redirect: safeRedirect(destination) };
}

export async function startGoogleLogin(destination: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return configurationError;
  const supabase = await createActionSupabase();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: endpoint("/auth/callback", safeRedirect(destination)), skipBrowserRedirect: true },
  });
  if (error || !data.url) return { error: "Chưa thể đăng nhập bằng Google. Vui lòng thử lại hoặc dùng email." };
  return { redirect: data.url };
}

export async function registerAccount(input: unknown, destination: string): Promise<ActionResult> {
  if (!isSupabaseConfigured) return configurationError;
  const form = registerSchema.safeParse(input);
  if (!form.success) return invalid;
  const { name, email, password } = form.data;
  const supabase = await createActionSupabase();
  const { data, error } = await supabase.auth.signUp({
    email, password, options: {
      data: { display_name: name },
      emailRedirectTo: endpoint("/auth/confirm", safeRedirect(destination)),
    },
  });
  if (error) return authError(error);
  if (data.session) return { redirect: safeRedirect(destination) };
  return { message: "Hãy kiểm tra hộp thư để xác nhận email. Nếu đã có tài khoản, bạn có thể đăng nhập hoặc đặt lại mật khẩu." };
}

export async function sendRecoveryEmail(input: unknown): Promise<ActionResult> {
  if (!isSupabaseConfigured) return configurationError;
  const form = forgotSchema.safeParse(input);
  if (!form.success) return invalid;
  const supabase = await createActionSupabase();
  const { error } = await supabase.auth.resetPasswordForEmail(form.data.email, {
    redirectTo: endpoint("/auth/confirm", "/search"),
  });
  if (error && error.code !== "user_not_found") return authError(error);
  return { message: "Nếu email thuộc một tài khoản, bạn sẽ nhận được liên kết đặt lại mật khẩu. Hãy kiểm tra hộp thư và thư rác." };
}

export async function saveNewPassword(input: unknown): Promise<ActionResult> {
  if (!isSupabaseConfigured) return configurationError;
  const form = updatePasswordSchema.safeParse(input);
  if (!form.success) return invalid;
  const supabase = await createActionSupabase();
  if (!await canRecoverPassword(supabase)) return { error: "Phiên đặt lại mật khẩu đã hết hạn. Hãy yêu cầu liên kết mới." };
  const { error } = await supabase.auth.updateUser({ password: form.data.password });
  if (error) return authError(error);
  (await cookies()).delete(recoveryCookie);
  // Keep the verified session usable if Auth is momentarily unavailable during sign-out.
  const signedOut = await supabase.auth.signOut({ scope: "local" });
  return { redirect: signedOut.error ? "/profile?password=updated" : "/login?notice=password-updated" };
}

export async function logout(): Promise<ActionResult> {
  if (!isSupabaseConfigured) return configurationError;
  const supabase = await createActionSupabase();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error && error.code !== "session_not_found") return authError(error);
  (await cookies()).delete(recoveryCookie);
  return { redirect: "/" };
}

export async function openShop(input: unknown): Promise<ActionResult> {
  if (!isSupabaseConfigured) return configurationError;
  const form = onboardingSchema.safeParse(input);
  if (!form.success) return invalid;
  const supabase = await createActionSupabase();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub || data.claims.is_anonymous === true) return { redirect: loginPath("/seller/onboarding") };
  const { name, slug, description, warehouseAddress, phone } = form.data;
  const { error } = await supabase.rpc("open_marketplace_shop", {
    shop_name: name, shop_slug: slug, shop_description: description,
    warehouse_address: warehouseAddress, warehouse_phone: phone,
  });
  if (!error) return { redirect: "/seller" };
  if (error.code === "23505") return { error: "Slug đã được sử dụng. Hãy chọn đường dẫn khác cho shop." };
  if (error.message === "SHOP_ALREADY_OPEN") return { error: "Tài khoản đã có cửa hàng. Hãy mở Kênh người bán để kiểm tra." };
  if (error.code === "42501") return { error: "Tài khoản hiện tại không có quyền đăng ký mở shop." };
  if (error.code === "22023") return invalid;
  return { error: "Chưa thể tạo cửa hàng. Vui lòng thử lại." };
}

export async function updateProfile(input: unknown): Promise<ActionResult> {
  if (!isSupabaseConfigured) return configurationError;
  const form = profileSchema.safeParse(input);
  if (!form.success) return invalid;
  const supabase = await createActionSupabase();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub || data.claims.is_anonymous === true) return { redirect: loginPath("/profile") };
  const { error } = await supabase.from("profiles").update({ display_name: form.data.name }).eq("id", data.claims.sub);
  return error ? { error: "Chưa thể cập nhật hồ sơ. Vui lòng thử lại." } : { message: "Đã cập nhật họ tên." };
}
