-- Sửa dữ liệu theo sheet "KIỂM KHO LẦN ĐẦU" (13/11/2026): gộp / tách mã, đổi sang tính theo ống, nhập lại tồn đầu kỳ KK261113-0005
-- (Kho liệu trình – Moana Lưu Quang Vũ). Chạy 1 lần.
create or replace function pg_temp.fix_opening(p_id uuid, p_full int, p_open numeric[])
returns void language plpgsql as $$
declare
  c_wh constant uuid := '82107498-cd8c-4165-a00c-a19aebf4ec42';
  c_count constant uuid := '6dee7553-4a82-4a05-aadc-d6645ea52804';
  c_code constant text := 'KK261113-0005';
  v_cnt record; p record; q numeric; v_sys int;
begin
  select * into v_cnt from public.stock_counts where id = c_count;
  select * into p from public.products where id = p_id;
  -- bỏ dòng tồn đầu kỳ cũ của mã này, ghi lại theo số mới
  delete from public.stock_movements where product_id = p_id and warehouse_id = c_wh and note like 'Kiểm đầu kỳ ' || c_code || '%';
  select coalesce(sum(quantity), 0) into v_sys from public.stock_movements where product_id = p_id and warehouse_id = c_wh;
  if p_full - v_sys <> 0 then
    insert into public.stock_movements (warehouse_id, product_id, movement_type, quantity, unit_cost, note, created_by, created_at)
    values (c_wh, p_id, 'adjustment', p_full - v_sys, case when p_full > v_sys then p.cost_price end,
            'Kiểm đầu kỳ ' || c_code || ' (sửa đơn vị theo kiểm lại 13/11)', v_cnt.created_by, v_cnt.created_at);
  end if;
  insert into public.stock_count_items (count_id, product_id, system_qty, counted_qty) values (c_count, p_id, v_sys, p_full)
  on conflict (count_id, product_id) do update set system_qty = excluded.system_qty, counted_qty = excluded.counted_qty;

  delete from public.opened_items where product_id = p_id and warehouse_id = c_wh and status = 'open';
  delete from public.stock_count_opened where count_id = c_count and product_id = p_id;
  foreach q in array coalesce(p_open, '{}') loop
    insert into public.stock_count_opened (count_id, product_id, remaining_pct) values (c_count, p_id, round(q / p.volume * 100, 2));
    insert into public.opened_items (warehouse_id, product_id, remaining_pct, remaining_qty, source, count_id, unit_cost, opened_by, opened_at)
    values (c_wh, p_id, round(q / p.volume * 100, 2), q, 'opening', c_count, round(coalesce(p.cost_price, 0) * q / p.volume), v_cnt.created_by, v_cnt.created_at);
  end loop;
end $$;

