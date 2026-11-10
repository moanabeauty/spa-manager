-- Combo theo sheet COMBO (11/11/2026)
--   Tên combo        = cột TÊN COMBO
--   Tên buổi (label) = cột TÊN BUỔI TRUYỀN THÔNG – khách nhìn thấy
--   Ghi chú nội bộ   = cột THỰC TẾ CHỈ ĐỊNH – chỉ nhân viên thấy (bảng package_item_notes)
--   Dịch vụ KTV được chọn cho mỗi buổi = package_item_services (theo THỰC TẾ CHỈ ĐỊNH)
-- Gói khách đã mua giữ nguyên như lúc mua.

alter table public.packages
  add column if not exists category text,
  add column if not exists sort_order int not null default 0;

create table if not exists public.package_item_notes (
  item_id uuid primary key references public.package_items(id) on delete cascade,
  note text not null
);
alter table public.package_item_notes enable row level security;
drop policy if exists "staff read" on public.package_item_notes;
create policy "staff read" on public.package_item_notes for select to authenticated using ((select public.is_staff()));
drop policy if exists "management write" on public.package_item_notes;
create policy "management write" on public.package_item_notes for all to authenticated
  using ((select public.has_role('owner','manager'))) with check ((select public.has_role('owner','manager')));
grant select, insert, update, delete on public.package_item_notes to authenticated;

-- Menu Combo: mọi người đã đăng nhập xem được tên combo + tên buổi truyền thông.
-- Dịch vụ thực tế trong từng buổi (package_item_services) vẫn chỉ nhân viên / khách đã mua gói thấy.
alter policy "public read" on public.packages
  using ((select auth.uid()) is not null);
alter policy "public read" on public.package_items
  using ((select auth.uid()) is not null);

