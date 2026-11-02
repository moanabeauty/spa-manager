-- Moana Spa Manager: helper functions, business-rule triggers, views

-- ============ HELPERS (vai trò người dùng hiện tại) ============
create or replace function public.my_role()
returns public.user_role language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid()) and is_active
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select role <> 'customer' from public.profiles where id = (select auth.uid()) and is_active), false)
$$;

create or replace function public.has_role(variadic roles public.user_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select role = any(roles) from public.profiles where id = (select auth.uid()) and is_active), false)
$$;

create or replace function public.my_customer_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.customers where profile_id = (select auth.uid())
$$;

-- Chủ spa đổi vai trò / chi nhánh của một tài khoản
create or replace function public.set_user_role(target_user uuid, new_role public.user_role, new_branch uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('owner') then
    raise exception 'Chỉ chủ spa được đổi vai trò người dùng';
  end if;
  update public.profiles set role = new_role, branch_id = new_branch where id = target_user;
  if not found then raise exception 'Không tìm thấy người dùng'; end if;
end $$;

-- ============ TÀI KHOẢN MỚI ============
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text := coalesce(new.raw_user_meta_data->>'full_name', new.email);
  v_phone text := coalesce(new.phone, new.raw_user_meta_data->>'phone');
begin
  insert into public.profiles (id, full_name, phone, role) values (new.id, v_name, v_phone, 'customer');
  -- khách đã có hồ sơ tại spa (cùng SĐT) thì nối vào, chưa có thì tạo mới
  update public.customers set profile_id = new.id
   where v_phone is not null and phone = v_phone and profile_id is null;
  if not found then
    insert into public.customers (profile_id, full_name, phone, email)
    values (new.id, coalesce(v_name, 'Khách hàng'), v_phone, new.email)
    on conflict (phone) do nothing;
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ============ GÓI KHÁCH MUA ============
create or replace function public.customer_packages_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_days int;
begin
  select validity_days into v_days from public.packages where id = new.package_id;
  if new.expires_at is null and v_days is not null then
    new.expires_at := new.purchased_at + make_interval(days => v_days);
  end if;
  return new;
end $$;

create trigger customer_packages_bi before insert on public.customer_packages
for each row execute function public.customer_packages_before_insert();

create or replace function public.customer_packages_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.customer_package_services (customer_package_id, service_id, total_qty)
  select new.id, ps.service_id, ps.quantity from public.package_services ps where ps.package_id = new.package_id;
  return new;
end $$;

create trigger customer_packages_ai after insert on public.customer_packages
for each row execute function public.customer_packages_after_insert();

-- ============ LỊCH HẸN ============
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
    new.price := coalesce(new.price, v_svc.price);
    new.technician_fee := coalesce(new.technician_fee, v_svc.technician_fee);
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

create trigger appointment_services_biu before insert or update on public.appointment_services
for each row execute function public.appointment_services_before_write();

create or replace function public.appointments_after_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.appointment_services
     set is_active = new.status not in ('cancelled','no_show')
   where appointment_id = new.id;

  -- hoàn thành: trừ buổi trong gói; bỏ hoàn thành: trả lại buổi
  if new.status = 'completed' and old.status <> 'completed' then
    update public.customer_package_services cps
       set used_qty = cps.used_qty + x.n
      from (select customer_package_id, service_id, count(*) n from public.appointment_services
             where appointment_id = new.id and customer_package_id is not null group by 1,2) x
     where cps.customer_package_id = x.customer_package_id and cps.service_id = x.service_id;
  elsif old.status = 'completed' and new.status <> 'completed' then
    update public.customer_package_services cps
       set used_qty = cps.used_qty - x.n
      from (select customer_package_id, service_id, count(*) n from public.appointment_services
             where appointment_id = new.id and customer_package_id is not null group by 1,2) x
     where cps.customer_package_id = x.customer_package_id and cps.service_id = x.service_id;
  end if;
  return new;
end $$;

create trigger appointments_au_status after update of status on public.appointments
for each row when (old.status is distinct from new.status)
execute function public.appointments_after_status();

-- ============ HOÁ ĐƠN ============
create or replace function public.invoice_total(p_invoice uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(amount) from public.invoice_items where invoice_id = p_invoice), 0)
       - (select discount from public.invoices where id = p_invoice)
$$;

-- chỉ sửa dòng hoá đơn / thanh toán khi hoá đơn còn nháp
create or replace function public.ensure_invoice_draft()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status public.invoice_status;
begin
  select status into v_status from public.invoices
   where id = case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'Hoá đơn đã chốt, không sửa được';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger invoice_items_draft_only before insert or update or delete on public.invoice_items
for each row execute function public.ensure_invoice_draft();
create trigger payments_draft_only before insert or update or delete on public.payments
for each row execute function public.ensure_invoice_draft();

