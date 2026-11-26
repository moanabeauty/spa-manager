-- Tạo hồ sơ khách ngay khi lên đơn online / bán hàng (không cần tạo lịch hẹn)
create or replace function public.staff_create_customer(p_name text, p_phone text, p_branch uuid)
returns table (id uuid, full_name text, phone text, note text, code text)
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.has_role('owner','manager','receptionist','technician','warehouse') then
    raise exception 'Bạn không có quyền tạo khách';
  end if;
  v_id := public._booking_customer(null, p_name, nullif(trim(p_phone), ''), p_branch);
  return query
    select c.id, c.full_name,
           case when public.has_role('owner','manager','receptionist') then c.phone end,
           c.note, c.code
      from public.customers c where c.id = v_id;
end $$;
revoke execute on function public.staff_create_customer(text, text, uuid) from public, anon;
grant execute on function public.staff_create_customer(text, text, uuid) to authenticated;
