-- Giai đoạn 4: thu tiền tại quầy
-- 1. Gói combo theo "phần": mỗi phần có số buổi (null = không giới hạn) + danh sách dịch vụ được dùng
--    (vd "10 buổi linh hoạt: Purifying, Hydrain3, ..." hoặc "5 buổi Acne Peel / Phi kim")
-- 2. Trừ buổi gói khi lịch hoàn thành; không trừ quá số buổi
-- 3. checkout_invoice(): tạo hoá đơn + dòng + chia doanh số + thanh toán + chốt + hoàn thành lịch trong 1 bước
--    Thẻ nạp sẵn chỉ trả được dịch vụ có giá thành viên, và trừ theo giá thành viên
-- 4. void_invoice(): chủ spa huỷ hoá đơn đã thu
-- 5. Huỷ gói / thẻ đang dùng dở + hoàn tiền (quản lý, chủ); trừ doanh số người bán trong tháng hoàn
-- 6. KTV chỉ xem hoá đơn mình bán (hoặc mình thu)

-- ============ 1. HOÁ ĐƠN: CỘT MỚI ============
alter table public.invoices add column void_reason text, add column voided_at timestamptz,
  add column voided_by uuid references public.profiles(id);
create index on public.invoices (appointment_id);
create index on public.invoices (branch_id, paid_at);
create index on public.invoices (customer_id);
create unique index invoices_one_per_appointment on public.invoices (appointment_id)
  where appointment_id is not null and status <> 'cancelled';

alter table public.invoice_items
  add column appointment_service_id uuid references public.appointment_services(id) on delete set null,
  add column list_price numeric(12,0);          -- giá niêm yết / đơn vị lúc bán (để tính hoàn tiền)
create index on public.invoice_items (invoice_id);
create index on public.invoice_items (appointment_service_id);
create index on public.payments (invoice_id);
create index on public.card_transactions (card_id);
create index on public.card_transactions (invoice_id);
create index on public.invoice_item_sellers (staff_id);

-- ============ 2. GÓI COMBO THEO PHẦN ============
drop trigger if exists customer_packages_ai on public.customer_packages;
drop function if exists public.customer_packages_after_insert();
drop table public.customer_package_services;
drop table public.package_services;

create table public.package_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.packages(id) on delete cascade,
  label text not null,
  quantity int check (quantity > 0),               -- null = không giới hạn
  unit_price numeric(12,0) check (unit_price >= 0), -- giá lẻ / buổi (tính tiền buổi đã dùng khi hoàn)
  sort_order int not null default 0
);
create index on public.package_items (package_id);

create table public.package_item_services (
  item_id uuid not null references public.package_items(id) on delete cascade,
  service_id uuid not null references public.services(id),
  primary key (item_id, service_id)
);
create index on public.package_item_services (service_id);

create table public.customer_package_items (
  id uuid primary key default gen_random_uuid(),
  customer_package_id uuid not null references public.customer_packages(id) on delete cascade,
  label text not null,
  total_qty int check (total_qty > 0),             -- null = không giới hạn
  used_qty int not null default 0 check (used_qty >= 0),
  unit_price numeric(12,0),
  sort_order int not null default 0,
  constraint customer_package_items_used_le_total check (total_qty is null or used_qty <= total_qty)
);
create index on public.customer_package_items (customer_package_id);

create table public.customer_package_item_services (
  item_id uuid not null references public.customer_package_items(id) on delete cascade,
  service_id uuid not null references public.services(id),
  primary key (item_id, service_id)
);
create index on public.customer_package_item_services (service_id);

alter table public.package_items enable row level security;
alter table public.package_item_services enable row level security;
alter table public.customer_package_items enable row level security;
alter table public.customer_package_item_services enable row level security;

create policy "public read" on public.package_items for select to anon, authenticated using (true);
create policy "management write" on public.package_items for all to authenticated
  using ((select public.has_role('owner','manager'))) with check ((select public.has_role('owner','manager')));
create policy "public read" on public.package_item_services for select to anon, authenticated using (true);
create policy "management write" on public.package_item_services for all to authenticated
  using ((select public.has_role('owner','manager'))) with check ((select public.has_role('owner','manager')));

create policy "own or staff read" on public.customer_package_items for select to authenticated
  using ((select public.is_staff()) or exists (
    select 1 from public.customer_packages cp where cp.id = customer_package_id and cp.customer_id = (select public.my_customer_id())));
create policy "own or staff read" on public.customer_package_item_services for select to authenticated
  using ((select public.is_staff()) or exists (
    select 1 from public.customer_package_items i join public.customer_packages cp on cp.id = i.customer_package_id
     where i.id = item_id and cp.customer_id = (select public.my_customer_id())));

-- khách mua gói: chép các phần của gói tại thời điểm mua
create or replace function public.customer_packages_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record; v_new uuid;
begin
  for r in select * from public.package_items where package_id = new.package_id order by sort_order loop
    insert into public.customer_package_items (customer_package_id, label, total_qty, unit_price, sort_order)
    values (new.id, r.label, r.quantity, r.unit_price, r.sort_order) returning id into v_new;
    insert into public.customer_package_item_services (item_id, service_id)
    select v_new, service_id from public.package_item_services where item_id = r.id;
  end loop;
  return new;
end $$;
revoke execute on function public.customer_packages_after_insert() from public, anon, authenticated;
create trigger customer_packages_ai after insert on public.customer_packages
for each row execute function public.customer_packages_after_insert();

-- dịch vụ trong lịch dùng phần nào của gói
alter table public.appointment_services
  add column customer_package_item_id uuid references public.customer_package_items(id);
create index on public.appointment_services (customer_package_item_id);
create index on public.appointment_services (customer_package_id);