create or replace function public.ensure_seller_item_draft()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status public.invoice_status;
begin
  select i.status into v_status from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
   where ii.id = case when tg_op = 'DELETE' then old.invoice_item_id else new.invoice_item_id end;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'Hoá đơn đã chốt, không sửa được phần chia doanh số';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger sellers_draft_only before insert or update or delete on public.invoice_item_sellers
for each row execute function public.ensure_seller_item_draft();

-- thanh toán bằng thẻ tài khoản
create or replace function public.payments_card_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_inv record;
  v_card record;
  v_balance numeric;
  v_blocked text;
begin
  if new.method <> 'service_card' then return new; end if;
  select * into v_inv from public.invoices where id = new.invoice_id;
  select * into v_card from public.service_cards where id = new.service_card_id;
  if not v_card.is_active then raise exception 'Thẻ tài khoản đang bị khoá'; end if;
  if v_inv.customer_id is distinct from v_card.customer_id then
    raise exception 'Thẻ không thuộc khách hàng của hoá đơn';
  end if;
  select string_agg(s.name, ', ') into v_blocked
    from public.invoice_items ii join public.services s on s.id = ii.service_id
   where ii.invoice_id = new.invoice_id and ii.item_type = 'service' and not s.card_allowed;
  if v_blocked is not null then
    raise exception 'Thẻ tài khoản không dùng cho dịch vụ: %', v_blocked;
  end if;
  if exists (select 1 from public.invoice_items where invoice_id = new.invoice_id and item_type = 'card_topup') then
    raise exception 'Không dùng thẻ tài khoản để nạp thẻ';
  end if;
  select coalesce(sum(amount), 0) into v_balance from public.card_transactions where card_id = new.service_card_id;
  if v_balance < new.amount then
    raise exception 'Số dư thẻ không đủ (còn %)', v_balance;
  end if;
  return new;
end $$;

create trigger payments_bi_card before insert on public.payments
for each row execute function public.payments_card_check();

create or replace function public.payments_card_charge()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.method = 'service_card' then
    insert into public.card_transactions (card_id, txn_type, amount, invoice_id, payment_id, created_by)
    values (new.service_card_id, 'charge', -new.amount, new.invoice_id, new.id, new.created_by);
  end if;
  return new;
end $$;

create trigger payments_ai_card after insert on public.payments
for each row execute function public.payments_card_charge();

-- chốt hoá đơn: kiểm tra đủ tiền rồi tự động tạo gói / nạp thẻ / xuất kho bán lẻ
create or replace function public.invoices_before_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_total numeric;
  v_paid numeric;
  v_item record;
  v_card uuid;
  v_bonus numeric;
  v_wh uuid;
  i int;
begin
  if old.status = 'paid' and new.status <> 'paid' then
    raise exception 'Hoá đơn đã thanh toán không thể huỷ hoặc mở lại';
  end if;
  if not (new.status = 'paid' and old.status = 'draft') then return new; end if;

  v_total := coalesce((select sum(amount) from public.invoice_items where invoice_id = new.id), 0) - new.discount;
  select coalesce(sum(amount), 0) into v_paid from public.payments where invoice_id = new.id;
  if v_total < 0 then raise exception 'Giảm giá lớn hơn tổng hoá đơn'; end if;
  if v_paid <> v_total then
    raise exception 'Tổng thanh toán (%) chưa khớp tổng hoá đơn (%)', v_paid, v_total;
  end if;
  new.paid_at := coalesce(new.paid_at, now());

  for v_item in select * from public.invoice_items where invoice_id = new.id loop
    if v_item.item_type in ('package','card_topup') and new.customer_id is null then
      raise exception 'Bán gói hoặc nạp thẻ cần chọn khách hàng';
    end if;

    if v_item.item_type = 'package' then
      for i in 1..v_item.quantity loop
        insert into public.customer_packages (customer_id, package_id, invoice_item_id, purchased_at)
        values (new.customer_id, v_item.package_id, v_item.id, new.paid_at);
      end loop;

    elsif v_item.item_type = 'card_topup' then
      select id into v_card from public.service_cards
       where customer_id = new.customer_id and is_active order by created_at limit 1;
      if v_card is null then
        insert into public.service_cards (customer_id) values (new.customer_id) returning id into v_card;
      end if;
      select bonus_amount into v_bonus from public.card_topup_tiers where id = v_item.topup_tier_id;
      insert into public.card_transactions (card_id, txn_type, amount, invoice_id, note)
      values (v_card, 'topup', v_item.amount, new.id, 'Nạp thẻ');
      if coalesce(v_bonus, 0) > 0 then
        insert into public.card_transactions (card_id, txn_type, amount, invoice_id, note)
        values (v_card, 'bonus', v_bonus * v_item.quantity, new.id, 'Tặng khi nạp thẻ');
      end if;

    elsif v_item.item_type = 'product' then
      select id into v_wh from public.warehouses where branch_id = new.branch_id and type = 'retail';
      if v_wh is null then raise exception 'Chi nhánh chưa có kho bán lẻ'; end if;
      insert into public.stock_movements (warehouse_id, product_id, movement_type, quantity, invoice_item_id, note)
      values (v_wh, v_item.product_id, 'export_sale', -v_item.quantity, v_item.id, 'Bán lẻ theo hoá đơn ' || new.code);
    end if;
  end loop;
  return new;
