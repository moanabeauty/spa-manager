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

## Giai đoạn 5: kho

Mỗi chi nhánh 2 kho: **kho liệu trình** (hàng KTV dùng làm dịch vụ) và **kho bán lẻ** (hàng bán cho khách).

| Trang | Ai dùng | Việc |
|---|---|---|
| `/quan-ly/kho` | mọi nhân viên | Tồn kho theo chi nhánh + kho, tìm theo tên / nhãn hàng / mã vạch, lọc "sắp hết". Quản lý kho: **Kiểm kê** (nhập số đếm thực tế + lý do, hệ thống ghi chênh lệch) |
| `/quan-ly/kho/nhap-hang` | quản lý kho, quản lý, chủ | Chọn kho → quét mã vạch (máy quét cầm tay hoặc camera điện thoại) → số lượng + giá nhập → lưu **phiếu nhập** (mã PN…). Mã vạch lạ: gắn cho sản phẩm có sẵn hoặc tạo sản phẩm mới (bắt buộc nhãn hàng, tên, dung tích) |
| `/quan-ly/kho/xin-xuat` | KTV gửi, quản lý kho duyệt | KTV chọn hàng trong kho liệu trình (thấy số còn), ghi dùng cho khách / liệu trình nào → phiếu XK… chờ duyệt. Quản lý kho **Duyệt & xuất kho** (tự trừ kho) hoặc **Từ chối** (bắt buộc lý do). KTV huỷ được phiếu đang chờ |
| `/quan-ly/kho/lich-su` | mọi nhân viên | 200 lần nhập / xuất gần nhất theo kho |
| `/quan-ly/kho/san-pham` | quản lý kho, quản lý, chủ | Danh mục sản phẩm: nhãn hàng, tên, dung tích, đơn vị đếm, mã vạch, giá niêm yết, giá nhập, hàng liệu trình / bán lẻ, mức báo sắp hết. Chủ spa đặt **% giảm tối đa khi bán lẻ** |
| `/quan-ly/thu-tien` | lễ tân, KTV, quản lý, chủ | **Bán sản phẩm lẻ**: gõ tên hoặc quét mã vạch, thấy tồn kho bán lẻ của chi nhánh. Giá bán từ *giá niêm yết × (100% − % giảm tối đa)* đến giá niêm yết (mặc định giảm tối đa 30%; sản phẩm đặt 0% = không giảm). Không giảm sâu hơn được: giảm cả hoá đơn không chia vào sản phẩm, giảm riêng dòng sản phẩm chỉ chủ / quản lý. Chốt hoá đơn thì trừ kho bán lẻ; huỷ hoá đơn thì nhập lại |

Cơ sở dữ liệu (`20261103000015_inventory.sql`, `…16_retail_checkout.sql`, `…17_seed_treatment_products.sql`):
- `products` thêm nhãn hàng, dung tích, mã vạch (không trùng), nhóm, dùng trong liệu trình, giá nhập (KTV / lễ tân không đọc được – hàm `product_costs()`), hàng liệu trình / bán lẻ, `% giảm tối đa riêng`, mức sắp hết.
- 110 sản phẩm kho liệu trình nhập từ sheet PRODUCT (bỏ nhóm "ĐÃ CẮT MÃ"); 4 mã DMK sheet ghi nhãn BR được sửa thành DMK.
- Quản lý kho chỉ thao tác kho của chi nhánh mình (`can_manage_warehouse`); chủ / quản lý mọi kho.
- Hàm: `receive_stock`, `adjust_stock`, `create_stock_request`, `review_stock_request`, `cancel_stock_request`, `set_retail_max_discount`, `retail_min_price`. Không xuất / bán quá tồn kho.
- Vai trò `warehouse` (quản lý kho) vào được trang Quản lý nhưng chỉ thấy mục Kho.

## Giai đoạn 6: khách hàng & khuyến mãi

