-- Combo theo cột "HIỂN THỊ TRÊN APP" của sheet COMBO (11/11/2026)
--   Public  = khách đã đăng ký tài khoản xem được trên Menu Combo
--   Private = chỉ nhân viên công ty xem được
-- Khách đã mua một gói Private vẫn xem được gói đó (trong tài khoản của mình).

alter table public.packages
  add column if not exists menu_tier text not null default 'private';
alter table public.packages drop constraint if exists packages_menu_tier_check;
alter table public.packages add constraint packages_menu_tier_check check (menu_tier in ('public','private'));
grant select (menu_tier) on public.packages to anon, authenticated;
grant update (menu_tier) on public.packages to authenticated;

update public.packages set menu_tier = 'private';
update public.packages set menu_tier = 'public' where name in (
  'SEASONAL COMBO', 'DA ĐẸP CẢ NĂM', 'FRESH SKIN', 'RECOVER SKIN',
  'ACNE CONTROL PACKAGE 1', 'ACNE CONTROL PACKAGE 2', 'PORE INSTANT PACKAGE 1',
  'GLOW SKIN', 'HAIR MICRONEEDLING'
);

-- Gói khách đang sở hữu
create or replace function public.my_package_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select cp.package_id from public.customer_packages cp where cp.customer_id = public.my_customer_id()
$$;
grant execute on function public.my_package_ids() to authenticated;

alter policy "public read" on public.packages
  using (
    (menu_tier = 'public' and (select auth.uid()) is not null)
    or (select public.is_staff())
    or id in (select public.my_package_ids())
  );
-- Tên buổi chỉ đọc được khi đọc được gói
alter policy "public read" on public.package_items
  using (package_id in (select id from public.packages));

-- Tên buổi truyền thông + thực tế chỉ định theo sheet (bản cập nhật 11/11/2026)
do $$
declare v_pkg uuid; v_item uuid;
begin
  -- PORE INSTANT PACKAGE 1
  select id into v_pkg from public.packages where name = 'PORE INSTANT PACKAGE 1';
  select id into v_item from public.package_items where package_id = v_pkg and sort_order = 2;
  update public.package_items set label = 'Acne Peeling' where id = v_item;
  insert into public.package_item_notes (item_id, note)
    values (v_item, 'Được lựa chọn liệu trình peel bất kì trong nhóm Chemical Peeling')
    on conflict (item_id) do update set note = excluded.note;
  select id into v_item from public.package_items where package_id = v_pkg and sort_order = 3;
  update public.package_items set label = 'Acne MTS' where id = v_item;
  insert into public.package_item_notes (item_id, note)
    values (v_item, 'Được lựa chọn liệu trình peel bất kì trong nhóm Phi Kim MTS')
    on conflict (item_id) do update set note = excluded.note;

  -- MESOGUN PACKAGE 5: thực tế chỉ định = "Mesogun" (trùng tên buổi → bỏ ghi chú riêng)
  select id into v_pkg from public.packages where name = 'MESOGUN PACKAGE 5';
  delete from public.package_item_notes
   where item_id in (select id from public.package_items where package_id = v_pkg and sort_order = 1);
end $$;
