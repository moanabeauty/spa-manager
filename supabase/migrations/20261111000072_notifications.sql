-- Thông báo trong app + đẩy lên điện thoại (ting ting) cho mọi sự kiện quan trọng:
--   * Có khách đặt lịch / lịch chờ nhận / KTV được giao khách / lịch bị huỷ
--   * Có yêu cầu cần duyệt (giảm giá, cho nợ, đổi sản phẩm, chấm công, tăng ca, nghỉ phép,
--     phiếu thu chi, xin xuất kho, kiểm kho, nhập hàng, đăng ký khuyến mãi, bài marketing)
--   * Kết quả duyệt báo lại cho người gửi yêu cầu
-- Cơ sở dữ liệu tự tạo thông báo (trigger) -> pg_net gọi /api/thong-bao/day trên Vercel -> gửi Web Push.
-- KHÔNG bao giờ đưa SĐT khách vào nội dung thông báo.

create extension if not exists pg_net;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- địa chỉ app + mã bí mật dùng chung với Vercel (biến môi trường PUSH_WEBHOOK_SECRET)
create table if not exists private.push_config (key text primary key, value text not null);

-- ========== Bảng thông báo ==========
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,                 -- booking / approval / result / ...
  title text not null,
  body text,
  url text,
  tag text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  pushed_at timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index if not exists notifications_tag_idx on public.notifications (user_id, tag, created_at);
alter table public.notifications enable row level security;
drop policy if exists "own read" on public.notifications;
create policy "own read" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "own mark read" on public.notifications;
create policy "own mark read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own delete" on public.notifications;
create policy "own delete" on public.notifications for delete to authenticated using (user_id = (select auth.uid()));
revoke insert, update on public.notifications from anon, authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- app đang mở nhận thông báo tức thì (kêu ting ting trong app)
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ========== Hàm dùng chung ==========
-- nhân viên đang hoạt động có 1 trong các vai trò (kể cả kiêm nhiệm), cùng chi nhánh (chủ spa: mọi chi nhánh)
create or replace function public.staff_recipients(p_roles public.user_role[], p_branch uuid default null)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(p.id), '{}')
    from public.profiles p
   where p.is_active and p.role <> 'customer'
     and (p.role = any(p_roles) or p.extra_roles && p_roles)
     and (p.role = 'owner' or p_branch is null or p.branch_id is null or p.branch_id = p_branch)
$$;
revoke execute on function public.staff_recipients(public.user_role[], uuid) from public, anon, authenticated;