| Trang | Ai dùng | Việc |
|---|---|---|
| `/khuyen-mai` | mọi người (đăng ký cần đăng nhập) | Xem chương trình đang mở: món + giá gạch / giá KM (0đ = tặng), số suất còn, điều kiện, hạn dùng. **Đăng ký ưu đãi**: chọn chi nhánh, ngày giờ muốn đến (không bắt buộc), ghi chú → "chờ xác nhận" |
| `/lich-hen` | khách | Thêm mục **Ưu đãi đã đăng ký** (trạng thái, hạn dùng), tự huỷ được |
| `/quan-ly/khuyen-mai` | lễ tân, KTV, quản lý, chủ | Đăng ký theo trạng thái (Chờ xác nhận / Đã xác nhận / Đã dùng / Đã huỷ) + chi nhánh. Gọi khách (bấm SĐT) → **Xác nhận** (đổi chi nhánh / giờ hẹn, ghi chú) hoặc **Huỷ** (bắt buộc lý do). Đã xác nhận: **Tạo lịch hẹn**, **Thu tiền**. **Đăng ký hộ khách** gọi điện / tại quầy (xác nhận luôn) |
| `/quan-ly/khuyen-mai/chuong-trinh` | chủ, quản lý | Tạo / sửa chương trình: 4 kiểu (giảm giá dịch vụ, gói giá ưu đãi, trải nghiệm lần đầu, mua kèm tặng); thêm dịch vụ / gói / sản phẩm, nhập giá KM hoặc % giảm hoặc "Tặng", số lượng; thời gian đăng ký, hạn dùng, chi nhánh, tổng số suất, số lần / khách, chỉ khách lần đầu, hiện trên web hay chỉ tại quầy, dừng chương trình |
| `/quan-ly/thu-tien` | người thu | Chọn khách → khung **Ưu đãi khách đã đăng ký** → bấm **Áp dụng** từng món: dịch vụ đã có trong lịch được đổi sang giá KM, món khác thêm dòng mới. Dòng KM có nhãn "KM …", bấm "Bỏ khuyến mãi" để trả về giá thường |

Cơ sở dữ liệu (`20261103000018_promotion_status.sql`, `…19_promotions.sql`, `…20_checkout_promotions.sql`):
- `promotions` thêm kiểu, điều kiện, chi nhánh, chỉ khách mới, số suất, số lần / khách, hạn dùng, hiện online; bảng mới `promotion_items` (món + giá KM + số lượng, lưu sẵn tên + giá niêm yết để khách xem).
- Đăng ký chỉ qua hàm `register_promotion` (kiểm tra thời gian, chi nhánh, khách lần đầu, số lần / khách, hết suất – khoá chương trình khi đếm), `confirm_promotion_registration`, `cancel_promotion_registration`; số suất đã đăng ký công khai qua `promotion_taken_counts()`.
- `checkout_invoice` nhận `promotion_registration_id` + `promotion_item_id` trên từng dòng; `promotion_line_check` kiểm tra đăng ký đã xác nhận, đúng khách, đúng chi nhánh, còn hạn, đúng món; không dùng quá số lượng. Giá KM **không tính là giảm giá** (không cần chủ duyệt), giảm chung cả hoá đơn **không** chia vào dòng KM; dòng dịch vụ KM vẫn trừ thẻ được (theo giá KM). Gói "ngừng bán" vẫn bán được qua KM.
- Chốt hoá đơn → đăng ký "đã dùng" (cả chương trình, kể cả món chưa áp dụng); chủ huỷ hoá đơn → đăng ký về "đã xác nhận" để dùng lại.
- Doanh số / hoa hồng tính trên giá KM thực thu như dòng thường.

### Chỉnh theo chủ spa (`20261103000021_promotion_rules.sql`)
- **Không áp dụng 2 ưu đãi cùng lúc**: món khuyến mãi không trừ thẻ nạp sẵn (giá thành viên), không giảm giá thêm (dòng hay cả hoá đơn), không áp lên buổi trừ gói.
- Ưu đãi là **gói combo**: khách mua gói theo giá KM, nhận đủ buổi và dùng dần như combo thường; hoàn tiền tính theo số tiền thực trả.
- **Hết hạn**: hết thời gian đăng ký thì khách không tự đăng ký được, chủ / quản lý vẫn đăng ký hộ. Hết hạn dùng thì lễ tân không áp được; chủ / quản lý bấm **Gia hạn** (ngày + lý do) ở trang Khuyến mãi (`extend_promotion_registration`).
- **Gói combo ngừng bán**: ngoài khuyến mãi, chỉ chủ / quản lý bán được (hiện trong ô "Bán gói combo" với chữ "ngừng bán").

## Giai đoạn 7: báo cáo cho chủ spa

