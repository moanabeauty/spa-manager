-- Giai đoạn 9 (phần 1): đơn online + giao hàng, công nợ khách, phiếu thu/chi tại quầy.

create or replace function pg_temp.patch_fn(p_sig text, p_old text, p_new text)
returns void language plpgsql as $$
declare d text := pg_get_functiondef(p_sig::regprocedure);
begin
  if position(p_old in d) = 0 then raise exception 'Không tìm thấy đoạn cần sửa trong %', p_sig; end if;
  execute replace(d, p_old, p_new);
end $$;

-- =====================================================================
-- 1. HOÁ ĐƠN TẠI QUẦY / ONLINE + GIAO HÀNG
-- =====================================================================
alter table public.invoices
  add column channel text not null default 'store' check (channel in ('store','online')),
  add column debt_amount numeric(12,0) not null default 0 check (debt_amount >= 0),
  add column debt_reason text,
  add column debt_request_id uuid references public.discount_requests(id);
create index on public.invoices (channel, paid_at desc);
create index on public.invoices (customer_id) where debt_amount > 0;

create table public.invoice_shipments (
  invoice_id uuid primary key references public.invoices(id) on delete cascade,
  carrier text,                       -- đơn vị vận chuyển
  tracking_code text,                 -- mã vận đơn
  recipient_name text,
  recipient_phone text,
  address text,
  shipping_fee numeric(12,0) not null default 0 check (shipping_fee >= 0),  -- phí ship (thông tin)
  cod_amount numeric(12,0) not null default 0 check (cod_amount >= 0),      -- tiền ship thu hộ
  status text not null default 'preparing' check (status in ('preparing','shipping','delivered','returned')),
  note text,
  shipped_at timestamptz,
  delivered_at timestamptz,
  updated_by uuid references public.profiles(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index on public.invoice_shipments (tracking_code);
create index on public.invoice_shipments (status);
alter table public.invoice_shipments enable row level security;
create policy "visible invoice read" on public.invoice_shipments for select to authenticated
  using ((select public.has_role('owner','manager','receptionist')) or public.can_see_invoice(invoice_id));

create or replace function public.update_shipment(p_invoice uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status text := coalesce(nullif(p->>'status', ''), 'preparing');
begin
  if not public.has_role('owner','manager','receptionist','technician') then raise exception 'Bạn không có quyền sửa đơn giao hàng'; end if;
  if not public.can_see_invoice(p_invoice) then raise exception 'Bạn không xem được hoá đơn này'; end if;
  if not exists (select 1 from public.invoices where id = p_invoice and channel = 'online') then
    raise exception 'Chỉ hoá đơn online mới có thông tin giao hàng';
  end if;
  if v_status not in ('preparing','shipping','delivered','returned') then raise exception 'Trạng thái giao hàng không hợp lệ'; end if;
  insert into public.invoice_shipments as s (invoice_id, carrier, tracking_code, recipient_name, recipient_phone, address,
                                             shipping_fee, cod_amount, status, note, shipped_at, delivered_at)
  values (p_invoice, nullif(trim(p->>'carrier'), ''), nullif(trim(p->>'tracking_code'), ''), nullif(trim(p->>'recipient_name'), ''),
          public.normalize_phone(nullif(trim(p->>'recipient_phone'), '')), nullif(trim(p->>'address'), ''),
          round(coalesce(nullif(p->>'shipping_fee', '')::numeric, 0)), round(coalesce(nullif(p->>'cod_amount', '')::numeric, 0)),
          v_status, nullif(trim(p->>'note'), ''),
          case when v_status in ('shipping','delivered') then now() end,
          case when v_status = 'delivered' then now() end)
  on conflict (invoice_id) do update set
    carrier = excluded.carrier, tracking_code = excluded.tracking_code, recipient_name = excluded.recipient_name,
    recipient_phone = excluded.recipient_phone, address = excluded.address, shipping_fee = excluded.shipping_fee,
    note = excluded.note, status = excluded.status,
    shipped_at = coalesce(s.shipped_at, excluded.shipped_at),
    delivered_at = case when excluded.status = 'delivered' then coalesce(s.delivered_at, now()) else null end,
    updated_by = (select auth.uid()), updated_at = now();
end $$;
revoke execute on function public.update_shipment(uuid, jsonb) from public, anon;
grant execute on function public.update_shipment(uuid, jsonb) to authenticated;

-- =====================================================================
-- 2. CÔNG NỢ: khách trả thiếu, thu nợ sau
-- =====================================================================
-- yêu cầu cho nợ dùng chung bảng xin duyệt với giảm giá
alter table public.discount_requests add column kind text not null default 'discount' check (kind in ('discount','debt'));

create table public.debt_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  method public.payment_method not null check (method in ('cash','bank_transfer','pos')),
  amount numeric(12,0) not null check (amount > 0),
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.debt_payments (invoice_id);
create index on public.debt_payments (created_at);
alter table public.debt_payments enable row level security;
create policy "visible invoice read" on public.debt_payments for select to authenticated
  using ((select public.has_role('owner','manager','receptionist')) or public.can_see_invoice(invoice_id));

create view public.invoice_debts with (security_invoker = true) as
select i.id as invoice_id, i.code, i.customer_id, i.branch_id, i.channel, i.paid_at, i.debt_amount,
       coalesce((select sum(d.amount) from public.debt_payments d where d.invoice_id = i.id), 0) as collected,
       i.debt_amount - coalesce((select sum(d.amount) from public.debt_payments d where d.invoice_id = i.id), 0) as outstanding
  from public.invoices i
 where i.status = 'paid' and i.debt_amount > 0;
grant select on public.invoice_debts to authenticated;

-- checkout: nhận số tiền nợ + kênh bán + thông tin giao hàng (qua checkout_invoice_v3)
select pg_temp.patch_fn('public.checkout_invoice(uuid, uuid, uuid, jsonb, jsonb, numeric, text)',
  $o$  v_promo_used jsonb := '{}'::jsonb;
begin$o$,
  $n$  v_promo_used jsonb := '{}'::jsonb;
  v_debt numeric := round(coalesce(nullif(current_setting('app.debt_amount', true), '')::numeric, 0));
  v_channel text := coalesce(nullif(current_setting('app.channel', true), ''), 'store');
  v_ship jsonb := nullif(current_setting('app.shipment', true), '')::jsonb;
begin$n$);
select pg_temp.patch_fn('public.checkout_invoice(uuid, uuid, uuid, jsonb, jsonb, numeric, text)',
  $o$  insert into public.invoices (customer_id, branch_id, appointment_id, note)
  values (p_customer_id, p_branch_id, p_appointment_id, nullif(trim(p_note), ''))$o$,
  $n$  if v_channel not in ('store','online') then raise exception 'Kênh bán không hợp lệ'; end if;
  if v_channel = 'online' and p_appointment_id is not null then raise exception 'Hoá đơn online không gắn với lịch hẹn'; end if;
  if v_debt < 0 then raise exception 'Số tiền nợ không hợp lệ'; end if;
  insert into public.invoices (customer_id, branch_id, appointment_id, note, channel)
  values (p_customer_id, p_branch_id, p_appointment_id, nullif(trim(p_note), ''), v_channel)$n$);
select pg_temp.patch_fn('public.checkout_invoice(uuid, uuid, uuid, jsonb, jsonb, numeric, text)',
  $o$  if v_card_total + v_other_total <> v_total then
    raise exception 'Khách trả % nhưng hoá đơn cần thu %', v_card_total + v_other_total, v_total;
  end if;

  update public.invoices set status = 'paid' where id = v_inv;$o$,
  $n$  if v_card_total + v_other_total + v_debt <> v_total then
    if v_debt > 0 then
      raise exception 'Khách trả % + nợ % nhưng hoá đơn cần thu %', v_card_total + v_other_total, v_debt, v_total;
    end if;
    raise exception 'Khách trả % nhưng hoá đơn cần thu %', v_card_total + v_other_total, v_total;
  end if;
  if v_debt > 0 then
    update public.invoices set debt_amount = v_debt where id = v_inv;
  end if;
  if v_channel = 'online' then
    -- lần tạo đầu tiên ghi cả tiền thu hộ COD; sửa sau này không đổi được COD
    perform public.update_shipment(v_inv, coalesce(v_ship, '{}'::jsonb));
    if coalesce(nullif(v_ship->>'cod_amount', '')::numeric, 0) > v_debt then
      raise exception 'Tiền thu hộ (COD) không được lớn hơn số khách còn phải trả';
    end if;
  end if;

  update public.invoices set status = 'paid' where id = v_inv;$n$);

create or replace function public.checkout_invoice_v3(
  p_branch_id uuid, p_customer_id uuid, p_appointment_id uuid, p_items jsonb, p_payments jsonb,
  p_discount numeric default 0, p_note text default null, p_discount_reason text default null, p_discount_request_id uuid default null,
  p_debt_amount numeric default 0, p_debt_reason text default null, p_debt_request_id uuid default null,
  p_channel text default 'store', p_shipment jsonb default null)
returns uuid language plpgsql set search_path = '' as $$
begin
  perform set_config('app.debt_amount', coalesce(p_debt_amount, 0)::text, true);
  perform set_config('app.debt_reason', coalesce(p_debt_reason, ''), true);
  perform set_config('app.debt_request', coalesce(p_debt_request_id::text, ''), true);
  perform set_config('app.channel', coalesce(p_channel, 'store'), true);
  perform set_config('app.shipment', coalesce(p_shipment::text, ''), true);
  return public.checkout_invoice_v2(p_branch_id, p_customer_id, p_appointment_id, p_items, p_payments,
                                    p_discount, p_note, p_discount_reason, p_discount_request_id);
end $$;
revoke execute on function public.checkout_invoice_v3(uuid, uuid, uuid, jsonb, jsonb, numeric, text, text, uuid, numeric, text, uuid, text, jsonb) from public, anon;
grant execute on function public.checkout_invoice_v3(uuid, uuid, uuid, jsonb, jsonb, numeric, text, text, uuid, numeric, text, uuid, text, jsonb) to authenticated;

-- tổng tiền phải khớp: đã trả + nợ = tổng
select pg_temp.patch_fn('public.invoices_before_status()',
  $o$  if v_paid <> v_total then$o$,
  $n$  if v_paid + coalesce(new.debt_amount, 0) <> v_total then$n$);

-- ai được cho nợ: chủ / quản lý (ghi lý do); nhân viên khác cần yêu cầu đã duyệt; đơn online: phần ship thu hộ (COD) không cần duyệt
create or replace function public.invoices_debt_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_reason text;
  v_req_id uuid;
  v_req record;
  v_cod numeric;
begin
  if new.status = 'cancelled' and old.status = 'paid' then
    if exists (select 1 from public.debt_payments where invoice_id = new.id) then
      raise exception 'Hoá đơn đã thu nợ một phần, không huỷ được';
    end if;
    update public.discount_requests set status = 'approved', invoice_id = null
     where invoice_id = new.id and status = 'used' and kind = 'debt';
    return new;
  end if;
  if not (new.status = 'paid' and old.status = 'draft') or coalesce(new.debt_amount, 0) = 0 then return new; end if;

  if new.channel = 'online' then
    select cod_amount into v_cod from public.invoice_shipments where invoice_id = new.id;
    if coalesce(v_cod, 0) >= new.debt_amount then
      new.debt_reason := 'Ship thu hộ (COD)';
      return new;
    end if;
  end if;
  if new.customer_id is null then raise exception 'Ghi nợ cần chọn khách hàng'; end if;
  v_req_id := nullif(current_setting('app.debt_request', true), '')::uuid;
  v_reason := nullif(trim(current_setting('app.debt_reason', true)), '');
  if public.has_role('owner','manager') and v_req_id is null then
    if v_reason is null then raise exception 'Cho khách nợ cần ghi lý do'; end if;
    new.debt_reason := v_reason;
    return new;
  end if;
  if v_req_id is null then raise exception 'Cho khách nợ cần chủ spa / quản lý duyệt trước (gửi yêu cầu cho nợ)'; end if;
  select * into v_req from public.discount_requests where id = v_req_id and kind = 'debt' for update;
  if not found or v_req.status <> 'approved' then raise exception 'Yêu cầu cho nợ chưa được duyệt'; end if;
  if v_req.customer_id is distinct from new.customer_id then raise exception 'Yêu cầu cho nợ thuộc khách khác'; end if;
  if new.debt_amount > v_req.amount then raise exception 'Nợ % vượt số được duyệt (%)', new.debt_amount, v_req.amount; end if;
  update public.discount_requests set status = 'used', invoice_id = new.id where id = v_req_id;
  new.debt_request_id := v_req_id;
  new.debt_reason := coalesce(v_reason, v_req.reason);
  return new;
end $$;
create trigger invoices_bu_debt before update of status on public.invoices
for each row execute function public.invoices_debt_check();

-- giảm giá cũ chỉ xét yêu cầu loại giảm giá
select pg_temp.patch_fn('public.invoices_discount_check()',
  $o$     where invoice_id = new.id and status = 'used';$o$,
  $n$     where invoice_id = new.id and status = 'used' and kind = 'discount';$n$);
select pg_temp.patch_fn('public.invoices_discount_check()',
  $o$  select * into v_req from public.discount_requests where id = v_req_id for update;$o$,
  $n$  select * into v_req from public.discount_requests where id = v_req_id and kind = 'discount' for update;$n$);
select pg_temp.patch_fn('public.request_discount(uuid, uuid, uuid, numeric, text)',
  $o$   where status = 'pending' and requested_by = (select auth.uid())$o$,
  $n$   where status = 'pending' and kind = 'discount' and requested_by = (select auth.uid())$n$);

create or replace function public.request_debt(p_branch_id uuid, p_customer_id uuid, p_amount numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.has_role('receptionist','technician','manager','owner') then raise exception 'Bạn không có quyền xin cho nợ'; end if;
  if p_customer_id is null then raise exception 'Chọn khách hàng trước khi xin cho nợ'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Số tiền nợ không hợp lệ'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Vui lòng ghi lý do cho nợ'; end if;
  update public.discount_requests set status = 'rejected', review_note = 'Thay bằng yêu cầu mới', reviewed_at = now()
   where status = 'pending' and kind = 'debt' and requested_by = (select auth.uid()) and customer_id = p_customer_id;
  insert into public.discount_requests (branch_id, customer_id, amount, reason, kind)
  values (p_branch_id, p_customer_id, round(p_amount), trim(p_reason), 'debt')
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.request_debt(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.request_debt(uuid, uuid, numeric, text) to authenticated;

-- duyệt: giảm giá chỉ chủ spa; cho nợ chủ spa hoặc quản lý
select pg_temp.patch_fn('public.review_discount(uuid, boolean, numeric, text)',
  $o$  if not public.has_role('owner') then raise exception 'Chỉ chủ spa được duyệt giảm giá'; end if;
  select * into v_req from public.discount_requests where id = p_id for update;
  if not found then raise exception 'Không tìm thấy yêu cầu'; end if;$o$,
  $n$  select * into v_req from public.discount_requests where id = p_id for update;
  if not found then raise exception 'Không tìm thấy yêu cầu'; end if;
  if v_req.kind = 'debt' then
    if not public.has_role('owner','manager') then raise exception 'Chỉ chủ spa / quản lý được duyệt cho nợ'; end if;
  elsif not public.has_role('owner') then raise exception 'Chỉ chủ spa được duyệt giảm giá'; end if;$n$);

create or replace function public.collect_debt(p_invoice uuid, p_method text, p_amount numeric, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_left numeric; v_id uuid; v_status public.invoice_status;
begin
  if not public.has_role('owner','manager','receptionist','technician') then raise exception 'Bạn không có quyền thu tiền'; end if;
  if not public.can_see_invoice(p_invoice) and not exists (select 1 from public.invoices where id = p_invoice and created_by = (select auth.uid())) then
    raise exception 'Bạn không xem được hoá đơn này';
  end if;
  if p_method not in ('cash','bank_transfer','pos') then raise exception 'Hình thức thanh toán không hợp lệ'; end if;
  select status into v_status from public.invoices where id = p_invoice for update;
  if v_status is distinct from 'paid' then raise exception 'Hoá đơn chưa chốt hoặc đã huỷ'; end if;
  select outstanding into v_left from public.invoice_debts where invoice_id = p_invoice;
  if coalesce(v_left, 0) <= 0 then raise exception 'Hoá đơn này không còn nợ'; end if;
  p_amount := round(coalesce(p_amount, 0));
  if p_amount <= 0 then raise exception 'Số tiền thu không hợp lệ'; end if;
  if p_amount > v_left then raise exception 'Khách chỉ còn nợ %', v_left; end if;
  insert into public.debt_payments (invoice_id, method, amount, note)
  values (p_invoice, p_method::public.payment_method, p_amount, nullif(trim(p_note), ''))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.collect_debt(uuid, text, numeric, text) from public, anon;
grant execute on function public.collect_debt(uuid, text, numeric, text) to authenticated;

-- báo cáo doanh thu: thêm tiền khách nợ (ngày bán) và tiền thu nợ (ngày thu)
select pg_temp.patch_fn('public.revenue_report(date, date, uuid)',
  $o$  union all
  select (r.created_at at time zone 'Asia/Ho_Chi_Minh')::date, r.branch_id, 'refund', r.method::text, sum(r.refund_amount), count(*)$o$,
  $n$  union all
  select (i.paid_at at time zone 'Asia/Ho_Chi_Minh')::date, i.branch_id, 'debt', 'open', sum(i.debt_amount), count(*)
    from public.invoices i
   where i.status = 'paid' and i.debt_amount > 0
     and (i.paid_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
     and (p_branch is null or i.branch_id = p_branch)
   group by 1, 2
  union all
  select (d.created_at at time zone 'Asia/Ho_Chi_Minh')::date, i.branch_id, 'debt_in', d.method::text, sum(d.amount), count(*)
    from public.debt_payments d join public.invoices i on i.id = d.invoice_id
   where i.status = 'paid'
     and (d.created_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
     and (p_branch is null or i.branch_id = p_branch)
   group by 1, 2, 4
  union all
  select (r.created_at at time zone 'Asia/Ho_Chi_Minh')::date, r.branch_id, 'refund', r.method::text, sum(r.refund_amount), count(*)$n$);

-- =====================================================================
-- 3. PHIẾU THU / CHI TẠI QUẦY (nhân viên tạo, chủ / quản lý duyệt)
-- =====================================================================
create sequence public.cash_voucher_code_seq;
alter table public.cashbook_entries
  add column status text not null default 'approved' check (status in ('pending','approved','rejected')),
  add column code text,
  add column reviewed_by uuid references public.profiles(id),
  add column reviewed_at timestamptz,
  add column review_note text;
create index on public.cashbook_entries (status) where status = 'pending';
alter table public.cashbook_categories add column counter boolean not null default false;

insert into public.cashbook_categories (kind, name, sort_order, counter) values
  ('expense', 'Tiền ship', 20, true),
  ('expense', 'Mua dụng cụ, đồ dùng', 21, true),
  ('income',  'Thu tiền ship', 20, true)
on conflict (kind, name) do update set counter = true;
update public.cashbook_categories set counter = true
 where (kind, name) in (('income','Thu khác'), ('expense','Vật tư tiêu hao'), ('expense','Chi khác'), ('expense','Máy móc, thiết bị, sửa chữa'));
alter table public.cashbook_entries drop constraint cashbook_entries_source_check;
alter table public.cashbook_entries add constraint cashbook_entries_source_check check (source in ('manual','payroll','counter'));

create policy "staff read counter categories" on public.cashbook_categories for select to authenticated
  using ((select public.is_staff()) and is_active and counter);
create policy "own or manager read counter vouchers" on public.cashbook_entries for select to authenticated
  using (source = 'counter' and (created_by = (select auth.uid()) or (select public.has_role('owner','manager'))));

create or replace function public.create_cash_voucher(p_branch uuid, p_kind text, p_category uuid, p_amount numeric,
                                                      p_method text, p_description text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_auto boolean := public.has_role('owner','manager');
begin
  if not public.has_role('owner','manager','receptionist','technician','warehouse') then raise exception 'Bạn không có quyền tạo phiếu'; end if;
  if p_branch is null then raise exception 'Chọn chi nhánh'; end if;
  if p_kind not in ('income','expense') then raise exception 'Loại phiếu không hợp lệ'; end if;
  if not exists (select 1 from public.cashbook_categories where id = p_category and kind = p_kind and is_active
                   and (counter or public.has_role('owner'))) then
    raise exception 'Danh mục không dùng được cho phiếu tại quầy';
  end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Số tiền không hợp lệ'; end if;
  if p_method not in ('cash','bank_transfer','pos') then raise exception 'Hình thức không hợp lệ'; end if;
  if nullif(trim(p_description), '') is null then raise exception 'Vui lòng ghi nội dung phiếu'; end if;
  insert into public.cashbook_entries (branch_id, kind, category_id, amount, method, description, source, status, code,
                                       reviewed_by, reviewed_at)
  values (p_branch, p_kind, p_category, round(p_amount), p_method, trim(p_description), 'counter',
          case when v_auto then 'approved' else 'pending' end,
          (case when p_kind = 'income' then 'PT' else 'PC' end) || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYMMDD') || '-'
            || lpad(nextval('public.cash_voucher_code_seq')::text, 4, '0'),
          case when v_auto then (select auth.uid()) end, case when v_auto then now() end)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.create_cash_voucher(uuid, text, uuid, numeric, text, text) from public, anon;
grant execute on function public.create_cash_voucher(uuid, text, uuid, numeric, text, text) to authenticated;

create or replace function public.review_cash_voucher(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ chủ spa / quản lý duyệt phiếu thu chi'; end if;
  select status into v_status from public.cashbook_entries where id = p_id and source = 'counter' for update;
  if not found then raise exception 'Không tìm thấy phiếu'; end if;
  if v_status <> 'pending' then raise exception 'Phiếu đã được xử lý'; end if;
  update public.cashbook_entries
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = nullif(trim(p_note), '')
   where id = p_id;
end $$;
revoke execute on function public.review_cash_voucher(uuid, boolean, text) from public, anon;
grant execute on function public.review_cash_voucher(uuid, boolean, text) to authenticated;

-- sổ thu chi: chỉ tính phiếu đã duyệt + tiền thu nợ
select pg_temp.patch_fn('public.cashflow_report(integer, uuid)',
  $o$   where extract(year from e.entry_date) = p_year$o$,
  $n$   where extract(year from e.entry_date) = p_year and e.status = 'approved'$n$);
select pg_temp.patch_fn('public.cashflow_report(integer, uuid)',
  $o$  union all
  select extract(month from r.created_at at time zone 'Asia/Ho_Chi_Minh')::int, 'expense', 'refund',$o$,
  $n$  union all
  select extract(month from d.created_at at time zone 'Asia/Ho_Chi_Minh')::int, 'income'::text, 'debt'::text,
         'Thu nợ khách'::text, sum(d.amount)
    from public.debt_payments d join public.invoices i on i.id = d.invoice_id
   where i.status = 'paid' and extract(year from d.created_at at time zone 'Asia/Ho_Chi_Minh') = p_year
     and (p_branch is null or i.branch_id = p_branch)
   group by 1
  union all
  select extract(month from r.created_at at time zone 'Asia/Ho_Chi_Minh')::int, 'expense', 'refund',$n$);

