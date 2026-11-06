-- Nhân viên xin sửa công khi quên chấm vào / ra; quản lý duyệt -> ghi vào bảng chấm công
-- (quản lý duyệt thì ngày công vẫn chờ chủ spa duyệt như khi quản lý sửa tay)
create table if not exists public.attendance_fix_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  work_date date not null,
  check_in time,
  check_out time,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists attendance_fix_requests_pending_idx on public.attendance_fix_requests (status) where status = 'pending';
alter table public.attendance_fix_requests enable row level security;
create policy "own or management read" on public.attendance_fix_requests for select
  using (staff_id = (select auth.uid()) or (select public.has_role('owner','manager')));

create or replace function public.request_attendance_fix(p_date date, p_in text, p_out text, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_in time := nullif(trim(p_in), '')::time;
  v_out time := nullif(trim(p_out), '')::time;
begin
  if not public.is_staff() then raise exception 'Chỉ nhân viên'; end if;
  if p_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'Không xin sửa công cho ngày chưa tới'; end if;
  if p_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date - 31 then raise exception 'Chỉ xin sửa công trong 31 ngày gần nhất'; end if;
  if v_in is null and v_out is null then raise exception 'Ghi giờ vào hoặc giờ ra'; end if;
  if v_in is not null and v_out is not null and v_out <= v_in then raise exception 'Giờ ra phải sau giờ vào'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Vui lòng ghi lý do'; end if;
  insert into public.attendance_fix_requests (staff_id, work_date, check_in, check_out, reason)
  values ((select auth.uid()), p_date, v_in, v_out, trim(p_reason))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.request_attendance_fix(date, text, text, text) from public, anon;
grant execute on function public.request_attendance_fix(date, text, text, text) to authenticated;

create or replace function public.review_attendance_fix(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.attendance_fix_requests;
  cur public.staff_attendance;
  v_in timestamptz;
  v_out timestamptz;
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ chủ spa / quản lý duyệt'; end if;
  select * into r from public.attendance_fix_requests where id = p_id and status = 'pending' for update;
  if not found then raise exception 'Yêu cầu đã được xử lý'; end if;
  if p_approve then
    select * into cur from public.staff_attendance where staff_id = r.staff_id and work_date = r.work_date;
    v_in := coalesce((r.work_date + r.check_in) at time zone 'Asia/Ho_Chi_Minh', cur.check_in);
    v_out := coalesce((r.work_date + r.check_out) at time zone 'Asia/Ho_Chi_Minh', cur.check_out);
    if v_in is null then raise exception 'Chưa có giờ vào cho ngày này'; end if;
    perform public.save_attendance(r.staff_id, r.work_date, v_in, v_out, 'Quên chấm công: ' || r.reason);
  end if;
  update public.attendance_fix_requests
     set status = case when p_approve then 'approved' else 'rejected' end, reviewed_by = (select auth.uid()), reviewed_at = now()
   where id = p_id;
end $$;
revoke execute on function public.review_attendance_fix(uuid, boolean) from public, anon;
grant execute on function public.review_attendance_fix(uuid, boolean) to authenticated;
