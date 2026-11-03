-- Nhập 32 gói combo từ sheet COMBO (AI QUY TRÌNH LIỆU TRÌNH MOANA 2026)
-- Theo chủ spa: After Sun = Ion Bright / Pro Calm; Purifying Peel = Acne Peel; Glow MN = Hydrating MN (đổi tên);
-- Mini HIFU = MPT Booster; Laser tái tạo bề mặt = Toning; bỏ gói Light Only và HIFU x3; B.A.P = Karisma.
-- Phần có Peel: chọn mọi loại Peel giá 1.900k; phần có Micro Needling: mọi loại MN giá 1.900k.

-- ---- menu: thêm BAP Biocomplex, đổi tên Hydrating MN thành Glow MN ----
insert into public.services (category_id, name, name_en, price, card_allowed)
select c.id, 'BAP Biocomplex cấp ẩm sâu, phục hồi', 'BAP BIOCOMPLEX', 8000000, false
  from public.service_categories c
 where c.name = 'BAP – Tiêm trẻ hoá'
   and not exists (select 1 from public.services s where s.name_en = 'BAP BIOCOMPLEX' and s.category_id = c.id);

update public.services s set name_en = 'GLOW MN'
  from public.service_categories c
 where c.id = s.category_id and c.name = 'Phi kim / Microneedling' and s.name_en = 'HYDRATING MN';

-- ---- hàm tạm để nhập ----
create or replace function pg_temp.svc(p_cat text, p_en text) returns uuid language plpgsql as $$
declare v uuid;
begin
  select s.id into v from public.services s join public.service_categories c on c.id = s.category_id
   where c.name = p_cat and s.name_en = p_en;
  if v is null then raise exception 'Không tìm thấy dịch vụ % / %', p_cat, p_en; end if;
  return v;
end $$;

-- p_items: [{"label","qty","unit","svcs":[[cat, name_en], ...]}]
create or replace function pg_temp.add_pkg(p_name text, p_price numeric, p_days int, p_desc text, p_items jsonb)
returns void language plpgsql as $$
declare v_pkg uuid; v_it jsonb; v_item uuid; v_ord int := 0; v_s jsonb;
begin
  if exists (select 1 from public.packages where name = p_name) then return; end if;
  insert into public.packages (name, price, validity_days, description) values (p_name, p_price, p_days, p_desc)
  returning id into v_pkg;
  for v_it in select value from jsonb_array_elements(p_items) loop
    v_ord := v_ord + 1;
    insert into public.package_items (package_id, label, quantity, unit_price, sort_order)
    values (v_pkg, v_it->>'label', nullif(v_it->>'qty', '')::int, nullif(v_it->>'unit', '')::numeric, v_ord)
    returning id into v_item;
    for v_s in select value from jsonb_array_elements(v_it->'svcs') loop
      if v_s->>1 = '*' then
        -- ["nhóm", "*", giá]: mọi dịch vụ đang bán trong nhóm có giá đó
        insert into public.package_item_services (item_id, service_id)
        select v_item, s.id from public.services s join public.service_categories c on c.id = s.category_id
         where c.name = v_s->>0 and s.is_active and s.price = (v_s->>2)::numeric
        on conflict do nothing;
      else
        insert into public.package_item_services (item_id, service_id)
        values (v_item, pg_temp.svc(v_s->>0, v_s->>1)) on conflict do nothing;
      end if;
    end loop;
  end loop;
end $$;

-- ---- các gói ----
-- CHĂM SÓC DA CƠ BẢN
select pg_temp.add_pkg('Chăm sóc da cơ bản 10 buổi', 4950000, null, 'Trẻ hoá toàn diện, cải thiện làn da', '[
  {"label":"10 buổi linh hoạt (dịch vụ cơ bản)","qty":10,"unit":850000,"svcs":[
    ["Basic Treatment","PURIFYING TREATMENT"],["Basic Treatment","HYDRAIN3 TREATMENT"],["Basic Treatment","ACNE TWEEZER"],
    ["Basic Treatment","LYMPHAS THERAPY"],["Basic Treatment","ENZYME POWER"],["Basic Treatment","ION BRIGHT"],["Basic Treatment","PRO CALM"],["Basic Treatment","DETOX SKIN"]]}]');
