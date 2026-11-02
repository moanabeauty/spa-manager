-- Moana Spa Manager: dữ liệu cấu hình ban đầu

insert into public.branches (name, address) values
  ('Moana Lưu Quang Vũ', '67 Lưu Quang Vũ, Yên Hoà, Hà Nội'),
  ('Moana Nguyễn Sơn',   '109 Nguyễn Sơn, Bồ Đề, Hà Nội');

-- mỗi chi nhánh: kho bán lẻ + kho liệu trình
insert into public.warehouses (branch_id, type, name)
select b.id, t.type::public.warehouse_type, t.label || ' - ' || b.name
  from public.branches b
 cross join (values ('retail', 'Kho bán lẻ'), ('treatment', 'Kho liệu trình')) as t(type, label);

-- thẻ tài khoản: 5tr tặng 1tr, 10tr tặng 3tr, 20tr tặng 10tr
insert into public.card_topup_tiers (topup_amount, bonus_amount) values
  (5000000, 1000000), (10000000, 3000000), (20000000, 10000000);

-- hoa hồng: doanh số tháng < 30tr -> 3%, từ 30tr -> 5%
insert into public.commission_tiers (min_monthly_sales, rate) values (0, 0.03), (30000000, 0.05);

-- loại hàng tính vào doanh số hoa hồng (chờ xác nhận: dịch vụ lẻ, nạp thẻ)
insert into public.commission_item_types (item_type, counts) values
  ('product', true), ('package', true), ('card_topup', true), ('service', false);