create or replace function public.appointment_services_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_svc record;
  v_appt record;
  v_item record;
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

  -- chỉ ghi gói (cũ) mà không ghi phần: tự chọn phần đầu tiên còn buổi có dịch vụ này
  if new.customer_package_item_id is null and new.customer_package_id is not null
     and (tg_op = 'INSERT' or new.customer_package_id is distinct from old.customer_package_id) then
    select i.id into new.customer_package_item_id
      from public.customer_package_items i
      join public.customer_package_item_services s on s.item_id = i.id and s.service_id = new.service_id
     where i.customer_package_id = new.customer_package_id and (i.total_qty is null or i.used_qty < i.total_qty)
     order by i.sort_order limit 1;
    if new.customer_package_item_id is null then raise exception 'Gói của khách không có (hoặc hết buổi) dịch vụ này'; end if;
  end if;

  if new.customer_package_item_id is null then
    new.customer_package_id := null;
  elsif tg_op = 'INSERT' or new.customer_package_item_id is distinct from old.customer_package_item_id then
    select i.total_qty, i.used_qty, cp.id as cp_id, cp.customer_id, cp.is_active, cp.expires_at,
           exists (select 1 from public.customer_package_item_services s where s.item_id = i.id and s.service_id = new.service_id) as has_svc
      into v_item
      from public.customer_package_items i join public.customer_packages cp on cp.id = i.customer_package_id
     where i.id = new.customer_package_item_id;
    if not found or not v_item.has_svc then raise exception 'Gói của khách không có dịch vụ này'; end if;
    if v_item.customer_id <> v_appt.customer_id then raise exception 'Gói không thuộc khách hàng của lịch hẹn'; end if;
    if not v_item.is_active or (v_item.expires_at is not null and v_item.expires_at < new.start_at) then
      raise exception 'Gói đã hết hạn hoặc bị khoá';
    end if;
    if v_item.total_qty is not null and v_item.used_qty >= v_item.total_qty then
      raise exception 'Gói đã dùng hết số buổi cho dịch vụ này';
    end if;
    new.customer_package_id := v_item.cp_id;
  end if;
  return new;
end $$;
revoke execute on function public.appointment_services_before_write() from public, anon, authenticated;

-- lịch hoàn thành: trừ buổi; bỏ hoàn thành: trả lại buổi
create or replace function public.appointments_after_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.appointment_services
     set is_active = new.status not in ('cancelled','no_show')
   where appointment_id = new.id;

  if new.status = 'completed' and old.status <> 'completed' then
    update public.customer_package_items i set used_qty = i.used_qty + x.n
      from (select customer_package_item_id id, count(*) n from public.appointment_services
             where appointment_id = new.id and customer_package_item_id is not null group by 1) x
     where i.id = x.id;
  elsif old.status = 'completed' and new.status <> 'completed' then
    update public.customer_package_items i set used_qty = i.used_qty - x.n
      from (select customer_package_item_id id, count(*) n from public.appointment_services
             where appointment_id = new.id and customer_package_item_id is not null group by 1) x
     where i.id = x.id;
  end if;
  return new;
end $$;
revoke execute on function public.appointments_after_status() from public, anon, authenticated;

-- lịch đã hoàn thành mà đổi phần gói trên 1 dịch vụ -> trả buổi cũ, trừ buổi mới
create or replace function public.appointment_services_package_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select status from public.appointments where id = new.appointment_id) <> 'completed' then
    return new;
  end if;
  if old.customer_package_item_id is not null then
    update public.customer_package_items set used_qty = used_qty - 1 where id = old.customer_package_item_id;
  end if;
  if new.customer_package_item_id is not null then
    update public.customer_package_items set used_qty = used_qty + 1 where id = new.customer_package_item_id;
  end if;
  return new;
end $$;
revoke execute on function public.appointment_services_package_change() from public, anon, authenticated;
create trigger appointment_services_au_package after update of customer_package_item_id on public.appointment_services
for each row when (old.customer_package_item_id is distinct from new.customer_package_item_id)
execute function public.appointment_services_package_change();

-- lịch đã thanh toán thì không mở lại / huỷ được (phải huỷ hoá đơn trước)
create or replace function public.appointments_paid_lock()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'completed' and new.status <> 'completed'
     and exists (select 1 from public.invoices where appointment_id = old.id and status = 'paid') then
    raise exception 'Lịch hẹn đã thanh toán, muốn đổi phải huỷ hoá đơn trước';
  end if;
  return new;
end $$;
revoke execute on function public.appointments_paid_lock() from public, anon, authenticated;
create trigger appointments_bu_paid_lock before update of status on public.appointments
for each row when (old.status is distinct from new.status)
execute function public.appointments_paid_lock();

-- ============ 3. CHỐT HOÁ ĐƠN (cho phép huỷ qua void_invoice) ============
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
    if new.status = 'cancelled' and current_setting('app.voiding_invoice', true) = old.id::text then
      return new;
    end if;
    raise exception 'Hoá đơn đã thanh toán không thể huỷ hoặc mở lại';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'Hoá đơn đã huỷ không mở lại được';
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
      values (v_card, 'topup', v_item.amount, new.id, 'Nạp thẻ – ' || new.code);
      if coalesce(v_bonus, 0) > 0 then
        insert into public.card_transactions (card_id, txn_type, amount, invoice_id, note)
        values (v_card, 'bonus', v_bonus * v_item.quantity, new.id, 'Tặng khi nạp thẻ – ' || new.code);
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
revoke execute on function public.invoices_before_status() from public, anon, authenticated;