end $$;

create trigger invoices_bu_status before update on public.invoices
for each row execute function public.invoices_before_status();

-- ============ KHO ============
create or replace function public.stock_movements_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_qty int; v_name text;
begin
  if new.quantity < 0 then
    perform pg_advisory_xact_lock(hashtext(new.warehouse_id::text || new.product_id::text));
    select coalesce(sum(quantity), 0) into v_qty from public.stock_movements
     where warehouse_id = new.warehouse_id and product_id = new.product_id;
    if v_qty + new.quantity < 0 then
      select name into v_name from public.products where id = new.product_id;
      raise exception 'Không đủ hàng "%" trong kho (còn %)', v_name, v_qty;
    end if;
  end if;
  return new;
end $$;

create trigger stock_movements_bi before insert on public.stock_movements
for each row execute function public.stock_movements_check();

create or replace function public.stock_requests_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = new.status then return new; end if;
  if old.status <> 'pending' then raise exception 'Phiếu đã được xử lý'; end if;
  if new.status in ('approved','rejected') then
    if not public.has_role('owner','manager','warehouse') then
      raise exception 'Chỉ quản lý kho được duyệt phiếu';
    end if;
    new.reviewed_by := (select auth.uid());
    new.reviewed_at := now();
  end if;
  if new.status = 'approved' then
    insert into public.stock_movements (warehouse_id, product_id, movement_type, quantity, request_id, note)
    select new.warehouse_id, sri.product_id, 'export_use', -sri.quantity, new.id, 'Xuất theo yêu cầu KTV'
      from public.stock_request_items sri where sri.request_id = new.id;
  end if;
  return new;
end $$;

create trigger stock_requests_bu before update on public.stock_requests
for each row execute function public.stock_requests_review();

-- ============ VIEWS (báo cáo) ============
create view public.service_card_balances with (security_invoker = true) as
select c.id as card_id, c.code, c.customer_id, coalesce(sum(t.amount), 0) as balance
  from public.service_cards c left join public.card_transactions t on t.card_id = c.id
 group by c.id;

create view public.stock_levels with (security_invoker = true) as
select m.warehouse_id, w.branch_id, w.type as warehouse_type, m.product_id, p.name as product_name, p.unit,
       sum(m.quantity) as quantity
  from public.stock_movements m
  join public.warehouses w on w.id = m.warehouse_id
  join public.products p on p.id = m.product_id
 group by m.warehouse_id, w.branch_id, w.type, m.product_id, p.name, p.unit;

create view public.invoice_totals with (security_invoker = true) as
select i.id as invoice_id, i.code, i.status,
       coalesce((select sum(amount) from public.invoice_items where invoice_id = i.id), 0) as items_total,
       i.discount,
       coalesce((select sum(amount) from public.invoice_items where invoice_id = i.id), 0) - i.discount as total,
       coalesce((select sum(amount) from public.payments where invoice_id = i.id), 0) as paid
  from public.invoices i;

create view public.staff_monthly_sales with (security_invoker = true) as
select date_trunc('month', i.paid_at at time zone 'Asia/Ho_Chi_Minh')::date as month,
       s.staff_id, sum(s.amount) as sales_amount
  from public.invoice_item_sellers s
  join public.invoice_items ii on ii.id = s.invoice_item_id
  join public.invoices i on i.id = ii.invoice_id
  join public.commission_item_types t on t.item_type = ii.item_type and t.counts
 where i.status = 'paid'
 group by 1, 2;

create view public.staff_monthly_commissions with (security_invoker = true) as
select m.month, m.staff_id, p.full_name, m.sales_amount, r.rate,
       round(m.sales_amount * r.rate) as commission_amount
  from public.staff_monthly_sales m
  join public.profiles p on p.id = m.staff_id
  cross join lateral (
    select rate from public.commission_tiers
     where min_monthly_sales <= m.sales_amount
     order by min_monthly_sales desc limit 1
  ) r;

create view public.technician_monthly_fees with (security_invoker = true) as
select date_trunc('month', aps.start_at at time zone 'Asia/Ho_Chi_Minh')::date as month,
       aps.technician_id, p.full_name, count(*) as services_done, sum(aps.technician_fee) as fee_amount
  from public.appointment_services aps
  join public.appointments a on a.id = aps.appointment_id
  join public.profiles p on p.id = aps.technician_id
 where a.status = 'completed'
 group by 1, 2, 3;
