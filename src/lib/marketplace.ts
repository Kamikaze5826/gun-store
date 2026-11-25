"use client";

import { FunctionsHttpError } from "@supabase/supabase-js";
import { createBrowserSupabase } from "@/utils/supabase/client";
export { isSupabaseConfigured as marketConfigured } from "@/utils/supabase/config";

export const getSupabase = createBrowserSupabase;

export class MarketError extends Error {
  constructor(public code: string, public status?: number, public details?: unknown) { super(code); }
}

export async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(name, args);
  if (error) throw new MarketError(/^[A-Z][A-Z_]+$/.test(error.message) ? error.message : error.code);
  return data as T;
}

export async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke<T>(name, { body });
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    const payload = await response.json().catch(() => null) as { code?: string; details?: unknown } | null;
    throw new MarketError(payload?.code ?? "EDGE_ERROR", response.status, payload?.details);
  }
  if (error || data === null) throw new MarketError("EDGE_UNAVAILABLE");
  return data;
}

const messages: Record<string, string> = {
  AUTH_REQUIRED: "Vui lòng đăng nhập để tiếp tục.",
  INVALID_INPUT: "Kiểm tra lại thông tin đã nhập.",
  INVALID_SHIPPING_ADDRESS: "Địa chỉ giao hàng chưa hợp lệ.",
  INVALID_VOUCHER_CODES: "Định dạng mã giảm giá chưa hợp lệ.",
  VOUCHER_UNAVAILABLE: "Có mã giảm giá không hợp lệ, đã hết lượt hoặc chưa đạt giá trị tối thiểu.",
  VOUCHER_SHOP_NOT_IN_CART: "Có mã giảm giá thuộc cửa hàng ngoài giỏ hàng.",
  SHIPPING_RATE_UNAVAILABLE: "Chưa có mức phí vận chuyển phù hợp với khu vực và cân nặng.",
  MISSING_PRODUCT_WEIGHT: "Có sản phẩm chưa được cửa hàng cập nhật cân nặng.",
  MIXED_CURRENCY: "Vui lòng thanh toán riêng cho từng loại tiền tệ.",
  PRODUCT_UNAVAILABLE: "Có sản phẩm đã ngừng bán.",
  INSUFFICIENT_STOCK: "Số lượng trong giỏ đã được cập nhật theo tồn kho hiện tại.",
  PRICE_CHANGED: "Giá hoặc phí vận chuyển vừa thay đổi. Vui lòng xem lại đơn.",
  CHECKOUT_CLOSED: "Phiên thanh toán đã đóng. Bạn có thể tạo phiên mới.",
  CHECKOUT_PROVIDER_UNAVAILABLE: "Thanh toán Stripe chưa sẵn sàng. Bạn có thể thử đặt hàng mô phỏng từ trang chủ.",
  ORDER_ALREADY_PAID: "Đơn đã thanh toán. Hãy gửi yêu cầu hủy ở trang đơn hàng.",
  CHECKOUT_ALREADY_COMPLETED: "Phiên thanh toán đã hoàn tất. Kiểm tra trang đơn hàng.",
  TOO_MANY_CHECKOUTS: "Bạn có nhiều phiên thanh toán đang mở. Hãy hoàn tất hoặc hủy một phiên.",
  BID_REJECTED: "Mức đặt giá chưa đủ hoặc phiên đấu giá đã kết thúc.",
  BID_FORBIDDEN: "Tài khoản của bạn không thể đặt giá cho sản phẩm này.",
  REFUND_APPROVAL_FORBIDDEN: "Bạn không có quyền duyệt yêu cầu này.",
  INVALID_REFUND_TRANSITION: "Yêu cầu đã đổi trạng thái hoặc bạn không có quyền thực hiện thao tác.",
  ORDER_ALREADY_SHIPPED_OR_REFUNDED: "Đơn đã giao vận hoặc đã được hoàn tiền.",
  ORDER_NOT_REFUNDABLE: "Đơn này hiện không đủ điều kiện hoàn tiền.",
  INVALID_REFUND_AMOUNT: "Số tiền hoàn vượt quá số dư có thể hoàn.",
  INVALID_EVIDENCE: "Chọn tối đa 5 tệp ảnh hoặc video hợp lệ, mỗi tệp không quá 20 MB.",
  INVALID_PRODUCT_IMAGE: "Chọn tối đa 8 ảnh JPEG, PNG hoặc WebP, mỗi ảnh không quá 8 MB.",
  FULFILLMENT_TRANSITION_FORBIDDEN: "Không thể chuyển trạng thái. Kiểm tra mã vận đơn và yêu cầu hủy đang mở.",
  VARIANT_CHANGED_OR_FORBIDDEN: "Tồn kho vừa thay đổi. Tải lại biểu mẫu trước khi điều chỉnh.",
  "23514": "Dữ liệu vi phạm giới hạn cho phép, ví dụ tồn kho thấp hơn số hàng đang giữ.",
  "23505": "Dữ liệu bị trùng. Kiểm tra SKU, slug hoặc yêu cầu đang mở.",
};

export function errorText(error: unknown) {
  if (error instanceof MarketError) return messages[error.code] ?? "Không thể thực hiện thao tác. Vui lòng thử lại.";
  return "Không thể tải hoặc lưu dữ liệu. Vui lòng thử lại.";
}

export function mediaUrl(path: string) {
  return getSupabase().storage.from("product-media").getPublicUrl(path).data.publicUrl;
}

export function imageExtension(type: string) {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "video/mp4": "mp4", "video/webm": "webm" } as Record<string, string>)[type];
}
