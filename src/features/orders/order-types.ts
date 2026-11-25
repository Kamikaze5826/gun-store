export type Refund = {
  id: string; sub_order_id: string; kind: "cancel_before_shipping" | "return";
  reason: string; evidence_urls: string[]; refund_amount: number;
  status: "requested" | "seller_approved" | "seller_rejected" | "disputed" | "admin_resolved" | "refunded";
  settlement_status: "pending" | "failed" | "succeeded" | "denied" | null;
};
export type SubOrder = {
  id: string; order_id: string; currency: string; total_amount: number; refunded_amount: number;
  status: "pending" | "processing" | "shipped" | "delivered" | "cancelled"; tracking_number: string | null;
  shipping_address: { recipient?: string; phone?: string; address_line?: string; region_code?: string; country_code?: string; postal_code?: string } | null;
  shops: { name: string } | null;
  order_items: { id: string; product_title: string; quantity: number }[];
  refund_requests: Refund[];
};
export const subOrderFields = "id,order_id,currency,total_amount,refunded_amount,status,tracking_number,shipping_address,shops(name),order_items(id,product_title,quantity),refund_requests(id,sub_order_id,kind,reason,evidence_urls,refund_amount,status,settlement_status)";

const orderStatuses: Record<string, string> = {
  pending: "Đang chờ", processing: "Đang chuẩn bị", shipped: "Đang giao", delivered: "Đã giao",
  cancelled: "Đã hủy", paid: "Đã thanh toán", failed: "Thanh toán lỗi",
  partially_refunded: "Đã hoàn một phần", refunded: "Đã hoàn tiền",
  requested: "Đã gửi yêu cầu", seller_approved: "Shop đã duyệt", seller_rejected: "Shop từ chối",
  disputed: "Đang tranh chấp", admin_resolved: "Admin đã xử lý",
};
export const statusText = (status: string) => orderStatuses[status] ?? status;
