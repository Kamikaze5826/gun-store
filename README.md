# Gun Store

Cửa hàng có 36 mẫu trưng bày thuộc 7 nhóm: súng trường, súng ngắn, shotgun, dáng gọn, phù điêu cỡ lớn, sa bàn bom/lựu đạn và phụ kiện tiểu cảnh. Ảnh trong `images/` được dùng làm ảnh tham chiếu cho hình dáng. Trang chủ có danh mục, tìm kiếm, sắp xếp giá, xem chi tiết và giỏ hàng.

## Chạy giao diện

Yêu cầu Node.js 22 trở lên.

### Chạy bản local có tài khoản admin

Trong PowerShell tại thư mục dự án, mở Docker Desktop rồi chạy:

```powershell
npm.cmd ci
supabase.cmd start
supabase.cmd migration up --local
npm.cmd run setup:admin
npm.cmd run setup:models
npm.cmd run dev -- --hostname 127.0.0.1
```

Mở [localhost:3000/login](http://localhost:3000/login) và nhập tên đăng nhập `admin`, mật khẩu `admin`. Đăng nhập xong, mở [trang quản trị](http://localhost:3000/admin). Lệnh `setup:admin` tạo tài khoản thử trong Supabase local và điền cấu hình công khai vào `.env.local`. Tài khoản này dùng cho thử nghiệm trên loopback.

`setup:models` thêm các nhóm, ảnh, giá và tồn kho mẫu vào Supabase local. Dùng [trang chủ](http://localhost:3000) để duyệt danh mục hoặc mở [chế độ đặt thử](http://localhost:3000/?mode=demo) để hoàn thành một đơn mô phỏng trong giỏ hàng. Luồng thanh toán qua Stripe cần cấu hình test key theo [hướng dẫn Edge Functions](supabase/functions/README.md).

Nếu repo đã cài thư viện và stack Supabase đang chạy, lần mở tiếp theo chỉ cần `npm.cmd run dev -- --hostname 127.0.0.1`. Khi Docker hoặc stack đã dừng, chạy lại `supabase.cmd start` trước.

### Chạy giao diện mẫu

```sh
npm ci
npm run dev
```

Mở [localhost:3000](http://localhost:3000). Khi chạy với Supabase, sao chép `.env.example` thành `.env.local` và điền URL cùng publishable key, hoặc để `setup:admin` tạo cấu hình local. Trang chủ dùng tồn kho và giá Supabase sau khi chạy `setup:models`. Danh mục mẫu và giỏ đặt thử hoạt động độc lập.

Giá mẫu hiện từ 69.000 đến 229.000 đồng. Mức giá được ước lượng từ các mô hình giấy và đồ trang trí thủ công có giá niêm yết công khai. [Danh mục mô hình giấy TAYTA](https://tayta.com.vn/mo-hinh-lap-rap-3d)

| Route | Chức năng |
| --- | --- |
| `/search` | Tìm kiếm debounce, lọc qua URL theo danh mục, giá và sao |
| `/products/[slug]` | Biến thể và đấu giá cập nhật qua Realtime, giới hạn số lượng theo tồn khả dụng |
| `/cart`, `/checkout` | Giỏ theo shop, voucher hai tầng, báo phí giao hàng và điều chỉnh số lượng khi nhận 409 |
| `/orders` | Theo dõi thanh toán, hủy phiên chưa trả tiền, yêu cầu trả hàng và trao đổi tranh chấp |
| `/seller`, `/seller/onboarding` | Kênh người bán và đăng ký mở shop cho tài khoản buyer |
| `/admin` | Quản trị tranh chấp, yêu cầu vai trò admin |
| `/login`, `/register`, `/profile` | Đăng nhập, xác nhận đăng ký bằng email và quản lý hồ sơ |
| `/forgot-password`, `/update-password` | Gửi liên kết qua email và đặt mật khẩu mới |
| `/account` | Chuyển đến hồ sơ hoặc đăng nhập từ liên kết cũ |

```sh
npm run typecheck
npm run build
npm run test:db
```

Kiểm thử SQL dùng PostgreSQL nhúng (PGlite) với schema Auth, Storage và đăng ký Cron mô phỏng. Suite áp dụng các migration và kiểm tra kho, voucher, thanh toán trùng, hoàn tiền, tìm kiếm và RLS. Để kiểm tra Deno strict, chạy `deno check --config supabase/functions/deno.json supabase/functions/*/index.ts` từ shell hỗ trợ mở rộng glob hoặc truyền từng tệp `index.ts`.

## Cấu trúc thư mục

Trên thanh đầu trang, chọn **Tiếng Việt / English** và bấm nút **Sáng / Tối** để đổi giao diện. Lựa chọn được lưu trong trình duyệt và áp dụng khi tải lại. Giao diện dịch các nhãn, trạng thái và thông báo của sàn. Tên và mô tả do cửa hàng nhập được hiển thị như đã lưu.

```text
src/
├── app/                              # Next.js App Router, layout, route và CSS toàn cục
├── components/ui/                    # Component Shadcn/UI dùng chung
├── features/
│   ├── catalog/                      # Tìm kiếm, biến thể và đấu giá live
│   ├── cart/                         # Zustand, giỏ hàng và checkout
│   ├── orders/                       # Đơn hàng, yêu cầu hoàn tiền và trao đổi
│   └── seller/                       # Dashboard người bán
└── lib/                              # Tiện ích dùng chung
public/marketplace/                   # Ảnh minh họa
supabase/
├── config.toml
├── migrations/                       # Schema, index, hàm SQL, trigger và RLS
├── functions/                        # Edge Functions Deno/TypeScript và hướng dẫn triển khai
├── seed.sql                          # Khu vực giao hàng và danh mục mẫu local
└── tests/                            # Kiểm thử migration và RLS
images/                               # Ảnh gốc dùng làm tham chiếu cho danh mục
```

TanStack Query quản lý dữ liệu API. Zustand giữ giỏ hàng và mã giảm giá cục bộ. Next.js đặt các route Supabase trong nhóm `(market)`.

## Xác thực SSR và mở shop

Sao chép `.env.example` thành `.env.local`. Điền URL, publishable key và `APP_URL` của website. Dùng cùng một origin để mở frontend và nhận liên kết Auth. Mặc định local là `http://localhost:3000`. Trên production, đặt `APP_URL` bằng origin HTTPS thật và giữ service role key phía backend.

- Middleware ở gốc làm mới cookie bằng `getClaims()`. Thông tin vai trò lấy từ `profiles`. Route riêng tư giữ đường dẫn và query khi chuyển về `/login`. Phía máy chủ kiểm tra lại bằng session đã xác thực khi render các trang liên quan. [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- Supabase local bật xác nhận email. Xem thư đăng ký và đặt lại mật khẩu ở Mailpit tại `http://127.0.0.1:54324`. Trên hosted, bật xác nhận email, cấu hình SMTP nếu gửi cho khách và cập nhật hai email template từ `supabase/templates`. Đặt Site URL trùng `APP_URL` và thêm hai URL `/auth/callback` và `/auth/confirm` của website vào Redirect URLs. [Supabase Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- Để dùng Google, bật Google provider của Supabase và nhập OAuth Client ID, Client Secret. Trong Google Cloud Console, dùng callback của Supabase trong phần Authorized redirect URIs. Trang đích của app là `APP_URL/auth/callback`, nơi Next.js đổi code PKCE lấy session. [Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google)
- Form mở shop gọi Server Action, sau đó RPC `open_marketplace_shop` tạo shop, lưu thông tin kho riêng tư và đổi `buyer` thành `seller` trong một giao dịch. Shop bắt đầu ở trạng thái `pending` theo luồng duyệt hiện có. Seller có thể chuẩn bị sản phẩm trong dashboard khi chờ duyệt.

Khi cần thử Google với Supabase local, thêm `http://127.0.0.1:54321/auth/v1/callback` vào Authorized redirect URIs của OAuth client. Cấu hình phần sau trong `supabase/config.toml` rồi khởi động lại stack với thông tin Google đã cấp:

```toml
[auth.external.google]
enabled = true
client_id = "env(MARKETPLACE_GOOGLE_CLIENT_ID)"
secret = "env(MARKETPLACE_GOOGLE_CLIENT_SECRET)"
```

## Áp dụng migration

Trong môi trường local có Docker và Supabase CLI:

```sh
supabase start
supabase migration up --local
```

Để áp dụng lên một dự án Supabase mới từ máy đã đăng nhập CLI:

```sh
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Trigger tạo profile có quyền `buyer` khi Supabase Auth tạo người dùng và bổ sung profile cho người dùng đã tồn tại. Chỉ chạy cấp quyền từ một phiên SQL quản trị đáng tin cậy. Ví dụ parametrized SQL sau nhận role và UUID của người dùng đã đăng ký:

```sql
prepare marketplace_assign_role (public.marketplace_role, uuid) as
  update public.profiles set role = $1 where id = $2;
```

Truyền `seller` hoặc `admin` và UUID thật khi thực thi. Vai trò được đọc từ `profiles` và quyền cập nhật cột `role` thuộc phía quản trị. Shop tạo từ dashboard ở trạng thái `pending`. Admin có thể duyệt bằng quyền SQL hiện có hoặc qua Data API với JWT admin, bằng cách cập nhật `shops.status = 'active'`. [Supabase Auth user management](https://supabase.com/docs/guides/auth/managing-user-data)

### Quyền truy cập

| Vai trò | Danh mục và đánh giá | Đơn hàng và đấu giá |
| --- | --- | --- |
| Khách | Đọc danh mục, shop và sản phẩm đang hoạt động, biến thể đang bật và đánh giá công khai | Xem giá hiện tại trên sản phẩm đấu giá |
| Buyer | Sửa thông tin hiển thị của mình. Tạo đánh giá cho từng dòng hàng đã thanh toán và giao, sửa hoặc xóa đánh giá của mình | Xem đơn và lượt đặt giá của mình. Đặt giá qua RPC `place_bid` |
| Seller | Có quyền mua như buyer. Tạo shop ở trạng thái chờ duyệt và quản lý nội dung shop, sản phẩm và biến thể thuộc mình | Xem đơn con đã thanh toán thuộc shop của mình. Có thể đặt giá ở shop khác |
| Admin | Đọc hồ sơ và dữ liệu danh mục, quản lý cây danh mục, duyệt hoặc đình chỉ shop, quản lý sản phẩm và xóa đánh giá | Xem toàn bộ đơn và lượt đặt giá |
| Backend tin cậy | Quản lý vai trò và dữ liệu Stripe riêng tư | Tạo đơn, ghi trạng thái thanh toán, giao hàng và chuyển tiền |

Quyền trên hàng kết hợp với quyền trên cột để người dùng chỉ ghi được các trường phù hợp. Lưu khóa backend ở phía máy chủ. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)

### Quy ước dữ liệu

- Giá dùng số nguyên theo đơn vị nhỏ nhất của tiền tệ. Ví dụ `500000` tương ứng 500.000 VND. Mỗi đơn tổng dùng một loại tiền.
- Mỗi shop trong một đơn tổng có một đơn con. Khóa ngoại ghép giữ nhất quán shop, tiền tệ, sản phẩm và biến thể. Dòng đơn giữ tên, SKU, biến thể và giá tại thời điểm mua.
- SKU không phân biệt hoa thường và duy nhất toàn sàn. Bỏ trống size hoặc màu bằng chuỗi rỗng. Cân nặng dùng gram, kích thước dùng milimét.
- Rating tính từ tổng điểm và số lượt đánh giá đã xác minh. Mỗi thao tác thêm, đổi sao hoặc xóa đánh giá cập nhật sản phẩm và shop trong cùng giao dịch.
- Full-text search dùng cấu hình PostgreSQL `simple`, ưu tiên tiêu đề và có chỉ mục GIN. Truy vấn SQL giữ dấu tiếng Việt. Tìm kiếm bỏ dấu của giao diện demo chạy ở trình duyệt.
- Cột `available_stock` bằng tồn vật lý trừ số giữ chỗ. Giao dịch checkout tự tính lại giá, kiểm tra cả giỏ trước khi ghi đơn và giữ đồng thời số lượt voucher. Jobs chạy mỗi phút để nhả kho và đưa các phiên Stripe đã hết hạn vào đối soát.
- Phí ship dùng ngưỡng cân nặng nhỏ nhất còn bao phủ tổng gram của mỗi shop, theo quốc gia, khu vực và tiền tệ. Cần có cân nặng của mọi biến thể bán và mức phí phù hợp. Admin cấu hình `shipping_rates`. Mã shop giảm trên tiền hàng của shop. Mã sàn giảm sau mã shop và phí ship, rồi được phân bổ chính xác xuống đơn con.
- Đấu giá khóa dòng sản phẩm, kiểm tra thời gian, mức giá và quyền của người đặt. Sau lượt đầu tiên, giá mới phải lớn hơn giá hiện tại cộng bước giá. Các điều khoản đã có lượt giá được khóa. Chốt người thắng và checkout người thắng cần quy trình riêng.
- Bằng chứng trả hàng lưu trong bucket riêng tư. Buyer, seller của shop và admin dùng URL ký thời hạn ngắn. Cột `refund_state` theo dõi hoàn một phần hoặc toàn phần theo đơn con.

Ví dụ tra cứu catalog bằng cơ chế full-text search:

```sql
with search as (
  select websearch_to_tsquery('pg_catalog.simple', 'bàn phím') as query
)
select p.id, p.title, p.rating_average
from public.products p cross join search
where p.status = 'active' and p.search_vector @@ search.query
order by ts_rank(p.search_vector, search.query) desc, p.id
limit 24;
```

Xem [Edge Functions và ví dụ gọi RPC](supabase/functions/README.md) để cấu hình Stripe, webhook và đối soát.