-- thẻ nạp sẵn chỉ trả được dịch vụ có giá thành viên (và cho phép dùng thẻ)
create or replace function public.invoice_items_card_rule()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_svc record;
begin
  if new.paid_with_card then
    if new.item_type <> 'service' then
      raise exception 'Thẻ tài khoản chỉ dùng để trả dịch vụ';
    end if;
    select name, card_allowed, member_price into v_svc from public.services where id = new.service_id;
    if not v_svc.card_allowed or v_svc.member_price is null then
      raise exception 'Dịch vụ "%" không trả bằng thẻ tài khoản (chưa có giá thành viên)', v_svc.name;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.invoice_items_card_rule() from public, anon, authenticated;

-- ============ 4. THU TIỀN ============
-- p_items: mảng các dòng
--   {"type":"service", "appointment_service_id": "...", "service_id": "...", "technician_id": "...",
--    "unit_price": 0 (chỉ cho dịch vụ báo giá), "discount": 0, "paid_with_card": false,
--    "customer_package_item_id": "...", "sellers": [{"staff_id": "...", "share": 1}]}
--   {"type":"package", "package_id": "...", "quantity": 1, "discount": 0, "sellers": [...]}
--   {"type":"card_topup", "topup_tier_id": "...", "sellers": [...]}   (chỉ nạp theo mức có sẵn)
--   Dòng trả bằng thẻ nạp sẵn: giá = giá thành viên.
-- p_payments: [{"method": "cash" | "bank_transfer" | "pos", "amount": 100000}]
--   tiền trừ thẻ tự tính = tổng các dòng paid_with_card
-- p_discount: giảm cả hoá đơn (đ), chia theo tỉ lệ vào các dòng (trừ nạp thẻ), đúng thứ tự dòng gửi lên
-- sellers.share: tỉ lệ chia doanh số; tự quy ra tiền theo số tiền thực thu của dòng
-- Dịch vụ trong lịch không có trên hoá đơn = khách không làm -> xoá khỏi lịch.
create or replace function public.checkout_invoice(
  p_branch_id uuid,
  p_customer_id uuid,
  p_appointment_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_discount numeric default 0,
  p_note text default null
)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_appt record;
  v_inv uuid;
  v_code text;
  v_item jsonb;
  v_pay jsonb;
  v_type text;
  v_qty int;
  v_unit numeric;
  v_list numeric;
  v_disc numeric;
  v_card_line boolean;
  v_desc text;
  v_svc record;
  v_aps record;
  v_aps_id uuid;
  v_pkg_item uuid;
  v_ref uuid;
  v_tier uuid;
  v_line uuid;
  v_lines jsonb := '[]'::jsonb;
  v_seen uuid[] := '{}';
  v_cursor timestamptz;
  v_eligible numeric;
  v_left numeric;
  v_n int;
  v_k int;
  v_share numeric;
  v_rec record;
  v_seller jsonb;
  v_amount numeric;
  v_card_total numeric;
  v_other_total numeric := 0;
  v_card uuid;
  v_total numeric;