| Trang | Ai dùng | Việc |
|---|---|---|
| `/quan-ly/bao-cao` | chủ, quản lý | **Doanh thu** theo ngày / tháng, lọc chi nhánh và khoảng ngày (nút nhanh: hôm nay, tháng này, tháng trước, cả năm). Tiền thực thu (tiền mặt + CK + POS), tiền trừ thẻ, hoàn tiền; tiền đến từ dịch vụ lẻ / gói combo – liệu trình / sản phẩm / nạp thẻ; so sánh 2 chi nhánh; dịch vụ, gói, sản phẩm bán nhiều nhất |
| `/quan-ly/bao-cao/goi-the` | chủ, quản lý | Gói và thẻ **đã bán** trong tháng; **số buổi còn nợ** khách mua combo (từng phần của gói) + giá trị còn nợ; thẻ còn số dư + **tiền thực nợ** = số dư × mệnh giá / (mệnh giá + tiền tặng). Tìm theo tên / SĐT |
| `/quan-ly/bang-luong` | chủ (đủ), quản lý (chấm công + phạt) | **Bảng lương**: lương cơ bản theo ngày công (÷ 27 công, sửa riêng từng người được), lương trách nhiệm, phụ cấp ăn 30k / công, thêm giờ ×150%, hoa hồng, tiền dịch vụ KTV, cộng khác − phạt nội quy − BHXH (10,5%) − trừ khác = thực nhận; tiền BHXH Moana đóng (21,5%). Phiếu lương từng người, in, **ghi vào sổ chi**. Tab Chấm công, Phạt nội quy, Mức lương (từng người), Cài đặt (số ngày công chuẩn, %, mức phụ cấp) |
| `/quan-ly/doanh-so` | nhân viên | Thêm **phiếu lương tạm tính** của mình |
| `/quan-ly/thu-chi` | chủ | **Dòng tiền**: nhập mọi khoản thu / chi (danh mục, chi nhánh hoặc chung, hình thức), tự cộng tiền bán hàng thực thu và trừ tiền hoàn khách. Bảng 12 tháng: thu, chi, lợi nhuận, **% lợi nhuận**; cả năm; chi theo danh mục |
| `/quan-ly/duyet-giam-gia` | chủ | Nút **Bật thông báo** trên điện thoại: lễ tân / KTV gửi yêu cầu giảm giá là điện thoại chủ spa báo ngay (bấm vào mở trang duyệt). iPhone cần "Thêm vào MH chính" trước |