select pg_temp.add_pkg('Chăm sóc da không giới hạn 12 tháng', 16990000, 365, 'Dùng không giới hạn 7 dịch vụ cơ bản trong 12 tháng', '[
  {"label":"Không giới hạn (dịch vụ cơ bản)","qty":null,"unit":850000,"svcs":[
    ["Basic Treatment","PURIFYING TREATMENT"],["Basic Treatment","HYDRAIN3 TREATMENT"],["Basic Treatment","ACNE TWEEZER"],
    ["Basic Treatment","LYMPHAS THERAPY"],["Basic Treatment","ENZYME POWER"],["Basic Treatment","ION BRIGHT"],["Basic Treatment","PRO CALM"],["Basic Treatment","DETOX SKIN"]]}]');
select pg_temp.add_pkg('Fresh Skin', 3150000, null, 'Phục hồi, thanh lọc da', '[
  {"label":"Detox Skin","qty":3,"unit":1100000,"svcs":[["Basic Treatment","DETOX SKIN"]]},
  {"label":"Ion Bright / Pro Calm","qty":2,"unit":1100000,"svcs":[["Basic Treatment","ION BRIGHT"],["Basic Treatment","PRO CALM"]]}]');
select pg_temp.add_pkg('Recover Skin', 3780000, null, 'Phục hồi da mụn, mụn đỏ', '[
  {"label":"Enzyme Power","qty":3,"unit":1100000,"svcs":[["Basic Treatment","ENZYME POWER"]]},
  {"label":"Detox Skin","qty":3,"unit":1100000,"svcs":[["Basic Treatment","DETOX SKIN"]]}]');

-- MỤN – LỖ CHÂN LÔNG
select pg_temp.add_pkg('Acne Control Package 1', 3950000, null, 'Kiểm soát mụn cấp độ 1', '[
  {"label":"Detox Skin","qty":2,"unit":1100000,"svcs":[["Basic Treatment","DETOX SKIN"]]},
  {"label":"Peel (các loại Peel 1.900k)","qty":2,"unit":1900000,"svcs":[["Chemical Peel","*",1900000]]},
  {"label":"Light Therapy – Laser","qty":1,"unit":1900000,"svcs":[["Light Therapy","LIGHT THERAPY (PDT)"],["Laser","ACNE"]]}]');
select pg_temp.add_pkg('Acne Control Package 2', 10990000, null, 'Kiểm soát mụn cấp độ 2 (mụn bọc, viêm, ẩn, nhiễm corticoid)', '[
  {"label":"Enzyme Power","qty":3,"unit":1100000,"svcs":[["Basic Treatment","ENZYME POWER"]]},
  {"label":"Detox Skin","qty":5,"unit":1100000,"svcs":[["Basic Treatment","DETOX SKIN"]]},
  {"label":"Light Therapy – Laser","qty":2,"unit":1900000,"svcs":[["Light Therapy","LIGHT THERAPY (PDT)"],["Laser","ACNE"]]},
  {"label":"Peel / Micro Needling (các loại 1.900k)","qty":5,"unit":1900000,"svcs":[["Chemical Peel","*",1900000],["Phi kim / Microneedling","*",1900000]]}]');
select pg_temp.add_pkg('Light Package', 3150000, null, 'Điều trị mụn viêm tận gốc', '[
  {"label":"Light Therapy","qty":5,"unit":1900000,"svcs":[["Light Therapy","LIGHT THERAPY (PDT)"]]}]');
