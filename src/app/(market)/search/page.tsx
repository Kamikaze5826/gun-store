import { Suspense } from "react";
import { SearchMarket } from "@/features/catalog/search-market";
import { getTranslator } from "@/lib/i18n/server";

export default async function SearchPage() {
  const t = await getTranslator();
  return <Suspense fallback={<p>{t("Đang tải danh mục…")}</p>}><SearchMarket /></Suspense>;
}