Cơ sở dữ liệu (`20261103000022_reports_payroll_cashbook.sql`, `…23_report_number_format.sql`):
- Hàm báo cáo `revenue_report`, `sales_by_item`, `card_liabilities`, `package_liabilities` (chủ / quản lý), `cashflow_report` (chủ).
- Lương: `staff_pay_settings` (chỉ chủ), `payroll_entries` + `staff_penalties` (chủ / quản lý ghi, nhân viên xem của mình), cài đặt `app_settings.payroll`; `payroll_sheet` (chủ), `my_payslip` (nhân viên), `post_payroll_to_cashbook` (ghi 2 khoản chi: lương thực nhận + BHXH cả 2 phần, bấm lại thì cập nhật).
- Thu chi: `cashbook_categories`, `cashbook_entries` (chỉ chủ).
- Thông báo: `push_subscriptions`, `save_push_subscription`, `discount_push_targets` (mỗi yêu cầu báo 1 lần). Gửi bằng Web Push (`src/lib/webpush.ts`, không cần thư viện), khoá đặt ở biến môi trường Vercel `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

### Chấm công check-in / out (`20261103000024_attendance_checkin.sql`)
- Nhân viên (trừ chủ spa) bấm **Check-in / Check-out** ở đầu mọi trang Quản lý; giờ lấy theo máy chủ (`check_in()`, `check_out()`, bảng `staff_attendance`).
- Ca 9:00 – 18:00, nghỉ trưa 60 phút, 8 giờ / công. Làm ≥ 6 giờ = 1 công, 3 – 6 giờ = 0,5 công, quên check-out = 0 công. Về sau 18:00 tính thêm giờ theo nửa tiếng. Sửa ở Bảng lương → Cài đặt.
- Bảng lương → tab **Check-in / out**: quản lý / chủ xem từng ngày, sửa giờ, thêm hoặc xoá ngày (`save_attendance`, có ghi chú). Tab **Chấm công** hiện cột "Theo check-in" + nút "Điền từ check-in / out"; người chưa lưu tay thì bảng lương tự dùng số check-in.
- Ngày công chuẩn chung 27 (KTV), sửa riêng từng người ở tab Mức lương. Đơn giá giờ thêm = lương cơ bản ÷ công chuẩn ÷ 8 × 150%.
- Chủ spa: thẻ **Bật thông báo** hiện ở đầu trang Quản lý cho đến khi bật trên máy đó.

### Vị trí + chủ spa duyệt chấm công (`20261103000025_attendance_geo_approval.sql`)
- Check-in / out gửi vị trí điện thoại; cách chi nhánh gần nhất quá 100m hoặc không lấy được vị trí → **chờ chủ spa duyệt**. Vị trí chi nhánh: chủ spa đứng tại chi nhánh, vào Bảng lương → Cài đặt → "Tôi đang ở đây – lưu vị trí".
- Quên check-in / check-out: quản lý bổ sung giờ (bắt buộc lý do) → chờ chủ spa duyệt; chủ spa sửa thì duyệt luôn (`review_attendance`). Ngày chờ duyệt / không duyệt không tính công.
- Tăng ca: check-out từ 18:30 mới tính, tính từ 18:00 theo từng nửa tiếng.

### Lương theo giờ, duyệt tăng ca, nghỉ phép (`20261103000026_hours_overtime_leave.sql`)
- Tháng chuẩn 27 công × 9 giờ (9:00 – 18:00) = **243 giờ**. Giờ làm = thời gian có mặt trong khung ca (đến sớm / về muộn không cộng). Lương cơ bản = lương × giờ làm / 243. Phụ cấp ăn theo số ngày đi làm.
- **Tăng ca**: check-out từ 18:30 bắt buộc ghi lý do (vd làm cho khách nào) → quản lý / chủ duyệt số giờ (Bảng lương / Chấm công → Check-in / out). Đơn giá = lương ÷ 27 ÷ 8 × 150%.
- **Nghỉ phép** (`/quan-ly/nghi-phep`): nhân viên đăng ký (có lương / không lương, nửa ngày) → quản lý / chủ duyệt. Phép có lương được cộng 9 giờ / ngày. **Nghỉ không phép** do quản lý ghi: không lương ngày đó + trừ thêm 1 ngày lương (lương ÷ 27).
- Tab Chấm công: ô Giờ làm / Ngày ăn / Giờ tăng ca để trống = tự lấy theo check-in; gõ số để tính khác.

### Ngày nghỉ định mức (`20261103000027_leave_quota.sql`)
- Tháng N ngày được nghỉ N − 27 ngày (30 ngày → 3, 31 ngày → 4), nhân viên tự đăng ký, làm đủ 243 giờ thì đủ lương (ngày nghỉ không cộng giờ). Quá định mức → "nghỉ thêm, không lương". Làm nửa ngày: ca sáng 9:00 – 13:30 / ca chiều 13:30 – 18:00 (0,5 ngày nghỉ).
- Đơn giá tăng ca giữ lương ÷ 27 ÷ 8 (8 giờ làm thực tế); giờ có mặt 9:00 – 18:00 (9 giờ, gồm nghỉ trưa) dùng để tính đủ 243 giờ.
- Ngày lễ, Tết (`public_holidays`): chủ spa nhập ở Bảng lương → Cài đặt; mỗi ngày lễ cộng 9 giờ cho mọi nhân viên (nghỉ hưởng nguyên lương), ngoài định mức nghỉ tháng.
- Ngày lễ: hưởng lương cơ bản (cộng 9 giờ) nhưng **không** có phụ cấp ăn (phụ cấp ăn chỉ tính ngày đi làm).
- Tiền dịch vụ KTV: dịch vụ có cờ `fee_once_per_visit` (Meso chấm nốt mụn) chỉ tính 1 lần / lượt khách dù làm nhiều điểm (`20261103000028_fee_once_per_visit.sql`); bật / tắt ở Menu dịch vụ → chi tiết.
- Ngày lễ chọn được người nghỉ (`holiday_assignments`, `20261103000029_holiday_staff.sql`): tất cả hoặc từng nhân viên. Đi làm ngày lễ của mình → giờ làm hôm đó trả 300% (1 ngày đủ = 3 ngày lương), ngoài lương nghỉ lễ.

## Giai đoạn 8: CRM khách hàng + menu phân cấp

| Trang | Ai dùng | Việc |
|---|---|---|
| `/quan-ly/khach-hang` | lễ tân, KTV, quản lý, chủ | Danh sách khách lọc theo **nhóm tự động** (khách mới, quay lại, đã mua gói / thẻ, VIP, còn buổi / số dư, lâu chưa quay lại, sinh nhật tháng này), **nhóm tự tạo**, chi nhánh; tìm tên / SĐT. Mỗi dòng: số lần đến, lần cuối, chi tiêu 12 tháng, buổi còn, số dư thẻ |
| `/quan-ly/khach-hang?id=…` | như trên | **Hồ sơ khách**: liên hệ, ngày sinh, giới tính, chi nhánh hay đến, địa chỉ, nguồn khách, loại da, tình trạng da, lưu ý sức khoẻ / dị ứng (hiện nổi bật), ghi chú nội bộ (khách không thấy); gắn / bỏ nhóm. Thống kê lần đến, chi tiêu. **Lịch sử dịch vụ** (ngày, chi nhánh, dịch vụ, KTV, trừ gói), lịch sử mua gói / nạp thẻ, gói, thẻ, hoàn tiền, hoá đơn. **Nhắc chăm sóc** của khách + hẹn nhắc / ghi lại cuộc gọi |
| `/quan-ly/cham-soc` | như trên | **Chăm sóc lại**: nhắc đến hạn / quá hạn, sắp tới, đã xử lý; lọc chi nhánh, loại. Bấm SĐT gọi khách → **Đã liên hệ** (ghi kết quả, hẹn gọi lại sau N ngày) hoặc **Bỏ qua** (lý do); tạo lịch hẹn. Số nhắc đến hạn hiện trên tab |
| `/quan-ly/khach-hang/nhom` | quản lý, chủ | Tạo / sửa / xoá nhóm khách (màu). Chủ spa: mức chi tiêu VIP, số ngày "lâu chưa quay lại", nhắc gói hết hạn, nhắc sinh nhật, thẻ nạp sẵn có mở toàn bộ menu không |
| `/menu` | mọi người | **Menu giới thiệu dịch vụ**: khách mới / chưa đăng nhập chỉ thấy dịch vụ 👁; khách đã mua gói thấy toàn bộ. Nhóm có dịch vụ ẩn hiện "+N 🔒" |
| `/quan-ly/dich-vu` | quản lý, chủ | Nhãn 👁 / 🔒 từng dịch vụ (bấm để đổi, hoặc đổi cả nhóm); lọc theo cấp; chi tiết: số ngày **hỏi thăm sau làm**, **mời quay lại** |

Cơ sở dữ liệu (`20261103000030_crm_menu_tiers.sql`):
- `customer_crm` (hồ sơ da, nguồn khách, ghi chú nội bộ, `menu_unlocked`) – chỉ nhân viên đọc / sửa; chỉ chủ / quản lý đổi `menu_unlocked` (`set_customer_menu_unlock`).
- `customer_groups`, `customer_group_members`; hàm `crm_customers(...)` tính thống kê + nhóm tự động (chi tiêu = tiền thực thu, không tính trừ thẻ, trừ tiền hoàn). Cài đặt `app_settings.crm` (`crm_settings`, `save_crm_settings`).
- `care_reminders`: lịch hoàn thành → tự tạo "hỏi thăm" (theo `services.followup_days`, mặc định 1 ngày cho peel, laser, meso, phi kim, RF, HIFU, tiêm, filler, botox, triệt lông) và "mời quay lại" (theo `services.recall_days`); khách quay lại làm thì nhắc "mời quay lại / lâu chưa đến" cũ tự đóng; lịch bị mở lại thì xoá nhắc chưa xử lý. `refresh_care_reminders()` (chạy khi mở trang Chăm sóc, không tạo trùng): gói sắp hết hạn còn buổi, khách còn buổi / số dư mà quá N ngày chưa đến, sinh nhật sắp tới. `add_care_reminder`, `complete_care_reminder`.
- **Menu phân cấp**: `services.menu_tier` (`public` = khách mới thấy, `members` = chỉ khách đã mua gói). Quyền đọc bảng `services` lọc theo cấp ngay trong cơ sở dữ liệu: nhân viên thấy hết; khách thấy hết khi đã mua gói combo (kể cả gói khuyến mãi, gói đã huỷ / hết hạn), có thẻ nạp sẵn (nếu bật) hoặc được mở thủ công; dịch vụ đã có trong lịch của chính khách luôn hiện tên. Khách tự đặt online không đặt được dịch vụ 🔒 (`appointment_services_tier_check`). `menu_locked_summary()` đếm dịch vụ đang ẩn.
- Mặc định 👁: Basic Treatment (2 nhóm), Biologique Recherche, Chemical Peel, Light Therapy, Laser, Body, Hair & Scalp, Triệt lông, Thermo + RF vùng mắt. 🔒: Meso, phi kim, MNRF, MPT / HIFU, Acne Scar, BAP, Filler, Botox, các dịch vụ mắt còn lại.
