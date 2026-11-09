-- =====================================================================
-- ẢNH TRƯỚC – SAU TỪNG BUỔI
-- Mỗi buổi (lịch hẹn): ảnh TRƯỚC sau khi tẩy trang = 3 góc bắt buộc (Trái / Thẳng / Phải)
--                      + tối đa 2 ảnh thêm (tổng ≤ 5);
--                      ảnh SAU khi kết thúc = 3 góc tương ứng.
-- Ảnh được nén trên điện thoại (WebP, cạnh dài 2560px) + 1 ảnh thu nhỏ (_t) để xem danh sách.
-- Bắt buộc với liệu trình có bước "Tẩy trang" trong quy trình gốc (liệu trình mặt).
-- =====================================================================

create table public.session_photos (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  phase text not null check (phase in ('before','after')),
  angle text not null check (angle in ('left','front','right','extra')),
  path text not null unique,          -- ảnh gốc đã nén; ảnh thu nhỏ = path thay ".x" bằng "_t.x"
  bytes int,
  width int,
  height int,
  taken_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (not (phase = 'after' and angle = 'extra'))
);
create unique index session_photos_one_angle on public.session_photos (appointment_id, phase, angle) where angle <> 'extra';
create index session_photos_customer on public.session_photos (customer_id, created_at desc);

alter table public.appointments
  add column photo_skip_reason text,
  add column photo_skip_by uuid references public.profiles(id),
  add column photo_skip_at timestamptz;

-- Ai được xem ảnh của 1 khách: chủ, quản lý, lễ tân; KTV đã/đang phục vụ khách đó
create or replace function public._can_view_customer_photos(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_role('owner','manager','receptionist')
      or exists (select 1 from public.appointments a
                   join public.appointment_services s on s.appointment_id = a.id
                  where a.customer_id = p_customer and s.technician_id = (select auth.uid()))
$$;
-- Ai được chụp / xoá ảnh của 1 buổi: chủ, quản lý; KTV làm buổi đó
create or replace function public._can_edit_appt_photos(p_appt uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_role('owner','manager') or public._is_my_appointment(p_appt)
$$;
-- Đường dẫn trong kho: <appointment_id>/<tên file>
create or replace function public._photo_path_appt(p_name text)
returns uuid language sql immutable set search_path = '' as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f-]{36}$' then split_part(p_name, '/', 1)::uuid end
$$;
create or replace function public._can_view_photo_path(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select public._can_view_customer_photos(a.customer_id) from public.appointments a
                    where a.id = public._photo_path_appt(p_name)), false)
$$;
revoke execute on function public._can_view_customer_photos(uuid), public._can_edit_appt_photos(uuid), public._can_view_photo_path(text) from public, anon;
grant execute on function public._can_view_customer_photos(uuid), public._can_edit_appt_photos(uuid), public._can_view_photo_path(text), public._photo_path_appt(text) to authenticated;

alter table public.session_photos enable row level security;
create policy "photos read" on public.session_photos for select to authenticated
  using ((select public._can_view_customer_photos(customer_id)));
-- ghi / xoá qua hàm add_session_photo / delete_session_photo

-- Kho ảnh RIÊNG TƯ (không có link công khai) – tối đa 4MB/ảnh
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('session-photos', 'session-photos', false, 4194304, array['image/webp','image/jpeg'])
on conflict (id) do nothing;

create policy "session photos read" on storage.objects for select to authenticated
  using (bucket_id = 'session-photos' and public._can_view_photo_path(name));
create policy "session photos insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'session-photos' and public._photo_path_appt(name) is not null
              and public._can_edit_appt_photos(public._photo_path_appt(name)));
create policy "session photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'session-photos' and public._photo_path_appt(name) is not null
         and public._can_edit_appt_photos(public._photo_path_appt(name)));

