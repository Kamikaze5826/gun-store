import { Suspense } from "react";
import { CheckoutMarket } from "@/features/cart/checkout-market";
import { requireViewer } from "@/features/auth/identity";
import { getTranslator } from "@/lib/i18n/server";

export default async function CheckoutPage() {
  const t = await getTranslator();
  await requireViewer("/checkout");
  return <Suspense fallback={<p>{t("Đang tải thanh toán…")}</p>}><CheckoutMarket /></Suspense>;
}
