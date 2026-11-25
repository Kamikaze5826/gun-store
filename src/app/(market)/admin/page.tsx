import { redirect } from "next/navigation";
import { requireViewer } from "@/features/auth/identity";
import { AdminDisputes } from "@/features/seller/seller-market";
import { getTranslator } from "@/lib/i18n/server";

export default async function AdminPage() {
  const t = await getTranslator();
  const viewer = await requireViewer("/admin");
  if (!viewer) return null;
  if (viewer.role !== "admin") redirect("/");
  return <><div className="market-page-heading"><h1>{t("Quản trị marketplace")}</h1></div><AdminDisputes /></>;
}