do $$
declare
  c jsonb; i jsonb; v_pkg uuid; v_item uuid; v_ord int; v_n int;
  v_data jsonb := '[{"cat": "Chăm sóc da cơ bản", "old": "Chăm sóc da cơ bản 10 buổi", "name": "SEASONAL COMBO", "desc": "Trẻ hoá toàn diện, cải thiện làn da", "price": 4950000, "items": [{"l": "Chăm sóc da cơ bản 10 buổi. Được sử dụng linh hoạt trong các liệu trình thuộc nhóm Essential Treatment", "q": 10, "u": 850000, "n": "Gồm 10 buổi. Được sử dụng linh hoạt trong các liệu trình thuộc nhóm Essential Treatment", "grp": [1], "max": null}], "valid": null, "active": true, "sort": 1}, {"cat": "Chăm sóc da cơ bản", "old": "Chăm sóc da không giới hạn 12 tháng", "name": "DA ĐẸP CẢ NĂM", "desc": "Dùng không giới hạn 7 dịch vụ cơ bản trong 12 tháng", "price": 16990000, "items": [{"l": "Không giới hạn số buổi. Được sử dụng linh hoạt trong các liệu trình thuộc nhóm Essential Treatment", "q": null, "u": 850000, "n": null, "grp": [1], "max": null}], "valid": 365, "active": true, "sort": 2}, {"cat": "Chăm sóc da cơ bản", "old": "Fresh Skin", "name": "FRESH SKIN", "desc": "Phục hồi, thanh lọc da", "price": 3150000, "items": [{"l": "Detox Skin", "q": 3, "u": 1100000, "n": null, "svc": [[1, "DETOX SKIN"]]}, {"l": "Ion Bright / Pro Calm", "q": 2, "u": 1100000, "n": null, "svc": [[1, "ION BRIGHT"], [1, "PRO CALM"]]}], "valid": null, "active": true, "sort": 3}, {"cat": "Chăm sóc da cơ bản", "old": "Recover Skin", "name": "RECOVER SKIN", "desc": "Phục hồi da mụn, mụn đỏ", "price": 3780000, "items": [{"l": "Enzyme Power / Lymphas Therapy", "q": 3, "u": 1100000, "n": null, "svc": [[1, "ENZYME POWER"], [1, "LYMPHAS THERAPY"]]}, {"l": "Detox Skin", "q": 3, "u": 1100000, "n": null, "svc": [[1, "DETOX SKIN"]]}], "valid": null, "active": true, "sort": 4}, {"cat": "Mụn – Lỗ chân lông", "old": "Acne Control Package 1", "name": "ACNE CONTROL PACKAGE 1", "desc": "Kiểm soát mụn cấp độ 1", "price": 3950000, "items": [{"l": "Detox Skin", "q": 2, "u": 1100000, "n": null, "svc": [[1, "DETOX SKIN"]]}, {"l": "Acne Peeling", "q": 2, "u": 1900000, "n": "Được lựa chọn liệu trình peel bất kì trong nhóm Chemical Peeling", "grp": [4], "max": 1900000}, {"l": "Acne PhotoSkin", "q": 1, "u": 1900000, "n": null, "svc": [[15, "ACNE"]]}], "valid": null, "active": true, "sort": 5}, {"cat": "Mụn – Lỗ chân lông", "old": "Acne Control Package 2", "name": "ACNE CONTROL PACKAGE 2", "desc": "Kiểm soát mụn cấp độ 2 (mụn bọc, viêm, ẩn, nhiễm corticoid)", "price": 10990000, "items": [{"l": "Enzyme Power / Lymphas Therapy", "q": 3, "u": 1100000, "n": null, "svc": [[1, "ENZYME POWER"], [1, "LYMPHAS THERAPY"]]}, {"l": "Detox Skin", "q": 5, "u": 1100000, "n": null, "svc": [[1, "DETOX SKIN"]]}, {"l": "Acne PhotoSkin", "q": 2, "u": 1900000, "n": null, "svc": [[15, "ACNE"]]}, {"l": "Acne Peeling / Acne MTS", "q": 5, "u": 1900000, "n": "Được lựa chọn liệu trình bất kì trong nhóm Chemical Peeling / Phi Kim MTS", "grp": [4, 6], "max": 1900000}], "valid": null, "active": true, "sort": 6}, {"cat": "Mụn – Lỗ chân lông", "old": "Pore Instant Package 1", "name": "PORE INSTANT PACKAGE 1", "desc": "Điều trị lỗ chân lông cấp độ 1", "price": 6500000, "items": [{"l": "Pore Instant PhotoSkin", "q": 1, "u": 1900000, "n": null, "svc": [[15, "PORE INSTANT"]]}, {"l": "Được lựa chọn liệu trình peel bất kì trong nhóm Chemical Peeling", "q": 2, "u": 1900000, "n": null, "grp": [4], "max": 1900000}, {"l": "Được lựa chọn liệu trình peel bất kì trong nhóm Phi Kim MTS", "q": 3, "u": 1900000, "n": null, "grp": [6], "max": 1900000}], "valid": null, "active": true, "sort": 7}, {"cat": "Mụn – Lỗ chân lông", "old": null, "name": "PORE INSTANT PACKAGE 2", "desc": "Trị sẹo đa phương thức", "price": 16000000, "items": [{"l": "SCAR THERAPY", "q": 2, "u": 4500000, "n": null, "svc": [[9, "SCAR THERAPY"]]}, {"l": "MNRF", "q": 2, "u": 6000000, "n": null, "svc": [[7, "MNRF"]]}, {"l": "SCAR MESO", "q": 1, "u": 3850000, "n": null, "svc": [[5, "SCAR MESO"]]}, {"l": "SURFACE SCAR", "q": 3, "u": 2500000, "n": null, "svc": [[9, "SURFACE SCAR"]]}], "valid": null, "active": false, "sort": 8}, {"cat": "Sáng da – Nám – Tàn nhang", "old": "Glow Skin", "name": "GLOW SKIN", "desc": "Phục hồi làn da đều màu tự nhiên", "price": 6000000, "items": [{"l": "Toning PhotoSkin", "q": 2, "u": 1900000, "n": "Được lựa chọn liệu trình peel bất kì trong nhóm Photoskin", "grp": [15], "max": 1900000}, {"l": "Brightening Peel", "q": 2, "u": 1900000, "n": "Được lựa chọn liệu trình peel bất kì trong nhóm Peeling", "grp": [4], "max": 1900000}, {"l": "Glow MTS", "q": 2, "u": 1900000, "n": "Được chọn liệu trình bất kì trong nhóm MTS", "grp": [6], "max": 1900000}], "valid": null, "active": true, "sort": 9}, {"cat": "Sáng da – Nám – Tàn nhang", "old": "Glow Touch", "name": "GLOW TOUCH", "desc": "Điều trị tàn nhang", "price": 9900000, "items": [{"l": "Mesogun", "q": 1, "u": 3850000, "n": "Lựa chọn Glow Mesogun hoặc Biocomplex Mesogun", "svc": [[5, "GLOW MESOGUN"], [5, "BIOCOMPLEX MESOGUN"]]}, {"l": "Brightening Peel", "q": 2, "u": 1900000, "n": "Được lựa chọn liệu trình peel bất kì trong nhóm Peeling", "grp": [4], "max": 1900000}, {"l": "Dark Spot Photoskin", "q": 3, "u": 3500000, "n": null, "svc": [[15, "DARK SPOT"]]}], "valid": null, "active": true, "sort": 10}, {"cat": "Sáng da – Nám – Tàn nhang", "old": "Glow Boost", "name": "GLOW BOOST", "desc": "Điều trị nám, tàn nhang chuyên sâu", "price": 19000000, "items": [{"l": "DarkSpot Mesotherapy", "q": 10, "u": 3000000, "n": null, "svc": [[5, "DARKSPOT MESOTHERAPY"]]}, {"l": "Dark Spot Photoskin", "q": 10, "u": 3500000, "n": null, "svc": [[15, "DARK SPOT"]]}], "valid": null, "active": true, "sort": 11}, {"cat": "Sáng da – Nám – Tàn nhang", "old": "Glow Infinite", "name": "GLOW INFINITE", "desc": "Điều trị nám, tàn nhang chuyên sâu", "price": 35000000, "items": [{"l": "DarkSpot Mesotherapy", "q": 10, "u": 3000000, "n": null, "svc": [[5, "DARKSPOT MESOTHERAPY"]]}, {"l": "Dark Spot Photoskin", "q": null, "u": 3500000, "n": "Không giới hạn trong 1 năm", "svc": [[15, "DARK SPOT"]]}], "valid": 365, "active": true, "sort": 12}, {"cat": "Trẻ hoá – Căng bóng – Cấp ẩm", "old": "Mesogun Package 3", "name": "MESOGUN PACKAGE 3", "desc": "Trẻ hoá, căng bóng làn da", "price": 9820000, "items": [{"l": "Mesogun", "q": 3, "u": 3850000, "n": "Glow Mesogun", "svc": [[5, "GLOW MESOGUN"]]}, {"l": "Detox Skin", "q": 1, "u": 1100000, "n": null, "svc": [[1, "DETOX SKIN"]]}], "valid": null, "active": true, "sort": 13}, {"cat": "Trẻ hoá – Căng bóng – Cấp ẩm", "old": "Mesogun Package 5", "name": "MESOGUN PACKAGE 5", "desc": "Trẻ hoá, căng bóng làn da", "price": 15400000, "items": [{"l": "Mesogun", "q": 5, "u": 3850000, "n": "Glow Mesogun", "svc": [[5, "GLOW MESOGUN"]]}, {"l": "Detox Skin", "q": 1, "u": 1100000, "n": null, "svc": [[1, "DETOX SKIN"]]}, {"l": "Toning Photoskin", "q": 1, "u": 1900000, "n": "Được lựa chọn liệu trình peel bất kì trong nhóm Photoskin", "grp": [15], "max": 1900000}], "valid": null, "active": true, "sort": 14}, {"cat": "Trẻ hoá – Căng bóng – Cấp ẩm", "old": "Biocomplex – Mesogun x3", "name": "BIOCOMPLEX – MESOGUN X3", "desc": "Phục hồi toàn diện, cấp ẩm sâu", "price": 10500000, "items": [{"l": "Mesogun Biocomplex", "q": 3, "u": 5000000, "n": null, "svc": [[5, "BIOCOMPLEX MESOGUN"]]}, {"l": "Detox Skin", "q": 1, "u": 0, "n": null, "svc": [[1, "DETOX SKIN"]]}], "valid": null, "active": true, "sort": 15}, {"cat": "Trẻ hoá – Căng bóng – Cấp ẩm", "old": "BAP Biocomplex x1", "name": "BAP BIOCOMPLEX X1", "desc": "Cấp ẩm sâu, phục hồi, chống lão hoá", "price": 4950000, "items": [{"l": "BAP Biocomplex", "q": 1, "u": 8000000, "n": null, "svc": [[16, "BIOCOMPLEX BAP"]]}], "valid": null, "active": true, "sort": 16}, {"cat": "Trẻ hoá – Căng bóng – Cấp ẩm", "old": "BAP Biocomplex x3", "name": "BAP BIOCOMPLEX X3", "desc": "Cấp ẩm sâu, phục hồi, chống lão hoá", "price": 14000000, "items": [{"l": "BAP Biocomplex", "q": 3, "u": 8000000, "n": null, "svc": [[16, "BIOCOMPLEX BAP"]]}], "valid": null, "active": true, "sort": 17}, {"cat": "Trẻ hoá – Căng bóng – Cấp ẩm", "old": "B.A.P Profhilo x2", "name": "B.A.P PROFHILO X2", "desc": "Phục hồi da lão hoá, cấp nước sâu", "price": 16000000, "items": [{"l": "Profhilo", "q": 2, "u": 10000000, "n": null, "svc": [[16, "GLOW BAP"]]}], "valid": null, "active": true, "sort": 18}, {"cat": "Trẻ hoá – Căng bóng – Cấp ẩm", "old": "B.A.P Profhilo x3", "name": "B.A.P PROFHILO X3", "desc": "Phục hồi da lão hoá, cấp nước sâu", "price": 21000000, "items": [{"l": "Profhilo", "q": 3, "u": 10000000, "n": null, "svc": [[16, "GLOW BAP"]]}], "valid": null, "active": true, "sort": 19}, {"cat": "Trẻ hoá – Căng bóng – Cấp ẩm", "old": null, "name": "B.A.P KARISMA X1", "desc": "Nâng cơ, trẻ hoá từ sâu bên trong", "price": 7000000, "items": [{"l": "Karisma", "q": 1, "u": 10000000, "n": null, "svc": [[16, "COLLAGEN BAP"]]}], "valid": null, "active": true, "sort": 20}, {"cat": "Trẻ hoá – Căng bóng – Cấp ẩm", "old": "B.A.P Karisma x3", "name": "B.A.P KARISMA X3", "desc": "Nâng cơ, trẻ hoá từ sâu bên trong", "price": 18000000, "items": [{"l": "Karisma", "q": 3, "u": 10000000, "n": null, "svc": [[16, "COLLAGEN BAP"]]}], "valid": null, "active": true, "sort": 21}, {"cat": "Trẻ hoá – Căng bóng – Cấp ẩm", "old": "B.A.P Radiesse x2", "name": "B.A.P RADIESSE X2", "desc": "Làm đầy tức thì, định hình khuôn mặt", "price": 10000000, "items": [{"l": "Radiesse", "q": 1, "u": 12000000, "n": null, "svc": [[16, "CAHA BAP"]]}], "valid": null, "active": true, "sort": 22}, {"cat": "Trẻ hoá – Căng bóng – Cấp ẩm", "old": "B.A.P Radiesse x3", "name": "B.A.P RADIESSE X3", "desc": "Làm đầy tức thì, định hình khuôn mặt", "price": 24000000, "items": [{"l": "Radiesse", "q": 3, "u": 12000000, "n": null, "svc": [[16, "CAHA BAP"]]}], "valid": null, "active": true, "sort": 23}, {"cat": "Nâng cơ – HIFU", "old": "HIFU + Karisma", "name": "HIFU + KARISMA", "desc": "Hoà quyện rạng ngời, nâng cơ trẻ hoá", "price": 25000000, "items": [{"l": "FULLFACE V-LIFT+", "q": 1, "u": 35000000, "n": "HIFU", "svc": [[8, "FULL FACE V-LIFT+"]]}, {"l": "COLLAGEN BAP", "q": 1, "u": 10000000, "n": "B.A.P Karisma", "svc": [[16, "COLLAGEN BAP"]]}], "valid": null, "active": true, "sort": 24}, {"cat": "Nâng cơ – HIFU", "old": "HIFU Full Face V-Lift", "name": "HIFU FULL FACE V-LIFT", "desc": "Trẻ hoá, xoá nhăn, đẩy lùi lão hoá – 3 buổi/năm, cách 4–6 tháng", "price": 35000000, "items": [{"l": "FULLFACE V-LIFT+", "q": 3, "u": 35000000, "n": "HIFU Full Face", "svc": [[8, "FULL FACE V-LIFT+"]]}], "valid": 365, "active": true, "sort": 25}, {"cat": "Nâng cơ – HIFU", "old": "HIFU trẻ hoá cấp tốc", "name": "HIFU TRẺ HOÁ CẤP TỐC", "desc": "Trẻ hoá, xoá nhăn, đẩy lùi lão hoá", "price": 25900000, "items": [{"l": "FULLFACE V-LIFT+", "q": 1, "u": 35000000, "n": "HIFU", "svc": [[8, "FULL FACE V-LIFT+"]]}, {"l": "COLLAGEN BAP", "q": 1, "u": 10000000, "n": "B.A.P", "svc": [[16, "COLLAGEN BAP"]]}, {"l": "GLOW MESOGUN", "q": 1, "u": 3850000, "n": null, "svc": [[5, "GLOW MESOGUN"]]}, {"l": "MPT Booster", "q": 1, "u": 6000000, "n": null, "svc": [[8, "MPT BOOSTER"]]}], "valid": null, "active": true, "sort": 26}, {"cat": "Nâng cơ – HIFU", "old": "HIFU Intense", "name": "HIFU INTENSE", "desc": "Trẻ hoá, xoá nhăn, đẩy lùi lão hoá", "price": 25000000, "items": [{"l": "FULLFACE V-LIFT+", "q": 1, "u": 35000000, "n": "HIFU", "svc": [[8, "FULL FACE V-LIFT+"]]}, {"l": "MPT Booster", "q": 3, "u": 6000000, "n": null, "svc": [[8, "MPT BOOSTER"]]}], "valid": null, "active": true, "sort": 27}, {"cat": "Sẹo rỗ", "old": "Scar Treatment +", "name": "SCAR TREATMENT +", "desc": "Trị sẹo đa phương thức", "price": 16000000, "items": [{"l": "SCAR THERAPY", "q": 2, "u": 4500000, "n": null, "svc": [[9, "SCAR THERAPY"]]}, {"l": "MNRF", "q": 2, "u": 6000000, "n": null, "svc": [[7, "MNRF"]]}, {"l": "SCAR MESO", "q": 1, "u": 3850000, "n": null, "svc": [[5, "SCAR MESO"]]}, {"l": "SURFACE SCAR", "q": 3, "u": 2500000, "n": null, "svc": [[9, "SURFACE SCAR"]]}], "valid": null, "active": true, "sort": 28}, {"cat": "Vùng mắt", "old": "Brightening Eye x5", "name": "BRIGHTENING EYE MESO X5", "desc": "Làm sáng quầng thâm, xoá nhăn vùng mắt", "price": 4500000, "items": [{"l": "BRIGHTENING EYE MESO", "q": 5, "u": 1500000, "n": null, "svc": [[11, "BRIGHTENING EYE MESO"]]}], "valid": null, "active": true, "sort": 29}, {"cat": "Tóc – Da đầu", "old": "Hair Microneedling", "name": "HAIR MICRONEEDLING", "desc": "Chống rụng, kích mọc tóc cấp độ 1", "price": 5700000, "items": [{"l": "Anti Hair Loss MTS", "q": 3, "u": 1900000, "n": null, "svc": [[13, "ANTI HAIR LOSS MTS"]]}, {"l": "Scalp Care Therapy", "q": 3, "u": 1900000, "n": null, "svc": [[13, "OWAY BIOSCALP RESET"]]}], "valid": null, "active": true, "sort": 30}, {"cat": "Tóc – Da đầu", "old": "Hair Mesotherapy", "name": "HAIR MESOTHERAPY", "desc": "Chống rụng, kích mọc tóc cấp độ 2", "price": 9500000, "items": [{"l": "Anti Hair Loss Meso", "q": 3, "u": 3500000, "n": null, "svc": [[13, "ANTI HAIR LOSS MESO"]]}, {"l": "Scalp Care Therapy", "q": 3, "u": 1900000, "n": null, "svc": [[13, "OWAY BIOSCALP RESET"]]}], "valid": null, "active": true, "sort": 31}]'::jsonb;
