import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AuthCard, UpdatePasswordForm } from "@/features/auth/forms";
import { canRecoverPassword } from "@/features/auth/recovery";
import { getTranslator } from "@/lib/i18n/server";

export default async function UpdatePasswordPage() {
  const t = await getTranslator();
  if (await canRecoverPassword()) return <UpdatePasswordForm />;
  return <AuthCard title={t("Đặt mật khẩu mới")} description={t("Mở liên kết đặt lại mật khẩu trong email để tiếp tục.")}>
    <Button asChild><Link href="/forgot-password">{t("Yêu cầu liên kết mới")}</Link></Button>
  </AuthCard>;
}
