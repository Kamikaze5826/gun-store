import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AuthCard, ProfileForm } from "@/features/auth/forms";
import { requireViewer } from "@/features/auth/identity";
import { getTranslator } from "@/lib/i18n/server";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ password?: string }> }) {
  const t = await getTranslator();
  const viewer = await requireViewer("/profile");
  if (!viewer) return null;
  const updated = (await searchParams).password === "updated";
  return <AuthCard title={t("Hồ sơ cá nhân")} description={viewer.email}
    footer={viewer.role === "buyer" ? <Button asChild variant="outline"><Link href="/seller/onboarding">{t("Mở cửa hàng")}</Link></Button> : undefined}>
    {updated && <p role="status">{t("Đã cập nhật mật khẩu.")}</p>}
    <ProfileForm key={viewer.id} name={viewer.displayName} />
  </AuthCard>;
}