begin
  for c in select value from jsonb_array_elements(v_data) loop
    v_pkg := null;
    if c->>'old' is not null then
      select id into v_pkg from public.packages where name = c->>'old';
      if v_pkg is null then raise exception 'Không thấy gói cũ %', c->>'old'; end if;
      update public.packages set name = c->>'name', description = c->>'desc', price = (c->>'price')::numeric,
             validity_days = coalesce((c->>'valid')::int, validity_days), is_active = (c->>'active')::boolean,
             category = c->>'cat', sort_order = (c->>'sort')::int
       where id = v_pkg;
      delete from public.package_items where package_id = v_pkg;
    else
      insert into public.packages (name, description, price, validity_days, is_active, category, sort_order)
      values (c->>'name', c->>'desc', (c->>'price')::numeric, (c->>'valid')::int, (c->>'active')::boolean, c->>'cat', (c->>'sort')::int)
      returning id into v_pkg;
    end if;
    v_ord := 0;
    for i in select value from jsonb_array_elements(c->'items') loop
      v_ord := v_ord + 1;
      insert into public.package_items (package_id, label, quantity, unit_price, sort_order)
      values (v_pkg, i->>'l', (i->>'q')::int, (i->>'u')::numeric, v_ord) returning id into v_item;
      if nullif(i->>'n', '') is not null then
        insert into public.package_item_notes (item_id, note) values (v_item, i->>'n');
      end if;
      if i ? 'svc' then
        insert into public.package_item_services (item_id, service_id)
        select distinct v_item, s.id from public.services s join public.service_categories sc on sc.id = s.category_id
         join jsonb_array_elements(i->'svc') p on (p->>0)::int = sc.sort_order and s.name_en = p->>1
         where s.is_active;
      else
        insert into public.package_item_services (item_id, service_id)
        select v_item, s.id from public.services s join public.service_categories sc on sc.id = s.category_id
         where s.is_active and sc.sort_order in (select (x)::int from jsonb_array_elements_text(i->'grp') x)
           and (i->>'max' is null or s.price <= (i->>'max')::numeric);
      end if;
      get diagnostics v_n = row_count;
      if v_n = 0 then raise exception 'Gói % – phần % không khớp dịch vụ nào', c->>'name', i->>'l'; end if;
    end loop;
  end loop;
  -- combo không còn trong sheet: ngừng bán (không xoá vì có thể đã bán)
  update public.packages set is_active = false, sort_order = 999
   where name in ('Eye Rejuvenature', 'Light Package', 'B.A.P Karisma x2');
