"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { AccountGate, useMarketAuth } from "@/components/market-shell";
import { Button } from "@/components/ui/button";
import { useMarketCart } from "@/features/cart/market-cart";
import { errorText, getSupabase, invoke } from "@/lib/marketplace";
import { RefundControls, RefundRequestForm } from "./refund-controls";
import { statusText, subOrderFields, type SubOrder } from "./order-types";
import { useT } from "@/components/preferences";

type BuyerOrder = { id: string; currency: string; payment_status: string; total_amount: number; expires_at: string | null;
  created_at: string; sub_orders: SubOrder[] };

function BuyerOrderList() {
  const t = useT();
  const { session } = useMarketAuth();
  const selected = useSearchParams().get("order");
  const removePurchased = useMarketCart((state) => state.removePurchased);
  const orders = useQuery({
    queryKey: ["buyer-orders", session?.user.id, selected],
    queryFn: async () => {
      const query = getSupabase().from("orders").select(`id,currency,payment_status,total_amount,expires_at,created_at,sub_orders(${subOrderFields})`)
        .eq("buyer_id", session!.user.id);
      const { data, error } = await (selected && /^[0-9a-f-]{36}$/i.test(selected) ? query.eq("id", selected) : query)
        .order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data as unknown as BuyerOrder[];
    },
    refetchInterval: (query) => query.state.data?.some((order) => order.payment_status === "pending") ? 5000 : false,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => invoke("process-refund", { action: "cancel_pending", order_id: id }),
    onSettled: () => { void orders.refetch(); },
  });
  useEffect(() => {
    for (const order of orders.data ?? []) {
      if (!["paid", "partially_refunded", "refunded"].includes(order.payment_status)) continue;
      const key = `market-order-${order.id}`;
      const value = sessionStorage.getItem(key);
      if (value) {
        sessionStorage.removeItem(key);
        removePurchased(JSON.parse(value) as Array<{ variant_id: string; quantity: number }>);
      }
    }
  }, [orders.data, removePurchased]);

  return <>
    <div className="market-page-heading"><h1>{t("Đơn hàng của bạn")}</h1>
      {selected && <Button asChild variant="outline"><Link href="/orders">{t("Xem tất cả đơn")}</Link></Button>}
    </div>
    {orders.isPending && <p role="status">{t("Đang tải đơn hàng…")}</p>}
    {orders.isError && <p role="alert">{t(errorText(orders.error))}</p>}
    {orders.data?.length === 0 && <p>{t("Chưa tìm thấy đơn hàng.")}</p>}
    <div className="market-stack">
      {orders.data?.map((order) => <section className="market-panel" key={order.id}>
        <h2>{t("Đơn") + " "}{order.id.slice(0, 8)} · {t(statusText(order.payment_status))}</h2>
        <p>{new Date(order.created_at).toLocaleString(t.intl)} · {t.money(order.total_amount, order.currency)}</p>
        {order.payment_status === "pending" && <>
          <p>{t("Đang chờ Stripe xác nhận")}{order.expires_at ? t(" · giữ hàng đến {0}", new Date(order.expires_at).toLocaleTimeString(t.intl)) : ""}.</p>
          <Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate(order.id)}>{t("Hủy phiên thanh toán")}</Button>
          {cancel.isError && cancel.variables === order.id && <p role="alert">{t(errorText(cancel.error))}</p>}
        </>}
        {order.sub_orders.map((sub) => <div className="sub-order-card" key={sub.id}>
          <h3>{sub.shops?.name ?? t("Cửa hàng")} · {t(statusText(sub.status))}</h3>
          <ul>{sub.order_items.map((item) => <li key={item.id}>{item.quantity} × {item.product_title}</li>)}</ul>
          {sub.tracking_number && <p>{t("Mã vận đơn") + " "}{sub.tracking_number}</p>}
          {sub.refunded_amount > 0 && <p>{t("Đã hoàn") + " "}{t.money(sub.refunded_amount, sub.currency)}</p>}
          {(["paid", "partially_refunded"].includes(order.payment_status)
            || (order.payment_status === "refunded" && sub.total_amount === 0)) && <RefundRequestForm order={sub} />}
          {sub.refund_requests.map((claim) => <RefundControls key={claim.id} claim={claim} currency={sub.currency} viewer="buyer" />)}
        </div>)}
      </section>)}
    </div>
  </>;
}

export function BuyerOrders() {
  return <AccountGate><BuyerOrderList /></AccountGate>;
}
