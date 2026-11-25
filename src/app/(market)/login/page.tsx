import { redirect } from "next/navigation";
import { LoginForm } from "@/features/auth/forms";
import { getViewer } from "@/features/auth/identity";
import { safeRedirect } from "@/features/auth/redirects";

const notices: Record<string, string> = {
  "password-updated": "Đã đổi mật khẩu. Hãy đăng nhập bằng mật khẩu mới.",
  "oauth-failed": "Chưa thể hoàn tất đăng nhập bằng Google. Vui lòng thử lại.",
  "link-expired": "Liên kết xác nhận không hợp lệ, đã hết hạn hoặc đã được sử dụng.",
};

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ redirect?: string | string[]; notice?: string | string[] }>;
}) {
  const query = await searchParams;
  const destination = safeRedirect(typeof query.redirect === "string" ? query.redirect : undefined);
  if (await getViewer()) redirect(destination);
  const notice = typeof query.notice === "string" && Object.hasOwn(notices, query.notice) ? notices[query.notice] : undefined;
  return <LoginForm destination={destination} notice={notice} />;
}