end $$;

-- Lưu gói (trang Quản lý → Gói combo): thêm nhóm combo + ghi chú thực tế chỉ định cho từng buổi
drop function if exists public.save_package(uuid, text, numeric, int, text, boolean, jsonb);
create or replace function public.save_package(
  p_id uuid, p_name text, p_price numeric, p_validity_days int, p_description text,
  p_is_active boolean, p_items jsonb, p_category text default null
)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_it jsonb;
  v_item uuid;
  v_ord int := 0;
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ chủ / quản lý được sửa gói combo'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Vui lòng nhập tên gói'; end if;
  if p_price is null or p_price < 0 then raise exception 'Giá gói không hợp lệ'; end if;
  if p_validity_days is not null and p_validity_days <= 0 then raise exception 'Hạn dùng phải lớn hơn 0 ngày'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Gói cần ít nhất 1 phần dịch vụ'; end if;

  if v_id is null then
    insert into public.packages (name, price, validity_days, description, is_active, category, sort_order)
    values (trim(p_name), round(p_price), p_validity_days, nullif(trim(p_description), ''), coalesce(p_is_active, true),
            nullif(trim(p_category), ''), (select coalesce(max(sort_order), 0) + 1 from public.packages where sort_order < 999))
    returning id into v_id;
  else
    update public.packages
       set name = trim(p_name), price = round(p_price), validity_days = p_validity_days,
           description = nullif(trim(p_description), ''), is_active = coalesce(p_is_active, true),
           category = nullif(trim(p_category), '')
     where id = v_id;
    if not found then raise exception 'Không tìm thấy gói'; end if;
    delete from public.package_items where package_id = v_id;
  end if;

  for v_it in select value from jsonb_array_elements(p_items) loop
    if jsonb_array_length(coalesce(v_it->'service_ids', '[]'::jsonb)) = 0 then
      raise exception 'Mỗi phần của gói cần ít nhất 1 dịch vụ';
    end if;
    v_ord := v_ord + 1;
    insert into public.package_items (package_id, label, quantity, unit_price, sort_order)
    values (v_id, coalesce(nullif(trim(v_it->>'label'), ''), 'Phần ' || v_ord),
            nullif(v_it->>'quantity', '')::int, round(nullif(v_it->>'unit_price', '')::numeric), v_ord)
    returning id into v_item;
    if nullif(trim(v_it->>'note'), '') is not null then
      insert into public.package_item_notes (item_id, note) values (v_item, trim(v_it->>'note'));
    end if;
    insert into public.package_item_services (item_id, service_id)
    select distinct v_item, x::uuid from jsonb_array_elements_text(v_it->'service_ids') x;
  end loop;
  return v_id;
end $$;
revoke execute on function public.save_package(uuid, text, numeric, int, text, boolean, jsonb, text) from public, anon;
grant execute on function public.save_package(uuid, text, numeric, int, text, boolean, jsonb, text) to authenticated;
