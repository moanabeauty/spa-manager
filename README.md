# Moana Spa Manager

Web app quản lý Moana Spa (2 chi nhánh: 67 Lưu Quang Vũ và 109 Nguyễn Sơn, Hà Nội).

- Cơ sở dữ liệu: Supabase (project `spa-manager`, khu vực Singapore)
- Giao diện: Next.js 15 + Tailwind (thư mục `src/`)
- Hosting: Vercel

## Cơ sở dữ liệu (`supabase/migrations`)

| Khu | Bảng chính |
|---|---|
| Vận hành | `branches`, `profiles` (vai trò), `customers`, `services`, `appointments`, `appointment_services` |
| Bán hàng | `packages` (combo/liệu trình), `customer_packages`, `service_cards` + `card_transactions` (thẻ tài khoản), `promotions`, `invoices`, `invoice_items`, `payments` |
| Hoa hồng | `invoice_item_sellers` (chia doanh số cho nhiều KTV), `commission_tiers` (3% < 30tr, 5% từ 30tr), `commission_item_types` |
| Kho | `warehouses` (mỗi chi nhánh: kho bán lẻ + kho liệu trình), `products`, `stock_requests` (KTV yêu cầu xuất), `stock_movements` |

Báo cáo (view): `staff_monthly_commissions`, `technician_monthly_fees`, `service_card_balances`, `stock_levels`, `invoice_totals`.

### Quy tắc tự động
- Chốt hoá đơn (`status = 'paid'`) phải đủ tiền; tự tạo gói cho khách, tự nạp thẻ + tiền tặng theo mức, tự trừ kho bán lẻ.
- Hoa hồng: dịch vụ lẻ, sản phẩm, combo, nạp thẻ đều tính doanh số; trừ gội đầu (`commission_eligible = false`) và dòng hoá đơn trả bằng thẻ (`paid_with_card`). Buổi trừ từ gói combo không có hoá đơn nên không tính. Doanh số tháng ≥ 30tr thì cả tháng 5%.
- Danh mục dịch vụ nhập từ sheet Menu (103 dịch vụ, 18 nhóm). Thời lượng và tiền dịch vụ KTV chưa có, đang tạm 60 phút / 0đ.
- Thẻ tài khoản không trả được cho dịch vụ có `card_allowed = false` (BAP, filler, botox, hifu, căng cấy chỉ).
- Lịch hẹn hoàn thành thì trừ buổi trong gói; một KTV không thể bị xếp 2 lịch trùng giờ.
- Phiếu yêu cầu xuất kho chỉ quản lý kho duyệt; không cho xuất quá tồn.

### Vai trò
`owner` (chủ), `manager`, `receptionist`, `technician` (KTV), `warehouse` (quản lý kho), `customer`.
Tài khoản mới đăng ký mặc định là `customer`; chủ spa cấp vai trò + chi nhánh ở trang **Quản lý → Nhân viên**.

## Giao diện web (giai đoạn 2)

| Trang | Ai dùng | Việc |
|---|---|---|
| `/dang-nhap` | mọi người | Đăng nhập, đăng ký (họ tên, SĐT, email, mật khẩu), quên mật khẩu |
| `/dat-lich` | khách | Chọn chi nhánh → dịch vụ (tối đa 5) → ngày giờ → ghi chú, gửi lịch "chờ xác nhận" |
| `/lich-hen` | khách | Lịch sắp tới + lịch sử, huỷ lịch còn chờ xác nhận |
| `/quan-ly` | nhân viên | Lịch theo ngày + chi nhánh; Xác nhận / Khách đã đến / Hoàn thành / Không đến / Huỷ |

Giờ nhận đặt online, bước giờ, đặt trước tối thiểu: sửa trong `src/lib/config.ts` (đang để 9:00–19:30, 30 phút/suất, trước ≥ 60 phút).
Đăng ký online với SĐT trùng khách cũ sẽ **không** tự nối hồ sơ (tránh mạo danh); lễ tân thấy ghi chú trên lịch hẹn để kiểm tra.

## Giai đoạn 3: công cụ lễ tân và chủ spa

