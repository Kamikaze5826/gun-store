import { Suspense } from "react";
import { BuyerOrders } from "@/features/orders/buyer-orders";
import { requireViewer } from "@/features/auth/identity";
import { getTranslator } from "@/lib/i18n/server";

export default async function OrdersPage() {
  const t = await getTranslator();
  await requireViewer("/orders");
  return <Suspense fallback={<p>{t("Đang tải đơn hàng…")}</p>}><BuyerOrders /></Suspense>;
}