do $$
declare v_bha uuid; v_ha uuid; v_gel uuid; v_nano uuid; s record;
begin
  -- 1. Gộp mã
  perform public._merge_products_core('810c9335-dbbe-4833-ad5d-54a5a0b514a4', '6fe3f994-a6cb-4245-b665-1b534991492a'); -- bộ dụng cụ
  update public.products set name = 'BỘ DỤNG CỤ KHẤU HAO' where id = '810c9335-dbbe-4833-ad5d-54a5a0b514a4';
  update public.service_step_items set product_name = 'BỘ DỤNG CỤ KHẤU HAO' where product_id = '810c9335-dbbe-4833-ad5d-54a5a0b514a4';
  perform public._merge_products_core('3604df09-9c17-4ae5-9620-90f45400bcc5', '97b881d4-69bb-499e-bf5d-1f47ccdc33c2'); -- CPU gel
  perform public._merge_products_core('62460ec2-6162-4958-a2b9-a93c8dadc216', '46b01d1c-f4a4-4f70-8dc9-6955049b32a4'); -- micellar
  perform public._merge_products_core('40c9a0d2-8a74-46ba-8224-b09b333658ce', '44f6ab19-da1b-4f3b-a15f-a38ef4fbadc9'); -- pure biodymic

  -- 2. Tách Detox 1-2-3 → AHA / BHA / HA
  update public.products set name = 'DUNG DỊCH DETOX AHA', capacity = '500ml' where id = 'cb27208b-953d-419c-ac2d-884c0d235026';
  insert into public.products (name, brand, unit, capacity, volume, category, cost_price, for_treatment, for_retail)
  select 'DUNG DỊCH DETOX BHA', brand, unit, '500ml', 500, category, cost_price, true, false from public.products where id = 'cb27208b-953d-419c-ac2d-884c0d235026'
  returning id into v_bha;
  insert into public.products (name, brand, unit, capacity, volume, category, cost_price, for_treatment, for_retail)
  select 'DUNG DỊCH DETOX HA', brand, unit, '500ml', 500, category, cost_price, true, false from public.products where id = 'cb27208b-953d-419c-ac2d-884c0d235026'
  returning id into v_ha;
  -- Vortex: 4 lần × 10ml, mỗi lần KTV chọn AHA / BHA / HA (tổng 40ml)
  select * into s from public.service_step_items where product_id = 'cb27208b-953d-419c-ac2d-884c0d235026' limit 1;
  update public.service_step_items set qty = 10, product_name = 'DUNG DỊCH DETOX AHA', alt_product_ids = array[v_bha, v_ha] where id = s.id;
  insert into public.service_step_items (service_id, step_no, sort, product_name, product_id, qty, alt_product_ids)
  select s.service_id, s.step_no, coalesce(s.sort, 0) + g, 'DUNG DỊCH DETOX AHA', 'cb27208b-953d-419c-ac2d-884c0d235026', 10, array[v_bha, v_ha]
    from generate_series(1, 3) g;

  -- 3. Tách EYEZONE Fluid / Gel
  update public.products set name = 'EYEZONE Fluid' where id = '080f42a0-d200-465e-9c67-72632efe2d90';
  insert into public.products (name, brand, unit, capacity, volume, category, cost_price, for_treatment, for_retail)
  select 'EYEZONE Gel', brand, unit, capacity, volume, category, cost_price, true, false from public.products where id = '080f42a0-d200-465e-9c67-72632efe2d90'
  returning id into v_gel;
  update public.service_step_items set product_name = 'EYEZONE Fluid', alt_product_ids = array_append(alt_product_ids, v_gel)
   where product_id = '080f42a0-d200-465e-9c67-72632efe2d90';

  -- 4. Mã mới
  insert into public.products (name, unit, capacity, volume, category, for_treatment, for_retail)
  values ('ĐẦU PHI KIM NANO', 'cái', '1 cái', 1, 'TÊ - GEL - VẬT TƯ TIÊU HAO', true, false) returning id into v_nano;

  -- 5. Đổi sang tính theo đơn vị lẻ (giá vốn mỗi ống)
  update public.products p set unit = v.unit, volume = v.vol, pack_size = v.pack,
         capacity = public.pack_capacity(v.unit, v.vol, v.pack), cost_price = v.cost
    from (values
      ('e96b9b79-6d88-42d6-8376-305bc71c1f63'::uuid, 'ống', 2.5, 10, 370000),   -- EXOMAGE
      ('605be953-d12f-463b-b317-8aa74a06b461', 'ống', 10, 5, 460600),           -- FACNE FUSION
      ('52d519fa-f247-4baf-9c53-58ad093ffadd', 'ống', 5, 5, 522524),            -- FUSION MESOMATRIX
      ('f5ba0b72-9000-419e-b7ad-3e87f92f5019', 'ống', 5, 5, 152000),            -- INNO RECOVERY
      ('956a9617-a313-4a73-88f3-a67cc2eae0e9', 'ống', 5, 10, 159000),           -- LACTIC PEEL
      ('d65147d2-bcbe-4b60-acc7-32494bd7189f', 'ống', 5, 5, 380000),            -- LAPUROON
      ('92948412-fb33-4556-a313-f0ef712790ba', 'ống', 10, 8, 697500),           -- MEDISEPTE
      ('a9f80f63-21d2-44f3-a053-5c4b936d0653', 'ống', 2, 6, 225000),            -- INNO Meline
      ('a4ec4116-4d6b-4d2e-8cea-ee7c1cb0047b', 'ống', 5, null, 137000),         -- RADICAL
      ('ccd330b6-3b71-4355-8bb6-547613ffee05', 'ống', 2.5, 4, 200000),          -- REDNESS ID
      ('adfc10d8-a0e9-4c30-9b14-a8b4deea2400', 'ống', 2, 6, 133333),            -- REDNESS PEEL
      ('36cd6111-a746-4250-b762-1bc594ef6219', 'ống', 5, 5, 1536000),           -- SKIN GENUITY HAIR
      ('a344337a-3cf5-4247-b5fa-d5ba8eadfc3c', 'ống', 5, null, null),           -- TCAge INNO
      ('b46abc5b-f990-4c3b-9284-bc42bfde1e23', 'set', 1, 4, 245000),            -- EYEZONE Patch
      ('390e434d-c9ea-44b0-9ab5-7090795731a0', 'cặp', 1, 100, 500)              -- Mặt nạ mắt thường
    ) as v(id, unit, vol, pack, cost)
   where p.id = v.id;

  -- 6. Tồn đầu kỳ: số nguyên + các ống / chai dở (ml)
  perform pg_temp.fix_opening('cb27208b-953d-419c-ac2d-884c0d235026', 0, array[400]);       -- Detox AHA
  perform pg_temp.fix_opening(v_bha, 1, array[400]);
  perform pg_temp.fix_opening(v_ha, 0, array[450, 450]);
  perform pg_temp.fix_opening('080f42a0-d200-465e-9c67-72632efe2d90', 0, array[7.5]);       -- Eyezone Fluid 1/4
  perform pg_temp.fix_opening(v_gel, 0, array[7.5]);
  perform pg_temp.fix_opening('b46abc5b-f990-4c3b-9284-bc42bfde1e23', 8, null);             -- Eyezone Patch
  perform pg_temp.fix_opening(v_nano, 21, null);
  perform pg_temp.fix_opening('e96b9b79-6d88-42d6-8376-305bc71c1f63', 1, array[0.833]);     -- Exomage 1 + 1/3
  perform pg_temp.fix_opening('605be953-d12f-463b-b317-8aa74a06b461', 2, array[5]);         -- F Acne 2 + 1/2
  perform pg_temp.fix_opening('52d519fa-f247-4baf-9c53-58ad093ffadd', 4, null);             -- Mesomatrix
  perform pg_temp.fix_opening('f5ba0b72-9000-419e-b7ad-3e87f92f5019', 0, array[4, 4]);      -- Inno Recovery 2 ống dở 4ml
  perform pg_temp.fix_opening('956a9617-a313-4a73-88f3-a67cc2eae0e9', 8, array[2.5]);       -- Lactic 8 + 1/2
  perform pg_temp.fix_opening('d65147d2-bcbe-4b60-acc7-32494bd7189f', 8, array[1.25]);      -- Lapuroon 8 + 1/4
  perform pg_temp.fix_opening('92948412-fb33-4556-a313-f0ef712790ba', 6, array[1]);         -- Medisepte 6 + gần hết
  perform pg_temp.fix_opening('a9f80f63-21d2-44f3-a053-5c4b936d0653', 3, null);             -- Inno Meline
  perform pg_temp.fix_opening('a4ec4116-4d6b-4d2e-8cea-ee7c1cb0047b', 3, null);             -- Radical
  perform pg_temp.fix_opening('ccd330b6-3b71-4355-8bb6-547613ffee05', 2, null);             -- Redness ID
  perform pg_temp.fix_opening('adfc10d8-a0e9-4c30-9b14-a8b4deea2400', 1, null);             -- Redness Peel
  perform pg_temp.fix_opening('36cd6111-a746-4250-b762-1bc594ef6219', 8, array[2.5, 2.5]);  -- Skin Genuity 8 + 2×1/2
  perform pg_temp.fix_opening('a344337a-3cf5-4247-b5fa-d5ba8eadfc3c', 0, array[2.5]);       -- TCAge 1/2
  perform pg_temp.fix_opening('390e434d-c9ea-44b0-9ab5-7090795731a0', 90, null);            -- Mặt nạ mắt 90 cặp
end $$;