| Trang | Ai dùng | Việc |
|---|---|---|
| `/quan-ly/tao-lich` | chủ, quản lý, lễ tân, KTV | Tạo lịch cho khách gọi điện (đã xác nhận) hoặc khách vãng lai (đang làm). Gõ SĐT để tìm khách, chưa có thì nhập tên để tạo hồ sơ. Chọn dịch vụ (làm lần lượt), xếp KTV cho từng dịch vụ |
| `/quan-ly` | nhân viên | Thêm ô chọn KTV cho từng dịch vụ trong lịch; KTV đang bận hiện chữ "(bận)" |
| `/quan-ly/nhan-vien` | chủ spa | Danh sách tài khoản (tên, email, SĐT), cấp vai trò (lễ tân, KTV, kho, quản lý) + chi nhánh, khoá / mở tài khoản |
| `/quan-ly/dich-vu` | chủ, quản lý | Sửa thời lượng, giá, tiền dịch vụ KTV ngay trên danh sách rồi lưu một lần; mở "chi tiết" để sửa tên, nhóm, giá thành viên, chi nhánh, cho trả thẻ, tính hoa hồng, ngừng dịch vụ; thêm dịch vụ mới |

Cơ sở dữ liệu (`20261103000009_front_desk_tools.sql`):
- `create_staff_booking(...)`: tạo khách (nếu mới) + lịch + dịch vụ trong 1 bước, SĐT được chuẩn hoá (`+84 912…` → `0912…`).
- Trigger `appointment_services_tech_check`: chỉ xếp được tài khoản KTV / quản lý / chủ đang hoạt động; trùng giờ thì báo rõ tên KTV và khung giờ bị trùng.
- `list_accounts()`, `set_user_role()`, `set_user_active()`: chỉ chủ spa; không tự đổi vai trò / tự khoá mình, không cấp quyền chủ qua giao diện; lễ tân / KTV / kho bắt buộc có chi nhánh.

## Giai đoạn 4: thu tiền tại quầy

| Trang | Ai dùng | Việc |
|---|---|---|
| `/quan-ly` → nút **Thu tiền** | lễ tân, quản lý, chủ | Mở hoá đơn từ dịch vụ trong lịch; lịch đã thu hiện "✓ Đã thanh toán" + mã hoá đơn |
| `/quan-ly/thu-tien` | lễ tân, quản lý, chủ | Từng dòng: giá thường / giá thành viên, giảm giá, trả bằng thẻ tài khoản, **trừ buổi gói**, chia doanh số (%) cho 1 hay nhiều nhân viên. Giảm cả hoá đơn (đ hoặc %). Thu kết hợp tiền mặt + chuyển khoản + POS + thẻ; tính tiền thừa trả khách. Thêm dịch vụ khách làm thêm (chọn KTV), bỏ dịch vụ khách không làm. Không theo lịch: bán gói combo, nạp thẻ, thu lẻ |
| `/quan-ly/hoa-don` | lễ tân, quản lý, chủ | Hoá đơn trong ngày theo chi nhánh, tổng theo hình thức thu; mở từng hoá đơn để in. Chủ spa **huỷ hoá đơn** (ghi lý do) |
| `/quan-ly/khach-hang` | nhân viên | Tìm theo SĐT / tên: số dư thẻ, lịch sử thẻ, gói còn bao nhiêu buổi, hoá đơn gần đây |
| `/quan-ly/goi-combo` | chủ, quản lý | Tạo / sửa gói: tên, giá, hạn dùng, dịch vụ + số buổi, đang bán / ngừng |
| `/quan-ly/doanh-so` | mọi nhân viên | Doanh số, hoa hồng (3% / 5%) và tiền dịch vụ KTV theo tháng; KTV chỉ thấy của mình |
| `/lich-hen` | khách | Thêm số dư thẻ và số buổi gói còn lại |

Cơ sở dữ liệu (`20261103000010_checkout.sql`):
- `checkout_invoice(...)`: tạo hoá đơn + dòng + chia doanh số + thanh toán + chốt + hoàn thành lịch trong **1 bước** (lỗi thì không lưu gì). Giá lấy từ menu (chỉ nhập tay cho dịch vụ "báo giá"); tiền trừ thẻ = tổng các dòng đánh dấu trả thẻ; giảm cả hoá đơn được chia theo tỉ lệ vào từng dòng nên hoa hồng tính trên tiền thực thu.
- Trừ buổi: dòng "trừ gói" gắn gói vào dịch vụ trong lịch, buổi bị trừ khi lịch hoàn thành; không trừ quá số buổi; mỗi lịch chỉ thu 1 lần; lịch đã thu không mở lại được.
- `void_invoice(id, lý do)`: chỉ chủ spa. Hoàn tiền đã trừ thẻ, trả buổi gói, thu hồi tiền nạp + tiền tặng, huỷ gói đã bán (nếu chưa dùng), lịch về "đang làm" để thu lại. Tiền mặt / CK / POS chủ spa tự hoàn cho khách.
- `save_package(...)`: chủ / quản lý tạo, sửa gói; gói khách đã mua giữ nguyên số buổi lúc mua.
- Tiền vừa nạp chỉ dùng được ở hoá đơn sau (thu nạp thẻ riêng trước, rồi thu lịch).