-- Lưu 1 ảnh sau khi tải lên kho. Góc chính chụp lại -> thay ảnh cũ, trả về đường dẫn ảnh cũ để xoá file.
create or replace function public.add_session_photo(p_appt uuid, p_phase text, p_angle text, p_path text,
  p_bytes int default null, p_width int default null, p_height int default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_cust uuid;
  v_status public.appointment_status;
  v_old text;
begin
  if not public._can_edit_appt_photos(p_appt) then raise exception 'Bạn chỉ chụp ảnh cho lịch mình phục vụ'; end if;
  select customer_id, status into v_cust, v_status from public.appointments where id = p_appt;
  if v_cust is null then raise exception 'Không tìm thấy lịch hẹn'; end if;
  if v_status in ('cancelled','no_show') then raise exception 'Lịch đã huỷ'; end if;
  if public._photo_path_appt(p_path) is distinct from p_appt then raise exception 'Đường dẫn ảnh không hợp lệ'; end if;
  if p_phase = 'after' and p_angle = 'extra' then raise exception 'Ảnh SAU chỉ gồm 3 góc Trái / Thẳng / Phải'; end if;

  if p_angle = 'extra' then
    if (select count(*) from public.session_photos where appointment_id = p_appt and phase = 'before') >= 5 then
      raise exception 'Ảnh TRƯỚC tối đa 5 ảnh';
    end if;
  else
    delete from public.session_photos where appointment_id = p_appt and phase = p_phase and angle = p_angle
    returning path into v_old;
  end if;

  insert into public.session_photos (appointment_id, customer_id, phase, angle, path, bytes, width, height)
  values (p_appt, v_cust, p_phase, p_angle, p_path, p_bytes, p_width, p_height);
  return v_old;
end $$;

create or replace function public.delete_session_photo(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_path text; v_appt uuid;
begin
  select path, appointment_id into v_path, v_appt from public.session_photos where id = p_id;
  if v_path is null then raise exception 'Không tìm thấy ảnh'; end if;
  if not public._can_edit_appt_photos(v_appt) then raise exception 'Bạn không có quyền xoá ảnh này'; end if;
  if not public.has_role('owner','manager')
     and exists (select 1 from public.appointments where id = v_appt and status = 'completed') then
    raise exception 'Buổi đã hoàn tất – nhờ quản lý xoá ảnh';
  end if;
  delete from public.session_photos where id = p_id;
  return v_path;
end $$;

-- Khách không đồng ý chụp / không chụp được -> KTV ghi lý do (quản lý xem được)
create or replace function public.skip_session_photos(p_appt uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public._can_edit_appt_photos(p_appt) then raise exception 'Bạn chỉ thao tác trên lịch mình phục vụ'; end if;
  update public.appointments
     set photo_skip_reason = nullif(trim(p_reason), ''),
         photo_skip_by = case when nullif(trim(p_reason), '') is null then null else (select auth.uid()) end,
         photo_skip_at = case when nullif(trim(p_reason), '') is null then null else now() end
   where id = p_appt;
end $$;

revoke execute on function public.add_session_photo(uuid, text, text, text, int, int, int),
  public.delete_session_photo(uuid), public.skip_session_photos(uuid, text) from public, anon;
grant execute on function public.add_session_photo(uuid, text, text, text, int, int, int),
  public.delete_session_photo(uuid), public.skip_session_photos(uuid, text) to authenticated;

-- Bước "Tẩy trang" đầu tiên của liệu trình (null = không bắt buộc ảnh)
create or replace function public._makeup_step(p_service uuid)
returns int language sql stable security definer set search_path = '' as $$
  select min(step_no) from public.service_procedure_steps
   where service_id = p_service and (title ilike '%tẩy trang%' or title ilike '%tây trang%')
$$;
revoke execute on function public._makeup_step(uuid) from public, anon;
grant execute on function public._makeup_step(uuid) to authenticated;

-- Tiến độ liệu trình: thêm kiểm tra ảnh
--  * Xong bước SAU bước tẩy trang -> phải có đủ 3 ảnh TRƯỚC
--  * Hoàn thành buổi (dịch vụ cuối của lịch) -> phải có đủ 3 ảnh TRƯỚC + 3 ảnh SAU
--  Bỏ qua nếu KTV đã ghi lý do không chụp; chủ / quản lý không bị chặn.
create or replace function public.ktv_progress(p_aps uuid, p_action text)
returns public.appointment_services language plpgsql security definer set search_path = '' as $$
declare
  v public.appointment_services;
  v_status public.appointment_status;
  v_total int;
  v_tt int;
  v_check boolean;
  v_before int;
  v_after int;
begin
  select * into v from public.appointment_services where id = p_aps for update;
  if not found then raise exception 'Không tìm thấy dịch vụ'; end if;
  if v.technician_id is distinct from (select auth.uid()) and not public.has_role('owner','manager') then
    raise exception 'Dịch vụ này không phải của bạn';
  end if;
  select status into v_status from public.appointments where id = v.appointment_id;
  if v_status in ('cancelled','no_show') then raise exception 'Lịch đã huỷ'; end if;
  select count(*) into v_total from public.service_procedure_steps where service_id = v.service_id;

  v_tt := public._makeup_step(v.service_id);
  v_check := v_tt is not null and not public.has_role('owner','manager')
             and (select photo_skip_reason is null from public.appointments where id = v.appointment_id);
  if v_check then
    select count(*) filter (where phase = 'before' and angle <> 'extra'),
           count(*) filter (where phase = 'after')
      into v_before, v_after
      from public.session_photos where appointment_id = v.appointment_id;
  end if;

  if p_action = 'start' then
    if v.work_started_at is null then
      update public.appointment_services
         set work_started_at = now(), steps_done = 0, step_log = '[]'::jsonb
       where id = p_aps returning * into v;
      update public.appointments
         set status = case when status in ('pending','confirmed') then 'in_progress'::public.appointment_status else status end,
             ktv_confirmed_at = coalesce(ktv_confirmed_at, now())
       where id = v.appointment_id;
    end if;
  elsif p_action = 'step' then
    if v.work_started_at is null then raise exception 'Bấm Bắt đầu trước'; end if;
    if v.work_done_at is not null then raise exception 'Buổi đã hoàn thành'; end if;
    if v.steps_done >= v_total then raise exception 'Đã xong tất cả các bước'; end if;
    if v_check and v.steps_done + 1 > v_tt and v_before < 3 then
      raise exception 'Chụp đủ 3 ảnh TRƯỚC (Trái, Thẳng mặt, Phải) sau tẩy trang rồi mới làm bước tiếp theo';
    end if;
    update public.appointment_services
       set steps_done = steps_done + 1,
           step_log = step_log || jsonb_build_array(jsonb_build_object('step', v.steps_done + 1, 'at', now()))
     where id = p_aps returning * into v;
  elsif p_action = 'undo' then
    if v.work_done_at is not null or v.steps_done = 0 then raise exception 'Không có bước để bỏ'; end if;
    update public.appointment_services
       set steps_done = steps_done - 1,
           step_log = coalesce((select jsonb_agg(e) from jsonb_array_elements(step_log) e
                                 where (e->>'step')::int <> v.steps_done), '[]'::jsonb)
     where id = p_aps returning * into v;
  elsif p_action = 'finish' then
    if v.work_started_at is null then raise exception 'Bấm Bắt đầu trước'; end if;
    if v_check and v.work_done_at is null then
      if v_before < 3 then raise exception 'Chưa đủ 3 ảnh TRƯỚC (Trái, Thẳng mặt, Phải)'; end if;
      if v_after < 3 and not exists (select 1 from public.appointment_services s
                                      where s.appointment_id = v.appointment_id and s.id <> v.id
                                        and s.is_active and s.work_done_at is null) then
        raise exception 'Chụp đủ 3 ảnh SAU (Trái, Thẳng mặt, Phải) rồi mới hoàn thành buổi';
      end if;
    end if;
    update public.appointment_services
       set work_done_at = coalesce(work_done_at, now()), steps_done = greatest(steps_done, v_total)
     where id = p_aps returning * into v;
  else
    raise exception 'Thao tác không hợp lệ';
  end if;
  return v;
end $$;
revoke execute on function public.ktv_progress(uuid, text) from public, anon;
grant execute on function public.ktv_progress(uuid, text) to authenticated;