-- tạo thông báo cho nhiều người; bỏ qua chính người vừa thao tác và thông báo trùng (cùng tag trong 10 phút)
create or replace function public.notify_users(p_users uuid[], p_kind text, p_title text, p_body text, p_url text, p_tag text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  insert into public.notifications (user_id, kind, title, body, url, tag)
  select distinct u, p_kind, p_title, nullif(p_body, ''), p_url, p_tag
    from unnest(p_users) u
    join public.profiles p on p.id = u and p.is_active
   where u is not null and u is distinct from me
     and (p_tag is null or not exists (
           select 1 from public.notifications n
            where n.user_id = u and n.tag = p_tag and n.created_at > now() - interval '10 minutes'));
end $$;
revoke execute on function public.notify_users(uuid[], text, text, text, text, text) from public, anon, authenticated;

create or replace function public.vn_money(p numeric)
returns text language sql immutable set search_path = '' as $$
  select replace(to_char(coalesce(p, 0), 'FM999,999,999,990'), ',', '.') || 'đ'
$$;

create or replace function public.vn_time(p timestamptz)
returns text language sql stable set search_path = '' as $$
  select to_char(p at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM')
$$;

-- ========== Đẩy lên điện thoại: gom thông báo vừa tạo -> gọi Vercel 1 lần ==========
create or replace function private.push_dispatch_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text; v_ids uuid[];
begin
  select value into v_url from private.push_config where key = 'url';
  select value into v_secret from private.push_config where key = 'secret';
  if v_url is null or v_secret is null then return null; end if;
  select array_agg(id) into v_ids from new_rows;
  if v_ids is null then return null; end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('ids', to_jsonb(v_ids)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 8000);
  return null;
end $$;
drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  referencing new table as new_rows for each statement execute function private.push_dispatch_trigger();

-- Vercel gọi: lấy nội dung + thiết bị của các thông báo chưa đẩy (có mã bí mật mới được)
create or replace function public.push_dispatch(p_ids uuid[], p_secret text)
returns table (sub_endpoint text, sub_p256dh text, sub_auth text, title text, body text, url text, tag text, unread integer)
language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is null or p_secret is distinct from (select value from private.push_config where key = 'secret') then
    raise exception 'forbidden';
  end if;
  return query
  with picked as (
    update public.notifications n set pushed_at = now()
     where n.id = any(p_ids) and n.pushed_at is null
    returning n.*
  )
  select s.endpoint, s.p256dh, s.auth, pk.title, pk.body, pk.url, pk.tag,
         (select count(*)::int from public.notifications u where u.user_id = pk.user_id and u.read_at is null)
    from picked pk
    join public.push_subscriptions s on s.user_id = pk.user_id;
end $$;
revoke execute on function public.push_dispatch(uuid[], text) from public;
grant execute on function public.push_dispatch(uuid[], text) to anon, authenticated;

create or replace function public.push_drop(p_endpoint text, p_secret text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is null or p_secret is distinct from (select value from private.push_config where key = 'secret') then
    raise exception 'forbidden';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
end $$;
revoke execute on function public.push_drop(text, text) from public;
grant execute on function public.push_drop(text, text) to anon, authenticated;

-- đánh dấu đã đọc (1 cái hoặc tất cả)
create or replace function public.mark_notifications_read(p_id uuid default null)
returns void language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now()
   where user_id = (select auth.uid()) and read_at is null and (p_id is null or id = p_id)
$$;
revoke execute on function public.mark_notifications_read(uuid) from public, anon;
grant execute on function public.mark_notifications_read(uuid) to authenticated;

-- dọn thông báo cũ hơn 60 ngày mỗi khi có thông báo mới (nhẹ, không cần lịch chạy)
create or replace function private.notifications_cleanup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if random() < 0.02 then
    delete from public.notifications where created_at < now() - interval '60 days';
  end if;
  return null;
end $$;
drop trigger if exists notifications_cleanup on public.notifications;
create trigger notifications_cleanup after insert on public.notifications
  for each statement execute function private.notifications_cleanup();

-- ========== LỊCH HẸN ==========
-- KTV phụ trách 1 lịch (liệu trình + tư vấn)
create or replace function public.appointment_ktvs(p_appt uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct t), '{}') from (
    select s.technician_id t from public.appointment_services s
     where s.appointment_id = p_appt and s.is_active and s.technician_id is not null
    union
    select a.consult_technician_id from public.appointments a
     where a.id = p_appt and a.consult_technician_id is not null
  ) x
$$;
revoke execute on function public.appointment_ktvs(uuid) from public, anon, authenticated;

create or replace function public.appointment_summary(p_appt uuid)
returns text language sql stable security definer set search_path = '' as $$
  select concat_ws(' · ',
           coalesce(c.full_name, 'Khách'),
           public.vn_time(a.start_at),
           b.name,
           coalesce((select string_agg(sv.name, ', ' order by s.start_at)
                       from public.appointment_services s join public.services sv on sv.id = s.service_id
                      where s.appointment_id = a.id and s.is_active),
                    case when a.is_consultation then 'Hẹn tư vấn' end))
    from public.appointments a
    left join public.customers c on c.id = a.customer_id
    left join public.branches b on b.id = a.branch_id
   where a.id = p_appt
$$;
revoke execute on function public.appointment_summary(uuid) from public, anon, authenticated;

-- lịch mới (chạy lúc kết thúc giao dịch, khi các liệu trình đã được thêm đủ)
create or replace function private.on_appointment_created()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a record; v_sum text; v_ktvs uuid[];
begin
  select * into a from public.appointments where id = new.id;
  if not found or a.status in ('cancelled', 'completed', 'no_show') then return null; end if;
  if a.start_at < now() - interval '2 hours' then return null; end if;
  v_sum := public.appointment_summary(a.id);
  v_ktvs := public.appointment_ktvs(a.id);

  perform public.notify_users(
    public.staff_recipients(array['owner', 'manager', 'receptionist']::public.user_role[], a.branch_id),
    'booking',
    case when a.source = 'online' then 'Có khách đặt lịch online' else 'Có lịch hẹn mới' end,
    v_sum, '/quan-ly/lich-hen', 'appt-' || a.id);

  if cardinality(v_ktvs) > 0 then
    perform public.notify_users(v_ktvs, 'booking', 'Bạn có lịch khách mới', v_sum,
      '/quan-ly/ktv/lich/' || a.id, 'appt-ktv-' || a.id);
  elsif a.status = 'pending' then
    perform public.notify_users(
      public.staff_recipients(array['technician']::public.user_role[], a.branch_id),
      'booking', 'Lịch chờ nhận – bấm để nhận khách', v_sum, '/quan-ly', 'appt-open-' || a.id);
  end if;
  return null;
end $$;
drop trigger if exists appointments_notify_new on public.appointments;
create constraint trigger appointments_notify_new after insert on public.appointments
  deferrable initially deferred for each row execute function private.on_appointment_created();

-- KTV được giao khách (lễ tân / quản lý xác nhận và chọn KTV, đổi KTV...)
create or replace function private.on_ktv_assigned()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_appt uuid; v_ktv uuid; a record;
begin
  if tg_table_name = 'appointment_services' then
    v_appt := new.appointment_id; v_ktv := new.technician_id;
    if tg_op = 'UPDATE' and new.technician_id is not distinct from old.technician_id then return null; end if;
    if not new.is_active then return null; end if;
  else
    v_appt := new.id; v_ktv := new.consult_technician_id;
    if new.consult_technician_id is not distinct from old.consult_technician_id then return null; end if;
  end if;
  if v_ktv is null then return null; end if;
  select * into a from public.appointments where id = v_appt;
  if not found or a.status in ('cancelled', 'completed', 'no_show') or a.start_at < now() - interval '2 hours' then return null; end if;
  -- lịch vừa tạo trong cùng giao dịch: đã báo ở on_appointment_created (tag trùng -> tự bỏ qua)
  perform public.notify_users(array[v_ktv], 'booking', 'Bạn được giao khách', public.appointment_summary(v_appt),
    '/quan-ly/ktv/lich/' || v_appt, 'appt-ktv-' || v_appt);
  return null;
end $$;
drop trigger if exists appointment_services_notify_ktv on public.appointment_services;
create constraint trigger appointment_services_notify_ktv after insert or update on public.appointment_services
  deferrable initially deferred for each row execute function private.on_ktv_assigned();
drop trigger if exists appointments_notify_consult_ktv on public.appointments;
create constraint trigger appointments_notify_consult_ktv after update on public.appointments
  deferrable initially deferred for each row execute function private.on_ktv_assigned();

-- lịch bị huỷ -> báo KTV phụ trách + lễ tân/quản lý
create or replace function private.on_appointment_cancelled()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sum text;
begin
  if new.status <> 'cancelled' or old.status = 'cancelled' or new.start_at < now() - interval '2 hours' then return null; end if;
  v_sum := public.appointment_summary(new.id);
  perform public.notify_users(
    public.appointment_ktvs(new.id) || public.staff_recipients(array['owner', 'manager', 'receptionist']::public.user_role[], new.branch_id),
    'booking', 'Lịch hẹn đã huỷ', v_sum, '/quan-ly/lich-hen', 'appt-cancel-' || new.id);
  return null;
end $$;
drop trigger if exists appointments_notify_cancel on public.appointments;
create trigger appointments_notify_cancel after update of status on public.appointments
  for each row execute function private.on_appointment_cancelled();

-- ========== YÊU CẦU CẦN DUYỆT + KẾT QUẢ DUYỆT ==========
create or replace function private.on_request_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t text := tg_table_name;
  v_new_pending boolean := false;
  v_done text;            -- 'approved' / 'rejected' khi vừa duyệt xong
  v_to uuid[];            -- người duyệt
  v_requester uuid;       -- người gửi yêu cầu (nhận kết quả)
  v_title text; v_body text; v_url text; v_label text; v_result_url text := '/quan-ly/ca-nhan';
  v_branch uuid; v_name text; v_tag text;
  MO constant public.user_role[] := array['owner', 'manager']::public.user_role[];
  O constant public.user_role[] := array['owner']::public.user_role[];
begin
  if tg_op = 'INSERT' then
    v_new_pending := new.status::text = 'pending' or (t = 'marketing_posts' and new.status = 'review');
  else
    if t = 'marketing_posts' then
      v_new_pending := new.status = 'review' and old.status is distinct from 'review';
      if old.status = 'review' and new.status in ('approved', 'revise') then v_done := case when new.status = 'approved' then 'approved' else 'rejected' end; end if;
    else
      v_new_pending := new.status::text = 'pending' and old.status::text is distinct from 'pending';
      if old.status::text = 'pending' and new.status::text in ('approved', 'rejected', 'applied') then
        v_done := case when new.status::text = 'rejected' then 'rejected' else 'approved' end;
      end if;
    end if;
  end if;
  if not v_new_pending and v_done is null then return null; end if;
  v_tag := t || '-' || new.id;

  if t = 'discount_requests' then
    select p.full_name into v_name from public.profiles p where p.id = new.requested_by;
    v_requester := new.requested_by;
    v_label := case when new.kind = 'debt' then 'Xin cho khách nợ' else 'Xin giảm giá' end;
    v_to := public.staff_recipients(case when new.kind = 'debt' then MO else O end, new.branch_id);
    v_body := concat_ws(' · ', v_name, (select full_name from public.customers where id = new.customer_id), public.vn_money(new.amount), new.reason);
    v_url := '/quan-ly/duyet-giam-gia'; v_result_url := '/quan-ly/thu-tien';
  elsif t = 'procedure_change_requests' then
    select a.branch_id into v_branch from public.appointment_services s join public.appointments a on a.id = s.appointment_id where s.id = new.appointment_service_id;
    select p.full_name into v_name from public.profiles p where p.id = new.requested_by;
    v_requester := new.requested_by; v_label := 'KTV xin đổi sản phẩm';
    v_to := public.staff_recipients(MO, v_branch);
    v_body := concat_ws(' · ', v_name, coalesce(new.from_product, '?') || ' → ' || coalesce(new.to_product, '?'), new.reason);
    v_url := '/quan-ly/theo-doi-ktv';
    select '/quan-ly/ktv/lieu-trinh/' || s.id into v_result_url from public.appointment_services s where s.id = new.appointment_service_id;
  elsif t = 'attendance_fix_requests' then
    select p.full_name, p.branch_id into v_name, v_branch from public.profiles p where p.id = new.staff_id;
    v_requester := new.staff_id; v_label := 'Xin sửa chấm công (quên chấm)';
    v_to := public.staff_recipients(MO, v_branch);
    v_body := concat_ws(' · ', v_name, to_char(new.work_date, 'DD/MM'), new.reason);
    v_url := '/quan-ly/theo-doi-ktv';
  elsif t = 'staff_leaves' then
    select p.full_name, p.branch_id into v_name, v_branch from public.profiles p where p.id = new.staff_id;
    v_requester := coalesce(new.requested_by, new.staff_id); v_label := 'Xin nghỉ phép';
    v_to := public.staff_recipients(MO, v_branch);
    v_body := concat_ws(' · ', v_name, to_char(new.leave_date, 'DD/MM')
                || case when new.half_day then ' (nửa ngày)' else '' end, new.reason);
    v_url := '/quan-ly/nghi-phep'; v_result_url := '/quan-ly/nghi-phep';
  elsif t = 'cashbook_entries' then
    if new.source <> 'counter' then return null; end if;
    select p.full_name into v_name from public.profiles p where p.id = new.created_by;
    v_requester := new.created_by;
    v_label := case when new.kind = 'income' then 'Phiếu thu chờ duyệt' else 'Phiếu chi chờ duyệt' end;
    v_to := public.staff_recipients(MO, new.branch_id);
    v_body := concat_ws(' · ', v_name, public.vn_money(new.amount), new.description);
    v_url := '/quan-ly/phieu-thu-chi'; v_result_url := '/quan-ly/phieu-thu-chi';
  elsif t = 'stock_requests' then
    select w.branch_id into v_branch from public.warehouses w where w.id = new.warehouse_id;
    select p.full_name into v_name from public.profiles p where p.id = new.requested_by;
    v_requester := new.requested_by; v_label := 'Phiếu xin xuất kho';
    v_to := public.staff_recipients(array['owner', 'manager', 'warehouse']::public.user_role[], v_branch);
    v_body := concat_ws(' · ', v_name, new.code, new.reason);
    v_url := '/quan-ly/kho/xin-xuat'; v_result_url := '/quan-ly/kho/xin-xuat';
  elsif t = 'stock_counts' then
    select w.branch_id into v_branch from public.warehouses w where w.id = new.warehouse_id;
    select p.full_name into v_name from public.profiles p where p.id = new.created_by;
    v_requester := new.created_by; v_label := 'Kiểm kho có chênh lệch';
    v_to := public.staff_recipients(O, v_branch);
    v_body := concat_ws(' · ', v_name, new.code, new.note);
    v_url := '/quan-ly/kho/kiem-kho'; v_result_url := '/quan-ly/kho/kiem-kho';
  elsif t = 'stock_receipts' then
    select p.full_name into v_name from public.profiles p where p.id = new.created_by;
    v_requester := new.created_by; v_label := 'Phiếu nhập hàng chờ duyệt giá';
    v_to := public.staff_recipients(O, null);
    v_body := concat_ws(' · ', v_name, new.code, new.supplier);
    v_url := '/quan-ly/kho/nhap-hang'; v_result_url := '/quan-ly/kho/nhap-hang';
  elsif t = 'promotion_registrations' then
    if v_new_pending is false then return null; end if; -- khách không cần báo kết quả qua app nhân viên
    v_label := 'Khách đăng ký khuyến mãi';
    v_to := public.staff_recipients(array['owner', 'manager', 'receptionist']::public.user_role[], new.branch_id);
    v_body := concat_ws(' · ', (select full_name from public.customers where id = new.customer_id),
                        (select name from public.promotions where id = new.promotion_id),
                        public.vn_time(new.preferred_at));
    v_url := '/quan-ly/khuyen-mai';
  elsif t = 'marketing_posts' then
    select p.full_name into v_name from public.profiles p where p.id = new.pic_id;
    v_requester := coalesce(new.pic_id, new.created_by); v_label := 'Bài marketing chờ duyệt';
    v_to := public.staff_recipients(O, null);
    v_body := concat_ws(' · ', new.title, v_name, 'đăng ' || to_char(new.publish_date, 'DD/MM'));
    v_url := '/quan-ly/marketing/bai/' || new.id; v_result_url := v_url;
  else
    return null;
  end if;

  if v_new_pending then
    perform public.notify_users(v_to, 'approval', v_label || ' cần duyệt', v_body, v_url, v_tag);
  elsif v_done is not null and v_requester is not null then
    perform public.notify_users(array[v_requester], 'result',
      v_label || case when v_done = 'approved' then ': ĐÃ DUYỆT ✅'
                      when t = 'marketing_posts' then ': cần sửa lại ✏️' else ': bị từ chối ❌' end,
      v_body, v_result_url, v_tag || '-done');
  end if;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['discount_requests', 'procedure_change_requests', 'attendance_fix_requests', 'staff_leaves',
                           'cashbook_entries', 'stock_requests', 'stock_counts', 'stock_receipts',
                           'promotion_registrations', 'marketing_posts'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_notify', t);
    execute format('create trigger %I after insert or update of status on public.%I for each row execute function private.on_request_change()', t || '_notify', t);
  end loop;
end $$;

-- chấm công: ngoài vùng 100m / vào sớm / tăng ca -> chờ duyệt; duyệt xong báo lại nhân viên
create or replace function private.on_attendance_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text; v_branch uuid; v_day text := to_char(new.work_date, 'DD/MM');
  MO constant public.user_role[] := array['owner', 'manager']::public.user_role[];
  o_appr text; o_in text; o_ot text;
begin
  select p.full_name, p.branch_id into v_name, v_branch from public.profiles p where p.id = new.staff_id;
  if tg_op = 'UPDATE' then o_appr := old.approval_status; o_in := old.in_status; o_ot := old.ot_status; end if;

  if new.approval_status = 'pending' and o_appr is distinct from 'pending' then
    perform public.notify_users(public.staff_recipients(array['owner']::public.user_role[], null), 'approval',
      'Chấm công ngoài vị trí cần duyệt', concat_ws(' · ', v_name, v_day, new.approval_reason), '/quan-ly/cham-cong',
      'att-loc-' || new.staff_id || '-' || new.work_date);
  elsif o_appr = 'pending' and new.approval_status in ('approved', 'rejected') then
    perform public.notify_users(array[new.staff_id], 'result',
      'Chấm công ' || v_day || case when new.approval_status = 'approved' then ': ĐÃ DUYỆT ✅' else ': bị từ chối ❌' end,
      null, '/quan-ly/ca-nhan', 'att-loc-' || new.staff_id || '-' || new.work_date || '-done');
  end if;

  if new.in_status = 'pending' and o_in is distinct from 'pending' then
    perform public.notify_users(public.staff_recipients(MO, v_branch), 'approval',
      'Chấm vào sớm cần duyệt', concat_ws(' · ', v_name, v_day, new.in_note), '/quan-ly/theo-doi-ktv',
      'att-in-' || new.staff_id || '-' || new.work_date);
  elsif o_in = 'pending' and new.in_status in ('approved', 'rejected') then
    perform public.notify_users(array[new.staff_id], 'result',
      'Chấm vào sớm ' || v_day || case when new.in_status = 'approved' then ': ĐÃ DUYỆT ✅' else ': bị từ chối ❌' end,
      null, '/quan-ly/ca-nhan', 'att-in-' || new.staff_id || '-' || new.work_date || '-done');
  end if;

  if new.ot_status = 'pending' and o_ot is distinct from 'pending' then
    perform public.notify_users(public.staff_recipients(MO, v_branch), 'approval',
      'Tăng ca cần duyệt', concat_ws(' · ', v_name, v_day, coalesce(new.ot_note, new.ot_reason)), '/quan-ly/cham-cong',
      'att-ot-' || new.staff_id || '-' || new.work_date);
  elsif o_ot = 'pending' and new.ot_status in ('approved', 'rejected') then
    perform public.notify_users(array[new.staff_id], 'result',
      'Tăng ca ' || v_day || case when new.ot_status = 'approved' then ': ĐÃ DUYỆT ✅' else ': bị từ chối ❌' end,
      null, '/quan-ly/ca-nhan', 'att-ot-' || new.staff_id || '-' || new.work_date || '-done');
  end if;
  return null;
end $$;
drop trigger if exists staff_attendance_notify on public.staff_attendance;
create trigger staff_attendance_notify after insert or update of approval_status, in_status, ot_status on public.staff_attendance
  for each row execute function private.on_attendance_change();
