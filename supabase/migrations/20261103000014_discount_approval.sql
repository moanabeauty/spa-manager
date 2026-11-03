-- Giảm giá: chỉ quản lý / chủ spa được giảm (bắt buộc ghi lý do).
-- Lễ tân / KTV muốn giảm phải gửi yêu cầu, chủ spa duyệt rồi mới thu được với số giảm đã duyệt.

create type public.discount_request_status as enum ('pending', 'approved', 'rejected', 'used');

create table public.discount_requests (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  appointment_id uuid references public.appointments(id) on delete set null,
  customer_id uuid references public.customers(id),
  amount numeric(12,0) not null check (amount > 0),      -- số tiền xin giảm cho cả hoá đơn
  reason text not null,
  status public.discount_request_status not null default 'pending',
  requested_by uuid not null references public.profiles(id) default auth.uid(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  invoice_id uuid references public.invoices(id),
  created_at timestamptz not null default now()
);
create index on public.discount_requests (status, created_at);
create index on public.discount_requests (appointment_id);
create index on public.discount_requests (customer_id);
alter table public.discount_requests enable row level security;
create policy "own or management read" on public.discount_requests for select to authenticated
  using (requested_by = (select auth.uid()) or (select public.has_role('owner','manager')));

alter table public.invoices
  add column discount_reason text,
  add column discount_request_id uuid references public.discount_requests(id);

-- nhân viên gửi yêu cầu giảm giá
create or replace function public.request_discount(
  p_branch_id uuid, p_appointment_id uuid, p_customer_id uuid, p_amount numeric, p_reason text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.has_role('receptionist','technician','manager','owner') then
    raise exception 'Bạn không có quyền xin giảm giá';
  end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Số tiền giảm không hợp lệ'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Vui lòng ghi lý do giảm giá'; end if;
  if p_appointment_id is not null then
    select branch_id, customer_id into p_branch_id, p_customer_id from public.appointments where id = p_appointment_id;
  end if;
  -- huỷ yêu cầu cũ còn chờ của cùng lịch / khách
  update public.discount_requests set status = 'rejected', review_note = 'Thay bằng yêu cầu mới', reviewed_at = now()
   where status = 'pending' and requested_by = (select auth.uid())
     and appointment_id is not distinct from p_appointment_id and customer_id is not distinct from p_customer_id;
  insert into public.discount_requests (branch_id, appointment_id, customer_id, amount, reason)
  values (p_branch_id, p_appointment_id, p_customer_id, round(p_amount), trim(p_reason))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.request_discount(uuid, uuid, uuid, numeric, text) from public, anon;
grant execute on function public.request_discount(uuid, uuid, uuid, numeric, text) to authenticated;

-- chủ spa duyệt / từ chối (có thể duyệt số tiền thấp hơn số xin)
create or replace function public.review_discount(p_id uuid, p_approve boolean, p_amount numeric default null, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_req record;
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa được duyệt giảm giá'; end if;
  select * into v_req from public.discount_requests where id = p_id for update;
  if not found then raise exception 'Không tìm thấy yêu cầu'; end if;
  if v_req.status <> 'pending' then raise exception 'Yêu cầu đã được xử lý'; end if;
  if p_approve and p_amount is not null and (p_amount <= 0 or p_amount > v_req.amount) then
    raise exception 'Số tiền duyệt phải lớn hơn 0 và không quá số xin (%)', v_req.amount;
  end if;
  update public.discount_requests
     set status = case when p_approve then 'approved' else 'rejected' end::public.discount_request_status,
         amount = case when p_approve and p_amount is not null then round(p_amount) else amount end,
         reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = nullif(trim(p_note), '')
   where id = p_id;
end $$;
revoke execute on function public.review_discount(uuid, boolean, numeric, text) from public, anon;
grant execute on function public.review_discount(uuid, boolean, numeric, text) to authenticated;

-- chốt hoá đơn: kiểm tra quyền giảm giá; huỷ hoá đơn: trả yêu cầu về "đã duyệt" để thu lại
create or replace function public.invoices_discount_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_disc numeric;
  v_reason text;
  v_req_id uuid;
  v_req record;
begin
  if new.status = 'cancelled' and old.status = 'paid' then
    update public.discount_requests set status = 'approved', invoice_id = null
     where invoice_id = new.id and status = 'used';
    return new;
  end if;
  if not (new.status = 'paid' and old.status = 'draft') then return new; end if;

  select coalesce(sum(discount), 0) into v_disc from public.invoice_items where invoice_id = new.id;
  v_disc := v_disc + new.discount;
  if v_disc = 0 then return new; end if;

  v_req_id := nullif(current_setting('app.discount_request', true), '')::uuid;
  v_reason := nullif(trim(current_setting('app.discount_reason', true)), '');

  if public.has_role('owner','manager') and v_req_id is null then
    if v_reason is null then raise exception 'Giảm giá cần ghi lý do'; end if;
    new.discount_reason := v_reason;
    return new;
  end if;

  if v_req_id is null then
    raise exception 'Giảm giá cần chủ spa duyệt trước (gửi yêu cầu giảm giá)';
  end if;
  select * into v_req from public.discount_requests where id = v_req_id for update;
  if not found or v_req.status <> 'approved' then raise exception 'Yêu cầu giảm giá chưa được duyệt'; end if;
  if v_req.appointment_id is not null and v_req.appointment_id is distinct from new.appointment_id then
    raise exception 'Yêu cầu giảm giá thuộc lịch hẹn khác';
  end if;
  if v_req.customer_id is not null and v_req.customer_id is distinct from new.customer_id then
    raise exception 'Yêu cầu giảm giá thuộc khách khác';
  end if;
  if v_disc > v_req.amount then
    raise exception 'Giảm % vượt số chủ spa duyệt (%)', v_disc, v_req.amount;
  end if;
  update public.discount_requests set status = 'used', invoice_id = new.id where id = v_req_id;
  new.discount_request_id := v_req_id;
  new.discount_reason := coalesce(v_reason, v_req.reason);
  return new;
end $$;
revoke execute on function public.invoices_discount_check() from public, anon, authenticated;

create trigger invoices_bu_discount before update of status on public.invoices
for each row when (old.status is distinct from new.status)
execute function public.invoices_discount_check();

-- thu tiền kèm lý do giảm / mã yêu cầu đã duyệt (giao diện gọi hàm này)
create or replace function public.checkout_invoice_v2(
  p_branch_id uuid,
  p_customer_id uuid,
  p_appointment_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_discount numeric default 0,
  p_note text default null,
  p_discount_reason text default null,
  p_discount_request_id uuid default null
)
returns uuid language plpgsql security invoker set search_path = '' as $$
begin
  perform set_config('app.discount_reason', coalesce(p_discount_reason, ''), true);
  perform set_config('app.discount_request', coalesce(p_discount_request_id::text, ''), true);
  return public.checkout_invoice(p_branch_id, p_customer_id, p_appointment_id, p_items, p_payments, p_discount, p_note);
end $$;
revoke execute on function public.checkout_invoice_v2(uuid, uuid, uuid, jsonb, jsonb, numeric, text, text, uuid) from public, anon;
grant execute on function public.checkout_invoice_v2(uuid, uuid, uuid, jsonb, jsonb, numeric, text, text, uuid) to authenticated;