begin
  if not public.has_role('owner','manager','receptionist','technician') then
    raise exception 'Bạn không có quyền thu tiền';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Hoá đơn chưa có dòng nào';
  end if;
  if jsonb_array_length(p_items) > 40 then raise exception 'Hoá đơn quá nhiều dòng'; end if;
  if coalesce(p_discount, 0) < 0 then raise exception 'Giảm giá không hợp lệ'; end if;

  if p_appointment_id is not null then
    select * into v_appt from public.appointments where id = p_appointment_id for update;
    if not found then raise exception 'Không tìm thấy lịch hẹn'; end if;
    if v_appt.status in ('cancelled','no_show') then raise exception 'Lịch hẹn đã huỷ / khách không đến'; end if;
    if exists (select 1 from public.invoices where appointment_id = p_appointment_id and status <> 'cancelled') then
      raise exception 'Lịch hẹn này đã được thanh toán';
    end if;
    if p_customer_id is distinct from v_appt.customer_id then
      raise exception 'Khách trên hoá đơn khác khách của lịch hẹn';
    end if;
    p_branch_id := v_appt.branch_id;
    select coalesce(max(end_at), v_appt.start_at) into v_cursor
      from public.appointment_services where appointment_id = p_appointment_id;
  end if;
  if p_branch_id is null then raise exception 'Chưa chọn chi nhánh'; end if;

  insert into public.invoices (customer_id, branch_id, appointment_id, note)
  values (p_customer_id, p_branch_id, p_appointment_id, nullif(trim(p_note), ''))
  returning id, code into v_inv, v_code;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_type := v_item->>'type';
    v_qty := coalesce((v_item->>'quantity')::int, 1);
    v_disc := round(coalesce((v_item->>'discount')::numeric, 0));
    v_card_line := coalesce((v_item->>'paid_with_card')::boolean, false);
    v_aps_id := null; v_pkg_item := null; v_ref := null; v_tier := null; v_list := null;
    if v_qty < 1 or v_qty > 50 then raise exception 'Số lượng không hợp lệ'; end if;

    if v_type = 'service' then
      v_aps_id := nullif(v_item->>'appointment_service_id', '')::uuid;
      if v_aps_id is not null then
        select * into v_aps from public.appointment_services where id = v_aps_id;
        if not found or v_aps.appointment_id is distinct from p_appointment_id then
          raise exception 'Dịch vụ không thuộc lịch hẹn này';
        end if;
        if v_aps_id = any(v_seen) then raise exception 'Một dịch vụ trong lịch bị tính 2 lần'; end if;
        v_seen := v_seen || v_aps_id;
        v_ref := v_aps.service_id;
        v_qty := 1;
      else
        v_ref := (v_item->>'service_id')::uuid;
      end if;
      select * into v_svc from public.services where id = v_ref;
      if not found then raise exception 'Dịch vụ không tồn tại'; end if;
      if v_aps_id is null and not v_svc.is_active then raise exception 'Dịch vụ "%" đã ngừng', v_svc.name; end if;

      -- làm thêm trong lịch: thêm vào lịch (để tính tiền dịch vụ KTV)
      if v_aps_id is null and p_appointment_id is not null then
        insert into public.appointment_services (appointment_id, service_id, technician_id, start_at, end_at)
        values (p_appointment_id, v_ref, nullif(v_item->>'technician_id', '')::uuid,
                v_cursor, v_cursor + make_interval(mins => v_svc.duration_minutes))
        returning * into v_aps;
        v_aps_id := v_aps.id;
        v_seen := v_seen || v_aps_id;
        v_cursor := v_aps.end_at;
        v_qty := 1;
      end if;

      v_list := v_svc.price;
      v_pkg_item := nullif(v_item->>'customer_package_item_id', '')::uuid;
      if v_pkg_item is not null then
        if v_aps_id is null then raise exception 'Trừ buổi gói chỉ dùng cho dịch vụ trong lịch hẹn'; end if;
        update public.appointment_services set customer_package_item_id = v_pkg_item where id = v_aps_id;
        v_unit := 0; v_disc := 0; v_card_line := false;
        select v_svc.name || ' – trừ buổi gói ' || p.name into v_desc
          from public.customer_package_items i
          join public.customer_packages cp on cp.id = i.customer_package_id
          join public.packages p on p.id = cp.package_id
         where i.id = v_pkg_item;
      else
        if v_aps_id is not null then
          update public.appointment_services set customer_package_item_id = null, customer_package_id = null
           where id = v_aps_id and customer_package_item_id is not null;
        end if;
        if v_card_line then
          if not v_svc.card_allowed or v_svc.member_price is null then
            raise exception 'Dịch vụ "%" không trả bằng thẻ tài khoản (chưa có giá thành viên)', v_svc.name;
          end if;
          v_unit := v_svc.member_price;
          v_desc := v_svc.name || ' (giá thành viên)';
        elsif v_svc.price is null then
          v_unit := round(coalesce((v_item->>'unit_price')::numeric, -1));
          if v_unit < 0 then raise exception 'Chưa nhập giá cho dịch vụ "%"', v_svc.name; end if;
          v_list := v_unit;
          v_desc := v_svc.name;
        else
          v_unit := v_svc.price;
          v_desc := v_svc.name;
        end if;
      end if;

    elsif v_type = 'package' then
      if v_card_line then raise exception 'Thẻ tài khoản chỉ dùng để trả dịch vụ'; end if;
      v_ref := (v_item->>'package_id')::uuid;
      select name, price into v_rec from public.packages where id = v_ref and is_active;
      if not found then raise exception 'Gói combo không tồn tại hoặc đã ngừng bán'; end if;
      v_unit := v_rec.price;
      v_list := v_rec.price;
      v_desc := 'Gói ' || v_rec.name;

    elsif v_type = 'card_topup' then
      if v_card_line then raise exception 'Không dùng thẻ tài khoản để nạp thẻ'; end if;
      if v_disc <> 0 then raise exception 'Nạp thẻ không áp dụng giảm giá'; end if;
      v_tier := nullif(v_item->>'topup_tier_id', '')::uuid;
      v_unit := null;
      select topup_amount into v_unit from public.card_topup_tiers where id = v_tier and is_active;
      if v_unit is null then raise exception 'Vui lòng chọn mức nạp thẻ'; end if;
      v_list := v_unit;
      v_desc := 'Nạp thẻ tài khoản';

    else
      raise exception 'Loại dòng hoá đơn không hợp lệ: %', v_type;
    end if;

    if v_disc < 0 or v_disc > v_unit * v_qty then
      raise exception 'Giảm giá dòng "%" không hợp lệ', v_desc;
    end if;

    insert into public.invoice_items (invoice_id, item_type, service_id, package_id, topup_tier_id, description,
                                      quantity, unit_price, discount, paid_with_card, appointment_service_id, list_price)
    values (v_inv, v_type::public.invoice_item_type,
            case when v_type = 'service' then v_ref end,
            case when v_type = 'package' then v_ref end,
            v_tier, v_desc, v_qty, v_unit, v_disc, v_card_line, v_aps_id, v_list)
    returning id into v_line;

    v_lines := v_lines || jsonb_build_object('id', v_line, 'sellers', coalesce(v_item->'sellers', '[]'::jsonb));
  end loop;

  -- dịch vụ trong lịch không có trên hoá đơn -> khách không làm
  if p_appointment_id is not null then
    delete from public.appointment_services
     where appointment_id = p_appointment_id and not (id = any(v_seen));
    update public.appointments
       set end_at = (select max(end_at) from public.appointment_services where appointment_id = p_appointment_id)
     where id = p_appointment_id;
  end if;

  -- giảm cả hoá đơn: chia theo tỉ lệ, đúng thứ tự dòng, dòng cuối nhận phần lẻ (giao diện tính y hệt)
  if coalesce(p_discount, 0) > 0 then
    p_discount := round(p_discount);
    select coalesce(sum(amount), 0), count(*) into v_eligible, v_n from public.invoice_items
     where invoice_id = v_inv and item_type <> 'card_topup' and amount > 0;
    if p_discount > v_eligible then raise exception 'Giảm giá lớn hơn tổng tiền dịch vụ / gói'; end if;
    v_left := p_discount; v_k := 0;
    for v_rec in select ii.id, ii.amount
                   from jsonb_array_elements(v_lines) with ordinality l(v, ord)
                   join public.invoice_items ii on ii.id = (l.v->>'id')::uuid
                  where ii.item_type <> 'card_topup' and ii.amount > 0
                  order by l.ord loop
      v_k := v_k + 1;
      v_amount := case when v_k = v_n then v_left else least(v_rec.amount, round(p_discount * v_rec.amount / v_eligible)) end;
      update public.invoice_items set discount = discount + v_amount where id = v_rec.id;
      v_left := v_left - v_amount;
    end loop;
  end if;

  -- chia doanh số
  for v_item in select value from jsonb_array_elements(v_lines) loop
    select amount, paid_with_card into v_rec from public.invoice_items where id = (v_item->>'id')::uuid;
    if v_rec.amount <= 0 or v_rec.paid_with_card or jsonb_array_length(v_item->'sellers') = 0 then continue; end if;
    select coalesce(sum((s->>'share')::numeric), 0), count(*) into v_share, v_n
      from jsonb_array_elements(v_item->'sellers') s;
    if v_share <= 0 then raise exception 'Tỉ lệ chia doanh số không hợp lệ'; end if;
    v_left := v_rec.amount; v_k := 0;
    for v_seller in select value from jsonb_array_elements(v_item->'sellers') loop
      v_k := v_k + 1;
      if (v_seller->>'share')::numeric <= 0 then raise exception 'Tỉ lệ chia doanh số phải lớn hơn 0'; end if;
      if not exists (select 1 from public.profiles where id = (v_seller->>'staff_id')::uuid and is_active
                       and role in ('owner','manager','receptionist','technician')) then
        raise exception 'Người được chia doanh số không phải nhân viên đang làm việc';
      end if;
      v_amount := case when v_k = v_n then v_left
                       else round(v_rec.amount * (v_seller->>'share')::numeric / v_share) end;
      v_left := v_left - v_amount;
      if v_amount > 0 then
        insert into public.invoice_item_sellers (invoice_item_id, staff_id, amount)
        values ((v_item->>'id')::uuid, (v_seller->>'staff_id')::uuid, v_amount)
        on conflict (invoice_item_id, staff_id) do update set amount = public.invoice_item_sellers.amount + excluded.amount;
      end if;
    end loop;
  end loop;

  -- thanh toán
  select coalesce(sum(amount), 0) into v_card_total from public.invoice_items where invoice_id = v_inv and paid_with_card;
  select coalesce(sum(amount), 0) into v_total from public.invoice_items where invoice_id = v_inv;

  if v_card_total > 0 then
    if p_customer_id is null then raise exception 'Trả bằng thẻ cần chọn khách hàng'; end if;
    select c.id into v_card from public.service_cards c
      left join public.card_transactions t on t.card_id = c.id
     where c.customer_id = p_customer_id and c.is_active
     group by c.id order by coalesce(sum(t.amount), 0) desc limit 1;
    if v_card is null then raise exception 'Khách chưa có thẻ tài khoản'; end if;
    insert into public.payments (invoice_id, method, amount, service_card_id)
    values (v_inv, 'service_card', v_card_total, v_card);
  end if;

  if p_payments is not null and jsonb_typeof(p_payments) = 'array' then
    for v_pay in select value from jsonb_array_elements(p_payments) loop
      v_amount := round(coalesce((v_pay->>'amount')::numeric, 0));
      if v_amount = 0 then continue; end if;
      if v_amount < 0 then raise exception 'Số tiền thanh toán không hợp lệ'; end if;
      if v_pay->>'method' not in ('cash','bank_transfer','pos') then
        raise exception 'Hình thức thanh toán không hợp lệ';
      end if;
      insert into public.payments (invoice_id, method, amount)
      values (v_inv, (v_pay->>'method')::public.payment_method, v_amount);
      v_other_total := v_other_total + v_amount;
    end loop;
  end if;

  if v_card_total + v_other_total <> v_total then
    raise exception 'Khách trả % nhưng hoá đơn cần thu %', v_card_total + v_other_total, v_total;
  end if;

  update public.invoices set status = 'paid' where id = v_inv;

  if p_appointment_id is not null and v_appt.status <> 'completed' then
    update public.appointments set status = 'completed' where id = p_appointment_id;
  end if;
  return v_inv;
