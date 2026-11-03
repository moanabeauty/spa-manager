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
- Danh mục dịch vụ nhập từ sheet Menu (18 nhóm). Tiền dịch vụ KTV / bác sĩ theo cột trong sheet Menu (`20261103000012_technician_fees.sql`; 10 dịch vụ Meso sheet chưa có số → 0đ). Thời lượng đang tạm 60 phút.
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
| `/quan-ly` → nút **Thu tiền** | lễ tân, KTV, quản lý, chủ | Mở hoá đơn từ dịch vụ trong lịch; lịch đã thu hiện "✓ Đã thanh toán" + mã hoá đơn |
| `/quan-ly/thu-tien` | lễ tân, KTV, quản lý, chủ | Từng dòng: giảm giá, trừ thẻ nạp sẵn (tự tính **giá thành viên**; khách còn số dư thì mặc định trừ thẻ), **trừ buổi gói**, chia doanh số (%) cho 1 hay nhiều nhân viên. Giảm cả hoá đơn (đ hoặc %). Thu kết hợp tiền mặt + chuyển khoản + POS + thẻ; tính tiền thừa trả khách. Thêm dịch vụ khách làm thêm (chọn KTV), bỏ dịch vụ khách không làm. Không theo lịch: bán gói combo, nạp thẻ (chỉ 3 mức 5tr / 10tr / 20tr kèm tiền tặng), thu lẻ |
| `/quan-ly/hoa-don` | thu ngân | Hoá đơn + tiền hoàn trong ngày theo chi nhánh, tổng theo hình thức thu; mở từng hoá đơn để in. Chủ spa **huỷ hoá đơn** (ghi lý do) |
| `/quan-ly/khach-hang` | nhân viên | Tìm theo SĐT / tên: số dư thẻ, lịch sử thẻ, gói còn bao nhiêu buổi, hoá đơn gần đây. Quản lý / chủ: **Huỷ & hoàn tiền** thẻ hoặc gói đang dùng dở |
| `/quan-ly/goi-combo` | chủ, quản lý | Tạo / sửa gói: tên, giá, hạn dùng, dịch vụ + số buổi, đang bán / ngừng |
| `/quan-ly/doanh-so` | mọi nhân viên | Doanh số, hoa hồng (3% / 5%) và tiền dịch vụ KTV theo tháng; KTV chỉ thấy của mình |
| `/lich-hen` | khách | Thêm số dư thẻ và số buổi gói còn lại |

Cơ sở dữ liệu (`20261103000010_checkout.sql`, `20261103000011_seed_combos.sql`):
- **Gói combo theo phần** (`package_items` + `package_item_services`): mỗi phần có số buổi (bỏ trống = không giới hạn), giá lẻ / buổi và các dịch vụ được dùng linh hoạt. Khách mua thì chép sang `customer_package_items`. 32 gói nhập từ sheet COMBO (đã bỏ Light Only, HIFU x3). Phần có Peel dùng được mọi Peel giá 1.900k, phần có Micro Needling dùng mọi MN giá 1.900k; khách chỉ thấy tên phần + số buổi, KTV / lễ tân chọn dịch vụ cụ thể. Menu: thêm BAP Biocomplex (8tr), Hydrating MN đổi tên Glow MN.
- `checkout_invoice(...)`: tạo hoá đơn + dòng + chia doanh số + thanh toán + chốt + hoàn thành lịch trong **1 bước** (lỗi thì không lưu gì). Giảm cả hoá đơn chia theo tỉ lệ vào từng dòng nên hoa hồng tính trên tiền thực thu. Lễ tân, KTV, quản lý, chủ đều thu được.
- **Thẻ nạp sẵn** (chỉ 3 mức 5tr / 10tr / 20tr): chỉ trả được dịch vụ có giá thành viên, trừ theo giá thành viên; dịch vụ không có giá thành viên phải thanh toán ngoài. Số dư không đủ thì dịch vụ tính giá niêm yết, trả ngoài. Tiền vừa nạp dùng từ hoá đơn sau.
- Trừ buổi: dịch vụ gắn vào 1 phần của gói, trừ khi lịch hoàn thành; không trừ quá số buổi; mỗi lịch chỉ thu 1 lần; lịch đã thu không mở lại được.
- `void_invoice(id, lý do)`: chỉ chủ spa. Hoàn tiền đã trừ thẻ, trả buổi gói, thu hồi tiền nạp + tặng, huỷ gói đã bán (nếu chưa dùng), lịch về "đang làm" để thu lại.
- **Huỷ gói / thẻ đang dùng dở** (`refund_quote`, `refund_customer_asset`, bảng `refunds`): chỉ quản lý / chủ. Thẻ: hoàn = mệnh giá đã nạp − giá niêm yết các dịch vụ đã trả bằng thẻ (tiền tặng không hoàn). Gói: hoàn = giá gói − số buổi đã dùng × giá lẻ / buổi. Sửa được số tiền, bắt buộc ghi lý do; thẻ / gói bị khoá. Tiền hoàn **trừ vào doanh số người bán** (`refund_seller_deductions`) trong tháng hoàn.
- KTV chỉ xem hoá đơn mình được chia doanh số hoặc mình thu (`can_see_invoice`).

### Cập nhật sau giai đoạn 4
- `20261103000013_menu_member_prices.sql`: đồng bộ giá niêm yết, giá thành viên, tiền dịch vụ KTV theo sheet Menu (73 dịch vụ có giá thành viên). Cắt đáy sẹo: sheet ghi tiền KTV 120.000.000đ (nghi gõ nhầm) nên giữ 100.000đ.
- `20261103000014_discount_approval.sql`: **giảm giá** chỉ chủ / quản lý tự làm và phải ghi lý do. Lễ tân / KTV bấm "Gửi chủ spa duyệt" (số tiền + lý do) → chủ spa duyệt ở trang **Duyệt giảm giá** (được duyệt số thấp hơn) → người thu bấm "Kiểm tra lại" rồi thu với số đã duyệt. Mỗi yêu cầu dùng 1 lần, đúng lịch / khách đã xin; huỷ hoá đơn thì yêu cầu trả về "đã duyệt". Giao diện gọi `checkout_invoice_v2`.
