-- Menu theo cột "HIỂN THỊ APP" của sheet Menu:
--   Public  = mọi khách đã có tài khoản (đã đăng nhập) đều xem và đặt được
--   Private = chỉ nội bộ nhân viên xem (khách không thấy, kể cả khách đã mua gói)
-- + Khách tự đặt "Chưa chọn liệu trình – Đặt lịch tư vấn" trên trang Đặt lịch.

-- 1. Đổi cấp 'members' thành 'private'
alter table public.services drop constraint if exists services_menu_tier_check;
update public.services set menu_tier = 'private' where menu_tier <> 'public';
alter table public.services
  alter column menu_tier set default 'private',
  add constraint services_menu_tier_check check (menu_tier in ('public','private'));

-- 2. Đồng bộ theo sheet Menu (07/11/2026): 39 dịch vụ Public, còn lại Private
update public.services set menu_tier = 'private';
update public.services set menu_tier = 'public' where id in (
  -- Essential / Basic Treatment
  'fed5dda1-6e04-4180-abe6-321a6ebec39c','9fa8c463-15b8-41b9-af87-f2e099e2b6dc','d2de3110-438f-4d0c-8e58-3f8c3f25fc61',
  '80db4f4d-ecdc-4e79-a3ba-3a047a8b5c73','6d05544f-e4b7-40ae-baad-7c42056cbc9e','855e0cc1-3174-47a6-bb8d-92374f32f6b8',
  'a9f1430e-d9e3-4de2-90fe-abc2a5de44dc','3e6274d7-45d7-4543-bac2-c80bdf8b6ec3',
  -- Biologique Recherche
  '7d7c52ce-16f9-4472-9a18-543b37e3176c','339a1b0d-4b4a-4704-9b96-c0ddcea20c4c','c233d5c7-1238-4255-9bb2-a9f1d539b171',
  '34db4dba-ca21-441e-aa74-8346647276f9','2dee3058-12ce-4865-851f-1987a47700e6','d0f52844-f2be-41d8-a7a3-cf687703a68e',
  'cae79249-f24a-4282-bbec-7a4039a01b84','5a540be0-8bc8-4c6a-9264-cbb4ce8efdb1','b3802162-6997-44cf-98a1-1953b44bb8c9',
  -- Phi kim / MTS + Superjection
  'a4fb7c8b-df21-4160-b2f4-813cbfcad0b7','62cbf8d4-74b0-4ead-867e-3a46132b7d82','0f7c1e2d-a557-4244-b9a4-d803ebb42751',
  'c3cb1b34-23e5-47e2-b8c8-a5760310a111','93b5bb73-d59e-4928-bb79-e85451942ebd','cd1709ad-1323-4e18-9b04-114e04f20685',
  -- Eyezone: Eye Firm (RF), Eye Lift (HIFU), Thermo Eye
  '46799551-4f67-4379-9190-a24387930327','c103c7ae-b67a-486e-992d-ba14527aa601','6114e4d9-9972-440e-9524-0518361e52dd',
  -- Body: White Body Peel, Aftersun, Acne Body Peel
  '1a58b2d1-c5df-42bd-9108-8eda5b01cc3a','22202777-2649-46b5-b779-aea864e15f5d','e9d30640-64b1-4105-b322-0f3b58dd7858',
  -- Hair & Scalp: Oway Bioscalp, Oway Hairwash, Anti Hair Loss MTS (Radical)
  '18f46a51-04fe-46ae-87f1-50d968fc038b','1568b602-f7cf-4cdd-8d11-50becec05277','fc24021d-491e-48fe-be71-13eb7306636f',
  -- Triệt lông
  '2054246a-20b8-4a06-b024-1ee6d2cfac64','7924b748-be91-40e8-89b1-97f9ee46872f','303f294a-9314-4bfe-9a27-e15aaad92bd5',
  'e1c59c7b-3d68-47e7-888d-1782d306f696','71ec4131-c04b-436b-b002-03b8260c90fb','756a59a5-d5ea-4581-9798-8a4a7b8742d1',
  'f0d082b7-cff7-434f-ae29-9287e6723b75'
);

-- 3. Ai đọc được dịch vụ
--    Public: người đã đăng nhập; Private: chỉ nhân viên.
--    Khách vẫn thấy tên dịch vụ đã từng đặt / có trong gói của mình (để lịch sử, gói không bị trống tên).
create or replace function public.my_visible_private_service_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select aps.service_id
    from public.appointment_services aps
    join public.appointments a on a.id = aps.appointment_id
   where a.customer_id = public.my_customer_id()
  union
  select pis.service_id
    from public.customer_packages cp
    join public.package_items pi on pi.package_id = cp.package_id
    join public.package_item_services pis on pis.item_id = pi.id
   where cp.customer_id = public.my_customer_id()
$$;
revoke execute on function public.my_visible_private_service_ids() from public;
grant execute on function public.my_visible_private_service_ids() to authenticated;

alter policy "public read" on public.services
  using ((menu_tier = 'public' and (select auth.uid()) is not null)
         or (select public.is_staff())
         or id in (select public.my_visible_private_service_ids()));

-- nhóm dịch vụ: khách chỉ thấy nhóm có dịch vụ mình xem được (nhóm toàn Private bị ẩn hẳn)
alter policy "public read" on public.service_categories
  using ((select public.is_staff())
         or exists (select 1 from public.services s where s.category_id = service_categories.id));

-- 4. Khách tự đặt online: chỉ dịch vụ Public
create or replace function public.appointment_services_tier_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_tier text;
begin
  if public.is_staff() then return new; end if;
  select menu_tier into v_tier from public.services where id = new.service_id;
  if v_tier is distinct from 'public' then
    raise exception 'Dịch vụ này cần chuyên viên tư vấn trước. Vui lòng chọn "Chưa chọn liệu trình – Đặt lịch tư vấn".';
  end if;
  return new;
end $$;
revoke execute on function public.appointment_services_tier_check() from public, anon, authenticated;

-- 5. Khách đặt lịch tư vấn: được tạo lịch is_consultation = true, nhưng không được tự chọn KTV
alter policy "customer book online" on public.appointments
  with check (customer_id = (select public.my_customer_id())
              and status = 'pending'::public.appointment_status
              and source = 'online'::public.booking_source
              and start_at > now()
              and consult_technician_id is null
              and ktv_confirmed_at is null);