select pg_temp.add_pkg('Pore Instant Package 1', 6500000, null, 'Điều trị lỗ chân lông cấp độ 1', '[
  {"label":"Light Therapy – Laser","qty":1,"unit":1900000,"svcs":[["Laser","PORE INSTANT"],["Light Therapy","LIGHT THERAPY (PDT)"]]},
  {"label":"Peel (các loại Peel 1.900k)","qty":2,"unit":1900000,"svcs":[["Chemical Peel","*",1900000]]},
  {"label":"Micro Needling (các loại MN 1.900k)","qty":3,"unit":1900000,"svcs":[["Phi kim / Microneedling","*",1900000]]}]');

-- SÁNG DA – NÁM – TÀN NHANG
select pg_temp.add_pkg('Glow Skin', 6000000, null, 'Phục hồi làn da đều màu tự nhiên', '[
  {"label":"Laser Toning","qty":2,"unit":1900000,"svcs":[["Laser","TONING"]]},
  {"label":"Peel (các loại Peel 1.900k)","qty":2,"unit":1900000,"svcs":[["Chemical Peel","*",1900000]]},
  {"label":"Micro Needling (các loại MN 1.900k)","qty":2,"unit":1900000,"svcs":[["Phi kim / Microneedling","*",1900000]]}]');
select pg_temp.add_pkg('Glow Touch', 9900000, null, 'Điều trị tàn nhang', '[
  {"label":"Mesogun","qty":1,"unit":3850000,"svcs":[["Mesotherapy / Mesogun","GLOW MESO"]]},
  {"label":"Peel (các loại Peel 1.900k)","qty":2,"unit":1900000,"svcs":[["Chemical Peel","*",1900000]]},
  {"label":"Dark Spot Laser","qty":3,"unit":3500000,"svcs":[["Laser","DARK SPOT"]]}]');
select pg_temp.add_pkg('Glow Boost', 19000000, null, 'Điều trị nám, tàn nhang chuyên sâu', '[
  {"label":"Pigment Meso","qty":10,"unit":2500000,"svcs":[["Mesotherapy / Mesogun","DARKSPOT MESO"]]},
  {"label":"Darkspot Laser","qty":10,"unit":3500000,"svcs":[["Laser","DARK SPOT"]]}]');
select pg_temp.add_pkg('Glow Infinite', 35000000, 365, 'Điều trị nám, tàn nhang chuyên sâu', '[
  {"label":"Pigment Meso","qty":10,"unit":2500000,"svcs":[["Mesotherapy / Mesogun","DARKSPOT MESO"]]},
  {"label":"Darkspot Laser (không giới hạn trong 1 năm)","qty":null,"unit":3500000,"svcs":[["Laser","DARK SPOT"]]}]');

-- TRẺ HOÁ – CĂNG BÓNG – CẤP ẨM
select pg_temp.add_pkg('Mesogun Package 3', 9820000, null, 'Trẻ hoá, căng bóng làn da', '[
  {"label":"Mesogun","qty":3,"unit":3850000,"svcs":[["Mesotherapy / Mesogun","GLOW MESO"]]},
  {"label":"Detox Skin","qty":1,"unit":1100000,"svcs":[["Basic Treatment","DETOX SKIN"]]}]');
select pg_temp.add_pkg('Mesogun Package 5', 15400000, null, 'Trẻ hoá, căng bóng làn da', '[
  {"label":"Mesogun","qty":5,"unit":3850000,"svcs":[["Mesotherapy / Mesogun","GLOW MESO"]]},
  {"label":"Detox Skin","qty":1,"unit":1100000,"svcs":[["Basic Treatment","DETOX SKIN"]]},
  {"label":"Laser Toning","qty":1,"unit":1900000,"svcs":[["Laser","TONING"]]}]');
