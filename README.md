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
Tài khoản mới đăng ký mặc định là `customer`; chủ spa đổi vai trò bằng `select set_user_role('<user id>', 'technician', '<branch id>');`

## Giao diện web (giai đoạn 2)

| Trang | Ai dùng | Việc |
|---|---|---|
| `/dang-nhap` | mọi người | Đăng nhập, đăng ký (họ tên, SĐT, email, mật khẩu), quên mật khẩu |
| `/dat-lich` | khách | Chọn chi nhánh → dịch vụ (tối đa 5) → ngày giờ → ghi chú, gửi lịch "chờ xác nhận" |
| `/lich-hen` | khách | Lịch sắp tới + lịch sử, huỷ lịch còn chờ xác nhận |
| `/quan-ly` | nhân viên | Lịch theo ngày + chi nhánh; Xác nhận / Khách đã đến / Hoàn thành / Không đến / Huỷ |

Giờ nhận đặt online, bước giờ, đặt trước tối thiểu: sửa trong `src/lib/config.ts` (đang để 9:00–19:30, 30 phút/suất, trước ≥ 60 phút).
Đăng ký online với SĐT trùng khách cũ sẽ **không** tự nối hồ sơ (tránh mạo danh); lễ tân thấy ghi chú trên lịch hẹn để kiểm tra.
