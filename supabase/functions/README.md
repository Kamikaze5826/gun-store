# Supabase Edge Functions

| Function | Hành vi |
| --- | --- |
| `create-checkout-session` | Xác thực JWT qua Supabase Auth, gọi hàm tính giá, khóa voucher và biến thể theo thứ tự, rồi giữ hàng và tạo đơn trong cùng giao dịch. Trả HTTP 409 với `details.shortages` nếu thiếu hàng. Dùng `request_id` của lần thử để gọi lại an toàn. |
| `stripe-webhook` | Xác minh chữ ký trên body nguyên bản. Đối chiếu đơn, phiên Stripe, tiền tệ và số tiền. Sau thanh toán, cập nhật đơn, trừ cả hai cột tồn kho và ghi lượt dùng voucher trong cùng giao dịch. Webhook trùng có thể chạy lại. |
| `place-bid` | Xác thực JWT và gọi RPC với quyền của người dùng. Giá đầu có thể bằng giá mở đầu. Từ lượt tiếp theo, giá phải lớn hơn giá hiện tại cộng bước giá. PostgreSQL khóa sản phẩm và dùng thời gian sau khi lấy khóa. |
| `process-refund` | Hủy phiên chưa trả tiền khi người mua sở hữu đơn. Duyệt hoàn tiền với quyền seller sở hữu shop hoặc admin xử lý tranh chấp. Stripe idempotency key theo yêu cầu và lượt xử lý. Tồn kho được trả đúng một lần khi Stripe xác nhận hủy trước giao. |
| `reconcile-checkout` | Nhận yêu cầu từ cron qua bí mật riêng trong Vault. Đóng phiên Stripe còn mở của đơn đã hết hạn hoặc bị hủy. Nếu Stripe đã thu tiền mà đơn không thể xác nhận, ghi nhận hoàn tiền tự động. |

CORS cho phép origin của `APP_URL`. Các hàm người dùng xác thực Bearer JWT bằng `getUser()`. Endpoint webhook dùng `Stripe-Signature` và endpoint cron dùng `X-Marketplace-Maintenance`. [Supabase Edge Function auth](https://supabase.com/docs/guides/functions/auth)

## Gọi từ Supabase Client

Từ frontend đã đăng nhập, dùng cùng payload để xem giá và tạo phiên:

```ts
const input = {
  cart_items: [{ variant_id: variantId, quantity: 2 }],
  shipping_address: {
    recipient: "Nguyễn An", phone: "0900000000", address_line: "Địa chỉ giao hàng",
    country_code: "VN", region_code: "VN-SG",
  },
  shop_voucher_codes: { [shopId]: "SHOP10" },
  platform_voucher_code: "SAN20",
};

const { data: preview, error: previewError } = await supabase.rpc("calculate_order_preview", input);
if (previewError) throw previewError;

const { data: checkout, error: checkoutError } = await supabase.functions.invoke("create-checkout-session", {
  body: { ...input, request_id: requestId, expected_total: preview.total, expected_currency: preview.currency },
});
if (checkoutError) throw checkoutError;
window.location.assign(checkout.url);
```

`requestId` là UUID duy nhất của lần thanh toán. Nếu mất kết nối hoặc chưa nhận được kết quả, dùng lại UUID với cùng payload. Khóa này ánh xạ đến đơn và Stripe session. Mỗi phần tử lỗi 409 cho biết `variant_id`, `requested_quantity`, `available_stock` và tên sản phẩm nếu còn công khai. HTTP 409 cũng có thể báo giá đã thay đổi, phiên đã đóng hoặc cần thử lại giao dịch. Client đọc `code` để phân biệt.

Chỉ Edge Function hoặc worker dùng service role được gọi ba RPC tồn kho. Ví dụ:

```ts
const hold = await service.rpc("reserve_inventory", {
  buyer: authenticatedUserId, request_id: requestId, ...input, expected_quote: preview,
});
if (hold.error) throw hold.error;
if (!hold.data.ok) return hold.data; // Khối gọi Edge trả HTTP 409 khi thiếu hàng.

const confirmation = await service.rpc("confirm_inventory_deduction", {
  order_id: hold.data.order_id, checkout_session_id: session.id,
  payment_intent_id: paymentIntent.id, charge_id: chargeId,
  amount: session.amount_total, currency: session.currency,
});
if (confirmation.error) throw confirmation.error;

const release = await service.rpc("release_expired_inventory", {
  target_order: hold.data.order_id, release_reason: "cancelled",
});
if (release.error) throw release.error;
```

Xác nhận chỉ được gọi từ sự kiện Stripe đã xác thực. Nhả hàng bằng `cancelled` chỉ sau khi đã kiểm tra quyền hủy và trạng thái Stripe của phiên. Cron gọi `release_expired_inventory()` để nhả các đơn đã quá thời hạn. Lượt voucher đang giữ được nhả cùng tồn kho.

## Chạy và khai báo webhook

1. Sao chép `.env.example` trong thư mục này thành `.env.local`. Đặt `APP_URL`, Stripe test secret key và webhook signing secret.
2. Chạy `supabase functions serve --env-file supabase/functions/.env.local`. Dùng `stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook` để chuyển webhook Stripe test tới bản local. Khi chạy hosted, đặt biến môi trường bằng Supabase Secrets và triển khai các function trong bảng trên.
3. Đăng ký các sự kiện `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `payment_intent.payment_failed`, `refund.created`, `refund.updated` và `refund.failed`.
4. Để tự đóng phiên Stripe ngay sau khi database nhả hàng, đặt cùng một chuỗi bí mật dài ít nhất 32 byte vào Edge secret `MARKETPLACE_MAINTENANCE_SECRET` và mục Vault `marketplace_maintenance_secret`. Đặt mục Vault `marketplace_project_url` bằng URL gateway Supabase mà PostgreSQL truy cập được.

Database giữ kho 15 phút. Checkout của Stripe yêu cầu thời hạn cấu hình ít nhất 30 phút. Job đối soát sẽ đóng phiên Stripe còn mở sau khi hết giữ chỗ. Nếu webhook báo đã thu tiền sau khi giữ chỗ hết hiệu lực, hệ thống không giao hàng và tạo khoản hoàn tiền toàn phần. Khoản hoàn tiền Stripe đang xử lý vẫn có thể ở trạng thái chờ. [Stripe Checkout expiration](https://docs.stripe.com/api/checkout/sessions/create#checkout_session_create-expires_at) · [Stripe Refunds](https://docs.stripe.com/refunds) · [Supabase Cron và Vault](https://supabase.com/docs/guides/functions/schedule-functions)

Checkout tạo charge trên tài khoản nền tảng và gắn `transfer_group` theo đơn tổng. Cấu hình onboarding và chuyển tiền tự động cho các tài khoản Stripe Connect thuộc bước tích hợp payout. [Stripe Separate Charges and Transfers](https://docs.stripe.com/connect/separate-charges-and-transfers)