select pg_temp.add_pkg('Biocomplex – Mesogun x3', 10500000, null, 'Phục hồi toàn diện, cấp ẩm sâu', '[
  {"label":"Mesogun Biocomplex","qty":3,"unit":5000000,"svcs":[["Mesotherapy / Mesogun","MESO MEDISEPTE (BIOCOMPLEX)"]]},
  {"label":"Detox Skin (tặng kèm)","qty":1,"unit":0,"svcs":[["Basic Treatment","DETOX SKIN"]]}]');
select pg_temp.add_pkg('BAP Biocomplex x1', 4950000, null, 'Cấp ẩm sâu, phục hồi, chống lão hoá', '[
  {"label":"BAP Biocomplex","qty":1,"unit":8000000,"svcs":[["BAP – Tiêm trẻ hoá","BAP BIOCOMPLEX"]]}]');
select pg_temp.add_pkg('BAP Biocomplex x3', 14000000, null, 'Cấp ẩm sâu, phục hồi, chống lão hoá', '[
  {"label":"BAP Biocomplex","qty":3,"unit":8000000,"svcs":[["BAP – Tiêm trẻ hoá","BAP BIOCOMPLEX"]]}]');
select pg_temp.add_pkg('B.A.P Profhilo x2', 16000000, null, 'Phục hồi da lão hoá, cấp nước sâu', '[
  {"label":"Profhilo","qty":2,"unit":10000000,"svcs":[["BAP – Tiêm trẻ hoá","PROFHILO"]]}]');
select pg_temp.add_pkg('B.A.P Profhilo x3', 21000000, null, 'Phục hồi da lão hoá, cấp nước sâu', '[
  {"label":"Profhilo","qty":3,"unit":10000000,"svcs":[["BAP – Tiêm trẻ hoá","PROFHILO"]]}]');
select pg_temp.add_pkg('B.A.P Karisma x2', 18000000, null, 'Nâng cơ, trẻ hoá từ sâu bên trong', '[
  {"label":"Karisma","qty":2,"unit":10000000,"svcs":[["BAP – Tiêm trẻ hoá","KARISMA"]]}]');
select pg_temp.add_pkg('B.A.P Karisma x3', 24000000, null, 'Nâng cơ, trẻ hoá từ sâu bên trong', '[
  {"label":"Karisma","qty":3,"unit":10000000,"svcs":[["BAP – Tiêm trẻ hoá","KARISMA"]]}]');
select pg_temp.add_pkg('B.A.P Radiesse x2', 33600000, null, 'Làm đầy tức thì, định hình khuôn mặt', '[
  {"label":"Radiesse","qty":2,"unit":21000000,"svcs":[["BAP – Tiêm trẻ hoá","RADIESSE"]]}]');
select pg_temp.add_pkg('B.A.P Radiesse x3', 44100000, null, 'Làm đầy tức thì, định hình khuôn mặt', '[
  {"label":"Radiesse","qty":3,"unit":21000000,"svcs":[["BAP – Tiêm trẻ hoá","RADIESSE"]]}]');

-- NÂNG CƠ – HIFU
select pg_temp.add_pkg('HIFU + Karisma', 25000000, null, 'Hoà quyện rạng ngời, nâng cơ trẻ hoá', '[
  {"label":"HIFU","qty":1,"unit":35000000,"svcs":[["MPT / HIFU","HIFU FULLFACE"]]},
  {"label":"B.A.P Karisma","qty":1,"unit":10000000,"svcs":[["BAP – Tiêm trẻ hoá","KARISMA"]]}]');
select pg_temp.add_pkg('HIFU Full Face V-Lift', 35000000, 365, 'Trẻ hoá, xoá nhăn – 3 buổi/năm, cách 4–6 tháng', '[
  {"label":"HIFU Full Face","qty":3,"unit":35000000,"svcs":[["MPT / HIFU","HIFU FULLFACE"]]}]');
