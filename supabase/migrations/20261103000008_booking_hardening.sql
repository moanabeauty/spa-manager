-- Chuẩn bị cho giao diện đặt lịch (giai đoạn 2)

-- 1. Ẩn giá vốn và tiền dịch vụ KTV khỏi khách / người chưa đăng nhập.
--    Bảng services vẫn đọc công khai nhưng chỉ các cột dưới đây.
revoke select on public.services from anon, authenticated;
grant select (id, category_id, name, name_en, description, duration_minutes, price, member_price,
              card_allowed, is_active, created_at, branch_id, commission_eligible)
  on public.services to anon, authenticated;

-- nhân viên xem giá vốn + tiền KTV qua hàm này
create or replace function public.service_internal_costs()
returns table (service_id uuid, cost numeric, technician_fee numeric)
language sql stable security definer set search_path = '' as $$
  select id, cost, technician_fee from public.services where public.is_staff()
$$;
revoke execute on function public.service_internal_costs() from public, anon;
grant execute on function public.service_internal_costs() to authenticated;

-- 2. Dịch vụ "báo giá theo thực tế" (giá null) vẫn đặt lịch được
alter table public.appointment_services alter column price drop not null;

-- 3. Khách tự đặt: giá / tiền KTV luôn lấy từ bảng dịch vụ, không cho khách tự ghi
create or replace function public.appointment_services_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_svc record;
  v_appt record;
  v_pkg record;
begin
  select * into v_svc from public.services where id = new.service_id;
  select * into v_appt from public.appointments where id = new.appointment_id;
  if tg_op = 'INSERT' then
    new.start_at := coalesce(new.start_at, v_appt.start_at);
    if public.is_staff() then
      new.price := coalesce(new.price, v_svc.price);
      new.technician_fee := coalesce(new.technician_fee, v_svc.technician_fee);
    else
      new.price := v_svc.price;
      new.technician_fee := v_svc.technician_fee;
    end if;
  end if;
  new.end_at := coalesce(new.end_at, new.start_at + make_interval(mins => v_svc.duration_minutes));
  new.is_active := v_appt.status not in ('cancelled','no_show');

  if new.customer_package_id is not null
     and (tg_op = 'INSERT' or new.customer_package_id is distinct from old.customer_package_id) then
    select cp.customer_id, cp.is_active, cp.expires_at, cps.total_qty, cps.used_qty
      into v_pkg
      from public.customer_packages cp
      join public.customer_package_services cps on cps.customer_package_id = cp.id and cps.service_id = new.service_id
     where cp.id = new.customer_package_id;
    if not found then raise exception 'Gói của khách không có dịch vụ này'; end if;
    if v_pkg.customer_id <> v_appt.customer_id then raise exception 'Gói không thuộc khách hàng của lịch hẹn'; end if;
    if not v_pkg.is_active or (v_pkg.expires_at is not null and v_pkg.expires_at < new.start_at) then
      raise exception 'Gói đã hết hạn hoặc bị khoá';
    end if;
    if v_pkg.used_qty >= v_pkg.total_qty then raise exception 'Gói đã dùng hết số buổi cho dịch vụ này'; end if;
  end if;
  return new;
end $$;
revoke execute on function public.appointment_services_before_write() from public, anon, authenticated;

-- 4. Khách không đặt lịch vào thời điểm đã qua
drop policy "customer book online" on public.appointments;
create policy "customer book online" on public.appointments for insert to authenticated
  with check (customer_id = (select public.my_customer_id()) and status = 'pending'
              and source = 'online' and start_at > now());

-- 5. Tài khoản mới: chỉ tự nối vào hồ sơ khách cũ khi SĐT đã được xác minh (OTP).
--    SĐT tự khai lúc đăng ký mà trùng khách cũ -> tạo hồ sơ mới không SĐT, ghi chú để lễ tân gộp,
--    tránh người lạ nhập SĐT của khách khác để xem gói / thẻ của họ.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), new.email);
  v_verified_phone text := case when new.phone_confirmed_at is not null then nullif(new.phone, '') end;
  v_phone text := coalesce(v_verified_phone, nullif(trim(new.raw_user_meta_data->>'phone'), ''));
begin
  insert into public.profiles (id, full_name, phone, role) values (new.id, v_name, v_phone, 'customer');

  if v_verified_phone is not null then
    update public.customers set profile_id = new.id
     where phone = v_verified_phone and profile_id is null;
    if found then return new; end if;
  end if;

  if v_phone is not null and exists (select 1 from public.customers where phone = v_phone) then
    insert into public.customers (profile_id, full_name, phone, email, note)
    values (new.id, coalesce(v_name, 'Khách hàng'), null, new.email,
            'Đăng ký online với SĐT ' || v_phone || ' (trùng hồ sơ khách đã có, cần lễ tân kiểm tra và gộp)');
  else
    insert into public.customers (profile_id, full_name, phone, email)
    values (new.id, coalesce(v_name, 'Khách hàng'), v_phone, new.email);
  end if;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
