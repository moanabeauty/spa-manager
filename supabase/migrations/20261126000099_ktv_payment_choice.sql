-- KTV chọn cách thanh toán của khách cho từng liệu trình trong lịch:
--   combo = trừ buổi combo (customer_package_item_id = phần gói nào)
--   card  = trừ thẻ trả trước (giá member)
--   cash  = trả tiền lẻ (giá niêm yết)
--   null  = chưa chọn (lúc thu tiền theo mặc định cũ)
-- Lễ tân / quản lý thấy sẵn lựa chọn này ở màn Thu tiền (vẫn sửa được trước khi thu).

alter table public.appointment_services
  add column if not exists pay_with text check (pay_with in ('combo','card','cash')),
  add column if not exists pay_set_by uuid references public.profiles(id),
  add column if not exists pay_set_at timestamptz;

-- Giữ pay_with khớp với phần combo ở mọi nơi (đặt lịch, đổi liệu trình, quầy…)
create or replace function public._aps_pay_sync() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.customer_package_item_id is not null then
    new.pay_with := 'combo';
  elsif new.pay_with = 'combo' then
    new.pay_with := null;
  end if;
  return new;
end $$;
drop trigger if exists aps_pay_sync on public.appointment_services;
create trigger aps_pay_sync before insert or update of customer_package_item_id, pay_with
  on public.appointment_services for each row execute function public._aps_pay_sync();

update public.appointment_services set pay_with = 'combo'
 where customer_package_item_id is not null and pay_with is null;

-- Các lựa chọn thanh toán của 1 lịch (cho app KTV)
create or replace function public.ktv_payment_options(p_appt uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_cust uuid;
  v_me uuid := (select auth.uid());
  v_staff boolean := public.has_role('owner','manager','receptionist');
begin
  if not (public._is_my_appointment(p_appt) or v_staff) then
    raise exception 'Bạn chỉ xem được khách của lịch mình phục vụ';
  end if;
  select customer_id into v_cust from public.appointments where id = p_appt;
  if v_cust is null then raise exception 'Không tìm thấy lịch hẹn'; end if;
  return jsonb_build_object(
    'card', (select jsonb_build_object('code', sc.code, 'balance', coalesce(b.balance, 0))
               from public.service_cards sc
               left join public.service_card_balances b on b.card_id = sc.id
              where sc.customer_id = v_cust and sc.is_active
              order by sc.created_at limit 1),
    'invoiced', exists (select 1 from public.invoices where appointment_id = p_appt and status <> 'cancelled'),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'service_id', s.service_id,
        'label', coalesce(sv.name_en, sv.name),
        'price', sv.price, 'member_price', sv.member_price,
        'card_ok', sv.card_allowed and sv.member_price is not null,
        'pay_with', s.pay_with, 'item_id', s.customer_package_item_id,
        'done', s.work_done_at is not null,
        'editable', (v_staff or s.technician_id is null or s.technician_id = v_me)
                    and not exists (select 1 from public.invoice_items ii where ii.appointment_service_id = s.id),
        'combos', coalesce((select jsonb_agg(jsonb_build_object(
              'item_id', i.id, 'package', p.name, 'label', i.label,
              'left', case when i.total_qty is null then null else i.total_qty - i.used_qty end)
              order by cp.purchased_at, i.sort_order)
            from public.customer_package_items i
            join public.customer_packages cp on cp.id = i.customer_package_id
            join public.packages p on p.id = cp.package_id
            join public.customer_package_item_services x on x.item_id = i.id and x.service_id = s.service_id
           where cp.customer_id = v_cust and cp.is_active
             and (cp.expires_at is null or cp.expires_at > now())
             and (i.total_qty is null or i.used_qty < i.total_qty or i.id = s.customer_package_item_id)
             and public.package_item_warranty_ok(i.id)), '[]'::jsonb)
      ) order by s.start_at)
      from public.appointment_services s join public.services sv on sv.id = s.service_id
     where s.appointment_id = p_appt and s.is_active), '[]'::jsonb)
  );
end $$;
revoke execute on function public.ktv_payment_options(uuid) from public, anon;
grant execute on function public.ktv_payment_options(uuid) to authenticated;

-- KTV / lễ tân / quản lý chọn cách thanh toán cho 1 liệu trình
create or replace function public.ktv_set_payment(p_aps uuid, p_pay text, p_item uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_row public.appointment_services;
  v_appt public.appointments;
  v_svc public.services;
  v_me uuid := (select auth.uid());
  v_staff boolean := public.has_role('owner','manager','receptionist');
  v_left int; v_used_here int;
begin
  if p_pay not in ('combo','card','cash') then raise exception 'Cách thanh toán không hợp lệ'; end if;
  select * into v_row from public.appointment_services where id = p_aps and is_active for update;
  if not found then raise exception 'Không tìm thấy liệu trình'; end if;
  select * into v_appt from public.appointments where id = v_row.appointment_id;
  if not (v_staff or (public._is_my_appointment(v_appt.id)
          and (v_row.technician_id is null or v_row.technician_id = v_me))) then
    raise exception 'Chỉ KTV làm liệu trình này (hoặc lễ tân / quản lý) mới chọn được cách thanh toán';
  end if;
  if v_appt.status in ('cancelled','no_show') then raise exception 'Lịch đã huỷ'; end if;
  if exists (select 1 from public.invoice_items where appointment_service_id = p_aps)
     or exists (select 1 from public.invoices where appointment_id = v_appt.id and status <> 'cancelled') then
    raise exception 'Lịch đã thu tiền – báo lễ tân / quản lý sửa hoá đơn';
  end if;
  select * into v_svc from public.services where id = v_row.service_id;

  if p_pay = 'combo' then
    if p_item is null then raise exception 'Chọn combo để trừ buổi'; end if;
    if not exists (
      select 1 from public.customer_package_items i
        join public.customer_packages cp on cp.id = i.customer_package_id
        join public.customer_package_item_services x on x.item_id = i.id and x.service_id = v_row.service_id
       where i.id = p_item and cp.customer_id = v_appt.customer_id and cp.is_active
         and (cp.expires_at is null or cp.expires_at > now())
         and public.package_item_warranty_ok(i.id)) then
      raise exception 'Combo này không dùng được cho liệu trình đã chọn (hết hạn / không có liệu trình này)';
    end if;
    select case when total_qty is null then null else total_qty - used_qty end into v_left
      from public.customer_package_items where id = p_item;
    if v_left is not null then
      select count(*) into v_used_here from public.appointment_services
       where customer_package_item_id = p_item and is_active and work_done_at is null and id <> p_aps
         and not exists (select 1 from public.invoice_items ii where ii.appointment_service_id = appointment_services.id);
      if v_left - v_used_here <= 0 then raise exception 'Combo này đã hết buổi'; end if;
    end if;
  elsif p_pay = 'card' then
    if not (v_svc.card_allowed and v_svc.member_price is not null) then
      raise exception 'Liệu trình này không có giá member – không trừ thẻ được';
    end if;
    if not exists (select 1 from public.service_cards where customer_id = v_appt.customer_id and is_active) then
      raise exception 'Khách chưa có thẻ trả trước';
    end if;
  end if;

  update public.appointment_services
     set customer_package_item_id = case when p_pay = 'combo' then p_item else null end,
         pay_with = p_pay, pay_set_by = v_me, pay_set_at = now()
   where id = p_aps;
end $$;
revoke execute on function public.ktv_set_payment(uuid, text, uuid) from public, anon;
grant execute on function public.ktv_set_payment(uuid, text, uuid) to authenticated;