select pg_temp.add_pkg('HIFU trẻ hoá cấp tốc', 25900000, null, 'Trẻ hoá, xoá nhăn, đẩy lùi lão hoá', '[
  {"label":"HIFU","qty":1,"unit":35000000,"svcs":[["MPT / HIFU","HIFU FULLFACE"]]},
  {"label":"B.A.P Karisma","qty":1,"unit":10000000,"svcs":[["BAP – Tiêm trẻ hoá","KARISMA"]]},
  {"label":"Mesogun","qty":1,"unit":3850000,"svcs":[["Mesotherapy / Mesogun","GLOW MESO"]]},
  {"label":"MPT Booster","qty":1,"unit":6000000,"svcs":[["MPT / HIFU","MPT BOOSTER"]]}]');
select pg_temp.add_pkg('HIFU Intense', 25000000, null, 'Trẻ hoá, xoá nhăn, đẩy lùi lão hoá', '[
  {"label":"HIFU V-Lift Fullface","qty":1,"unit":35000000,"svcs":[["MPT / HIFU","HIFU FULLFACE"]]},
  {"label":"MPT Booster","qty":3,"unit":6000000,"svcs":[["MPT / HIFU","MPT BOOSTER"]]}]');

-- SẸO RỖ
select pg_temp.add_pkg('Scar Treatment +', 16000000, null, 'Trị sẹo đa phương thức', '[
  {"label":"Scar Therapy (cắt đáy sẹo)","qty":2,"unit":4500000,"svcs":[["Acne Scar","CẮT ĐÁY SẸO (ACNE SCAR)"]]},
  {"label":"MNRF","qty":2,"unit":6000000,"svcs":[["MNRF – Vi kim RF","MNRF INVASIVE"]]},
  {"label":"Mesotherapy","qty":1,"unit":3850000,"svcs":[["Mesotherapy / Mesogun","SCAR MESO"]]},
  {"label":"Surface Scar (các loại Peel 1.900k)","qty":3,"unit":2050000,"svcs":[["Chemical Peel","*",1900000]]}]');

-- VÙNG MẮT
select pg_temp.add_pkg('Brightening Eye x5', 4500000, null, 'Làm sáng quầng thâm, xoá nhăn vùng mắt', '[
  {"label":"Eye Mesotherapy","qty":5,"unit":1500000,"svcs":[["Eyezone","BRIGHTENING EYE MESO"]]}]');
select pg_temp.add_pkg('Eye Rejuvenature', 38000000, null, 'Xoá nhăn, làm mờ rãnh chân chim', '[
  {"label":"Eye Rejuvenation","qty":2,"unit":10000000,"svcs":[["Eyezone","ANTI-AGING EYE MESO"]]},
  {"label":"Youth Eye","qty":3,"unit":10000000,"svcs":[["Eyezone","TEOXANE EYE"]]}]');

-- TÓC – DA ĐẦU
select pg_temp.add_pkg('Hair Microneedling', 5700000, null, 'Chống rụng, kích mọc tóc cấp độ 1', '[
  {"label":"Anti Hair Lost Microneedling","qty":3,"unit":1900000,"svcs":[
    ["Hair & Scalp","ANTI HAIR LOSS MN – RADICAL"],["Hair & Scalp","ANTI HAIR LOSS MN – BIOTIN"]]},
  {"label":"Scalp Care Therapy","qty":3,"unit":1500000,"svcs":[["Hair & Scalp","OWAY BIOSCALP RESET"]]}]');
select pg_temp.add_pkg('Hair Mesotherapy', 9500000, null, 'Chống rụng, kích mọc tóc cấp độ 2', '[
  {"label":"Hair Growth Mesotherapy","qty":3,"unit":3500000,"svcs":[["Hair & Scalp","ANTI HAIR LOSS MESO"]]},
  {"label":"Scalp Care Therapy","qty":3,"unit":1500000,"svcs":[["Hair & Scalp","OWAY BIOSCALP RESET"]]}]');

do $$ begin
  if (select count(*) from public.packages) < 32 then raise exception 'Nhập thiếu gói combo'; end if;
end $$;