end $$;
revoke execute on function public.checkout_invoice(uuid, uuid, uuid, jsonb, jsonb, numeric, text) from public, anon;
grant execute on function public.checkout_invoice(uuid, uuid, uuid, jsonb, jsonb, numeric, text) to authenticated;

-- ============ 5. CHỦ SPA HUỶ HOÁ ĐƠN ĐÃ THU ============
create or replace function public.void_invoice(p_invoice uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_inv record;
  v_rec record;
  v_balance numeric;
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa được huỷ hoá đơn đã thu'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Vui lòng ghi lý do huỷ'; end if;
  select * into v_inv from public.invoices where id = p_invoice for update;
  if not found then raise exception 'Không tìm thấy hoá đơn'; end if;
  if v_inv.status <> 'paid' then raise exception 'Chỉ huỷ được hoá đơn đã thanh toán'; end if;

  -- gói đã bán: chỉ huỷ được khi khách chưa dùng buổi nào
  for v_rec in select cp.id from public.customer_packages cp
                 join public.invoice_items ii on ii.id = cp.invoice_item_id
                where ii.invoice_id = p_invoice loop
    if exists (select 1 from public.customer_package_items where customer_package_id = v_rec.id and used_qty > 0)
       or exists (select 1 from public.appointment_services where customer_package_id = v_rec.id) then
      raise exception 'Gói bán trong hoá đơn này đã được dùng, không huỷ được';
    end if;
    if exists (select 1 from public.refunds where customer_package_id = v_rec.id) then
      raise exception 'Gói bán trong hoá đơn này đã được huỷ & hoàn tiền';
    end if;
    update public.customer_packages set is_active = false where id = v_rec.id;
  end loop;

  -- tiền nạp + tặng: thu hồi (số dư thẻ phải còn đủ)
  for v_rec in select card_id, sum(amount) amt from public.card_transactions
                where invoice_id = p_invoice and txn_type in ('topup','bonus') group by card_id loop
    select coalesce(sum(amount), 0) into v_balance from public.card_transactions where card_id = v_rec.card_id;
    if v_balance < v_rec.amt then
      raise exception 'Thẻ đã dùng bớt tiền nạp (còn %), không thu hồi đủ %', v_balance, v_rec.amt;
    end if;
    insert into public.card_transactions (card_id, txn_type, amount, invoice_id, note)
    values (v_rec.card_id, 'adjustment', -v_rec.amt, p_invoice, 'Thu hồi do huỷ hoá đơn ' || v_inv.code);
  end loop;

  -- tiền đã trừ thẻ: hoàn lại
  for v_rec in select card_id, sum(amount) amt from public.card_transactions
                where invoice_id = p_invoice and txn_type = 'charge' group by card_id loop
    insert into public.card_transactions (card_id, txn_type, amount, invoice_id, note)
    values (v_rec.card_id, 'refund', -v_rec.amt, p_invoice, 'Hoàn tiền do huỷ hoá đơn ' || v_inv.code);
  end loop;

  -- hàng bán lẻ: nhập lại kho
  insert into public.stock_movements (warehouse_id, product_id, movement_type, quantity, invoice_item_id, note)
  select m.warehouse_id, m.product_id, 'adjustment', -m.quantity, m.invoice_item_id, 'Nhập lại do huỷ hoá đơn ' || v_inv.code
    from public.stock_movements m join public.invoice_items ii on ii.id = m.invoice_item_id
   where ii.invoice_id = p_invoice and m.movement_type = 'export_sale';

  perform set_config('app.voiding_invoice', p_invoice::text, true);
  update public.invoices
     set status = 'cancelled', void_reason = trim(p_reason), voided_at = now(), voided_by = (select auth.uid())
   where id = p_invoice;
  perform set_config('app.voiding_invoice', '', true);

  -- lịch hẹn: về "đang làm" (trả lại buổi gói), bỏ đánh dấu trừ gói để thu lại
  if v_inv.appointment_id is not null then
    update public.appointments set status = 'in_progress' where id = v_inv.appointment_id and status = 'completed';
    update public.appointment_services set customer_package_item_id = null, customer_package_id = null
     where appointment_id = v_inv.appointment_id;
  end if;
end $$;
revoke execute on function public.void_invoice(uuid, text) from public, anon;
grant execute on function public.void_invoice(uuid, text) to authenticated;

-- ============ 6. CHỦ / QUẢN LÝ TẠO, SỬA GÓI COMBO ============
-- p_items: [{"label": "10 buổi linh hoạt", "quantity": 10 | null, "unit_price": 850000, "service_ids": ["...", "..."]}]
-- Sửa gói không ảnh hưởng gói khách đã mua (các phần được chép lúc mua).
drop function if exists public.save_package(uuid, text, numeric, int, text, boolean, jsonb);
create or replace function public.save_package(
  p_id uuid, p_name text, p_price numeric, p_validity_days int, p_description text,
  p_is_active boolean, p_items jsonb
)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_it jsonb;
  v_item uuid;
  v_ord int := 0;
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ chủ / quản lý được sửa gói combo'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Vui lòng nhập tên gói'; end if;
  if p_price is null or p_price < 0 then raise exception 'Giá gói không hợp lệ'; end if;
  if p_validity_days is not null and p_validity_days <= 0 then raise exception 'Hạn dùng phải lớn hơn 0 ngày'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Gói cần ít nhất 1 phần dịch vụ'; end if;

  if v_id is null then
    insert into public.packages (name, price, validity_days, description, is_active)
    values (trim(p_name), round(p_price), p_validity_days, nullif(trim(p_description), ''), coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.packages
       set name = trim(p_name), price = round(p_price), validity_days = p_validity_days,
           description = nullif(trim(p_description), ''), is_active = coalesce(p_is_active, true)
     where id = v_id;
    if not found then raise exception 'Không tìm thấy gói'; end if;
    delete from public.package_items where package_id = v_id;
  end if;

  for v_it in select value from jsonb_array_elements(p_items) loop
    if jsonb_array_length(coalesce(v_it->'service_ids', '[]'::jsonb)) = 0 then
      raise exception 'Mỗi phần của gói cần ít nhất 1 dịch vụ';
    end if;
    v_ord := v_ord + 1;
    insert into public.package_items (package_id, label, quantity, unit_price, sort_order)
    values (v_id, coalesce(nullif(trim(v_it->>'label'), ''), 'Phần ' || v_ord),
            nullif(v_it->>'quantity', '')::int, round(nullif(v_it->>'unit_price', '')::numeric), v_ord)
    returning id into v_item;
    insert into public.package_item_services (item_id, service_id)
    select distinct v_item, x::uuid from jsonb_array_elements_text(v_it->'service_ids') x;
  end loop;
  return v_id;
end $$;
revoke execute on function public.save_package(uuid, text, numeric, int, text, boolean, jsonb) from public, anon;
grant execute on function public.save_package(uuid, text, numeric, int, text, boolean, jsonb) to authenticated;

-- ============ 7. HUỶ GÓI / THẺ ĐANG DÙNG DỞ + HOÀN TIỀN ============
-- Thẻ: hoàn = mệnh giá đã nạp − giá niêm yết các dịch vụ đã trả bằng thẻ (tiền tặng không hoàn)
-- Gói: hoàn = giá mua gói − số buổi đã dùng × giá lẻ / buổi của phần đó (chưa có thì lấy giá niêm yết dịch vụ)
-- Tiền hoàn trừ vào doanh số người bán (theo tỉ lệ đã chia lúc bán) trong tháng hoàn tiền.
create type public.refund_kind as enum ('card', 'package');

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  kind public.refund_kind not null,
  customer_id uuid not null references public.customers(id),
  branch_id uuid references public.branches(id),
  service_card_id uuid references public.service_cards(id),
  customer_package_id uuid references public.customer_packages(id),
  computed_amount numeric(12,0) not null,
  refund_amount numeric(12,0) not null check (refund_amount >= 0),
  method public.payment_method not null check (method in ('cash','bank_transfer','pos')),
  reason text not null,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.refunds (customer_id);
create index on public.refunds (branch_id, created_at);
alter table public.refunds enable row level security;
create policy "own or staff read" on public.refunds for select to authenticated
  using (customer_id = (select public.my_customer_id()) or (select public.is_staff()));

create table public.refund_seller_deductions (
  refund_id uuid not null references public.refunds(id) on delete cascade,
  staff_id uuid not null references public.profiles(id),
  amount numeric(12,0) not null check (amount > 0),
  primary key (refund_id, staff_id)
);
create index on public.refund_seller_deductions (staff_id);
alter table public.refund_seller_deductions enable row level security;
create policy "own or desk read" on public.refund_seller_deductions for select to authenticated
  using (staff_id = (select auth.uid()) or (select public.has_role('owner','manager','receptionist')));

create or replace function public.refund_quote(p_kind public.refund_kind, p_id uuid)
returns table (customer_id uuid, paid numeric, used_value numeric, balance numeric, bonus numeric,
               used_sessions int, refund numeric, max_refund numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cust uuid;
  v_paid numeric := 0;
  v_used numeric := 0;
  v_bal numeric := 0;
  v_bonus numeric := 0;
  v_sessions int := 0;
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ quản lý / chủ spa được huỷ gói, thẻ'; end if;
  if p_kind = 'card' then
    select c.customer_id into v_cust from public.service_cards c where c.id = p_id and c.is_active;
    if v_cust is null then raise exception 'Thẻ không tồn tại hoặc đã huỷ'; end if;
    select coalesce(sum(t.amount), 0) into v_bal from public.card_transactions t where t.card_id = p_id;
    select coalesce(sum(t.amount) filter (where t.txn_type = 'topup'), 0),
           coalesce(sum(t.amount) filter (where t.txn_type = 'bonus'), 0)
      into v_paid, v_bonus
      from public.card_transactions t left join public.invoices i on i.id = t.invoice_id
     where t.card_id = p_id and (i.id is null or i.status = 'paid');
    -- giá niêm yết các dịch vụ đã trừ thẻ này (hoá đơn còn hiệu lực)
    select coalesce(sum(coalesce(ii.list_price, ii.unit_price) * ii.quantity), 0), coalesce(sum(ii.quantity), 0)
      into v_used, v_sessions
      from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id and i.status = 'paid'
     where ii.paid_with_card
       and exists (select 1 from public.payments p where p.invoice_id = i.id and p.service_card_id = p_id);
    return query select v_cust, v_paid, v_used, v_bal, v_bonus, v_sessions,
                        greatest(0, least(v_bal, v_paid - v_used)), greatest(0, v_bal);
  else
    select cp.customer_id, coalesce(ii.amount / ii.quantity, 0)
      into v_cust, v_paid
      from public.customer_packages cp left join public.invoice_items ii on ii.id = cp.invoice_item_id
     where cp.id = p_id and cp.is_active;
    if v_cust is null then raise exception 'Gói không tồn tại hoặc đã huỷ'; end if;
    -- giá lẻ các buổi đã làm bằng gói này
    select coalesce(sum(coalesce(i.unit_price, s.price, aps.price, 0)), 0), count(*)
      into v_used, v_sessions
      from public.appointment_services aps
      join public.appointments a on a.id = aps.appointment_id and a.status = 'completed'
      join public.services s on s.id = aps.service_id
      left join public.customer_package_items i on i.id = aps.customer_package_item_id
     where aps.customer_package_id = p_id;
    return query select v_cust, v_paid, v_used, null::numeric, null::numeric, v_sessions,
                        greatest(0, v_paid - v_used), v_paid;
  end if;
end $$;
revoke execute on function public.refund_quote(public.refund_kind, uuid) from public, anon;
grant execute on function public.refund_quote(public.refund_kind, uuid) to authenticated;

create or replace function public.refund_customer_asset(
  p_kind public.refund_kind, p_id uuid, p_amount numeric, p_method public.payment_method, p_reason text,
  p_branch_id uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  q record;
  v_id uuid;
  v_rec record;
  v_total numeric;
  v_left numeric;
  v_n int;
  v_k int := 0;
  v_amt numeric;
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ quản lý / chủ spa được huỷ gói, thẻ'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Vui lòng ghi lý do huỷ'; end if;
  if p_method not in ('cash','bank_transfer','pos') then raise exception 'Hình thức hoàn tiền không hợp lệ'; end if;
  if p_kind = 'card' then
    perform 1 from public.service_cards where id = p_id for update;
  else
    perform 1 from public.customer_packages where id = p_id for update;
  end if;
  select * into q from public.refund_quote(p_kind, p_id);
  p_amount := round(coalesce(p_amount, q.refund));
  if p_amount < 0 or p_amount > q.max_refund then
    raise exception 'Số tiền hoàn phải từ 0 đến %', q.max_refund;
  end if;

  if p_kind = 'card' then
    if q.balance <> 0 then
      insert into public.card_transactions (card_id, txn_type, amount, note)
      values (p_id, 'adjustment', -q.balance, 'Huỷ thẻ, hoàn khách ' || p_amount || 'đ: ' || trim(p_reason));
    end if;
    update public.service_cards set is_active = false where id = p_id;
  else
    if exists (select 1 from public.appointment_services aps join public.appointments a on a.id = aps.appointment_id
                where aps.customer_package_id = p_id and a.status in ('pending','confirmed','in_progress')) then
      raise exception 'Gói đang được dùng cho lịch hẹn chưa hoàn thành, hãy đổi lịch đó trước';
    end if;
    update public.customer_packages set is_active = false where id = p_id;
  end if;

  insert into public.refunds (kind, customer_id, branch_id, service_card_id, customer_package_id,
                              computed_amount, refund_amount, method, reason)
  values (p_kind, q.customer_id,
          coalesce(p_branch_id, (select branch_id from public.profiles where id = (select auth.uid()))),
          case when p_kind = 'card' then p_id end, case when p_kind = 'package' then p_id end,
          q.refund, p_amount, p_method, trim(p_reason))
  returning id into v_id;

  -- trừ doanh số người bán theo tỉ lệ đã chia lúc bán
  if p_amount > 0 then
    create temp table if not exists _sellers (staff_id uuid, amount numeric) on commit drop;
    delete from _sellers;
    if p_kind = 'card' then
      insert into _sellers
      select s.staff_id, sum(s.amount)
        from public.invoice_items ii
        join public.invoices i on i.id = ii.invoice_id and i.status = 'paid'
        join public.invoice_item_sellers s on s.invoice_item_id = ii.id
       where ii.item_type = 'card_topup'
         and ii.invoice_id in (select t.invoice_id from public.card_transactions t
                                where t.card_id = p_id and t.txn_type = 'topup' and t.invoice_id is not null)
       group by s.staff_id;
    else
      insert into _sellers
      select s.staff_id, sum(s.amount / ii.quantity)
        from public.customer_packages cp
        join public.invoice_items ii on ii.id = cp.invoice_item_id
        join public.invoice_item_sellers s on s.invoice_item_id = ii.id
       where cp.id = p_id
       group by s.staff_id;
    end if;
    select coalesce(sum(amount), 0), count(*) into v_total, v_n from _sellers;
    if v_total > 0 then
      v_left := least(p_amount, v_total);
      for v_rec in select * from _sellers order by amount, staff_id loop
        v_k := v_k + 1;
        v_amt := case when v_k = v_n then v_left else round(least(p_amount, v_total) * v_rec.amount / v_total) end;
        v_left := v_left - v_amt;
        if v_amt > 0 then
          insert into public.refund_seller_deductions (refund_id, staff_id, amount) values (v_id, v_rec.staff_id, v_amt);
        end if;
      end loop;
    end if;
  end if;
  return v_id;
end $$;
revoke execute on function public.refund_customer_asset(public.refund_kind, uuid, numeric, public.payment_method, text, uuid) from public, anon;
grant execute on function public.refund_customer_asset(public.refund_kind, uuid, numeric, public.payment_method, text, uuid) to authenticated;

-- doanh số tháng = bán được − tiền hoàn bị trừ trong tháng
create or replace view public.staff_monthly_sales with (security_invoker = true) as
select month, staff_id, sum(amount) as sales_amount from (
  select date_trunc('month', i.paid_at at time zone 'Asia/Ho_Chi_Minh')::date as month, s.staff_id, s.amount
    from public.invoice_item_sellers s
    join public.invoice_items ii on ii.id = s.invoice_item_id
    join public.invoices i on i.id = ii.invoice_id
    join public.commission_item_types t on t.item_type = ii.item_type and t.counts
    left join public.services sv on sv.id = ii.service_id
   where i.status = 'paid'
     and not ii.paid_with_card
     and coalesce(sv.commission_eligible, true)
  union all
  select date_trunc('month', r.created_at at time zone 'Asia/Ho_Chi_Minh')::date, d.staff_id, -d.amount
    from public.refund_seller_deductions d join public.refunds r on r.id = d.refund_id
) x
group by 1, 2;

-- ============ 8. KTV CHỈ XEM HOÁ ĐƠN MÌNH BÁN / MÌNH THU ============
create or replace function public.can_see_invoice(p_invoice uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_role('owner','manager','receptionist')
      or exists (
        select 1 from public.invoices i
         where i.id = p_invoice
           and (i.customer_id = public.my_customer_id()
                or (public.has_role('technician')
                    and (i.created_by = (select auth.uid())
                         or exists (select 1 from public.invoice_items ii
                                      join public.invoice_item_sellers s on s.invoice_item_id = ii.id
                                     where ii.invoice_id = i.id and s.staff_id = (select auth.uid()))))))
$$;
revoke execute on function public.can_see_invoice(uuid) from public, anon;
grant execute on function public.can_see_invoice(uuid) to authenticated;

drop policy "own or staff read" on public.invoices;
create policy "own, desk or seller read" on public.invoices for select to authenticated
  using ((select public.has_role('owner','manager','receptionist')) or created_by = (select auth.uid())
         or public.can_see_invoice(id));
drop policy "own or staff read" on public.invoice_items;
create policy "visible invoice read" on public.invoice_items for select to authenticated
  using ((select public.has_role('owner','manager','receptionist')) or public.can_see_invoice(invoice_id));
drop policy "own or staff read" on public.payments;
create policy "visible invoice read" on public.payments for select to authenticated
  using ((select public.has_role('owner','manager','receptionist')) or public.can_see_invoice(invoice_id));
