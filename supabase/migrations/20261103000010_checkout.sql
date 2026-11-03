-- Giai đoạn 4: thu tiền tại quầy
-- 1. Dòng hoá đơn nối với dịch vụ trong lịch + gói đã trừ buổi
-- 2. Trừ buổi gói: không trừ quá số buổi; đổi gói sau khi lịch đã hoàn thành vẫn trừ / trả đúng
-- 3. checkout_invoice(): tạo hoá đơn + dòng + chia doanh số + thanh toán + chốt + hoàn thành lịch trong 1 bước
-- 4. void_invoice(): chủ spa huỷ hoá đơn đã thu (trả lại tiền thẻ, buổi gói, thu hồi tiền nạp / gói đã bán)
-- 5. save_package(): chủ / quản lý tạo, sửa gói combo

-- ============ 1. CỘT MỚI + RÀNG BUỘC ============
alter table public.invoice_items
  add column appointment_service_id uuid references public.appointment_services(id) on delete set null,
  add column customer_package_id uuid references public.customer_packages(id);
create index on public.invoice_items (appointment_service_id);
create index on public.invoice_items (customer_package_id);
create index on public.invoice_items (invoice_id);
create index on public.invoices (appointment_id);
create index on public.invoices (branch_id, paid_at);
create index on public.payments (invoice_id);
create index on public.card_transactions (card_id);
create index on public.invoice_item_sellers (staff_id);

alter table public.invoices add column void_reason text, add column voided_at timestamptz,
  add column voided_by uuid references public.profiles(id);

-- mỗi lịch hẹn chỉ có 1 hoá đơn còn hiệu lực
create unique index invoices_one_per_appointment on public.invoices (appointment_id)
  where appointment_id is not null and status <> 'cancelled';

alter table public.customer_package_services
  add constraint customer_package_services_used_le_total check (used_qty <= total_qty);

-- ============ 2. TRỪ BUỔI GÓI ============
-- lịch đã hoàn thành mà đổi gói trên 1 dịch vụ -> trả buổi gói cũ, trừ buổi gói mới
create or replace function public.appointment_services_package_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select status from public.appointments where id = new.appointment_id) <> 'completed' then
    return new;
  end if;
  if old.customer_package_id is not null then
    update public.customer_package_services set used_qty = used_qty - 1
     where customer_package_id = old.customer_package_id and service_id = old.service_id;
  end if;
  if new.customer_package_id is not null then
    update public.customer_package_services set used_qty = used_qty + 1
     where customer_package_id = new.customer_package_id and service_id = new.service_id;
  end if;
  return new;
end $$;
revoke execute on function public.appointment_services_package_change() from public, anon, authenticated;

create trigger appointment_services_au_package after update of customer_package_id on public.appointment_services
for each row when (old.customer_package_id is distinct from new.customer_package_id)
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

-- cho phép huỷ hoá đơn đã thu chỉ khi đi qua void_invoice()
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

-- ============ 3. THU TIỀN ============
-- p_items: mảng các dòng
--   {"type":"service", "appointment_service_id": "...", "service_id": "...", "technician_id": "...",
--    "price_mode": "member", "unit_price": 0, "discount": 0, "paid_with_card": false,
--    "customer_package_id": "...", "sellers": [{"staff_id": "...", "share": 1}]}
--   {"type":"package", "package_id": "...", "quantity": 1, "discount": 0, "sellers": [...]}
--   {"type":"card_topup", "topup_tier_id": "..." | null, "unit_price": 7000000, "sellers": [...]}
-- p_payments: [{"method": "cash" | "bank_transfer" | "pos", "amount": 100000}]
--   tiền trả bằng thẻ tài khoản tự tính = tổng các dòng paid_with_card
-- p_discount: giảm cả hoá đơn (đ), tự chia theo tỉ lệ vào các dòng (trừ nạp thẻ)
-- sellers.share: tỉ lệ chia doanh số (vd 1 và 1 = chia đôi); tự quy ra tiền theo số tiền thực thu của dòng
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
  v_disc numeric;
  v_card_line boolean;
  v_desc text;
  v_svc record;
  v_aps record;
  v_aps_id uuid;
  v_pkg_id uuid;
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
  if not public.has_role('owner','manager','receptionist') then
    raise exception 'Chỉ lễ tân, quản lý, chủ spa được thu tiền';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Hoá đơn chưa có dòng nào';
  end if;
  if jsonb_array_length(p_items) > 40 then raise exception 'Hoá đơn quá nhiều dòng'; end if;
  if coalesce(p_discount, 0) < 0 then raise exception 'Giảm giá không hợp lệ'; end if;

  -- lịch hẹn
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

  -- ---- các dòng ----
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_type := v_item->>'type';
    v_qty := coalesce((v_item->>'quantity')::int, 1);
    v_disc := round(coalesce((v_item->>'discount')::numeric, 0));
    v_card_line := coalesce((v_item->>'paid_with_card')::boolean, false);
    v_aps_id := null; v_pkg_id := null; v_ref := null; v_tier := null;
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

      v_pkg_id := nullif(v_item->>'customer_package_id', '')::uuid;
      if v_pkg_id is not null then
        if v_aps_id is null then raise exception 'Trừ buổi gói chỉ dùng cho dịch vụ trong lịch hẹn'; end if;
        update public.appointment_services set customer_package_id = v_pkg_id where id = v_aps_id;
        v_unit := 0; v_disc := 0; v_card_line := false;
        select v_svc.name || ' – trừ buổi gói ' || p.name into v_desc
          from public.customer_packages cp join public.packages p on p.id = cp.package_id where cp.id = v_pkg_id;
      else
        if v_aps_id is not null then
          update public.appointment_services set customer_package_id = null
           where id = v_aps_id and customer_package_id is not null;
        end if;
        if v_svc.price is null then
          v_unit := round(coalesce((v_item->>'unit_price')::numeric, -1));
          if v_unit < 0 then raise exception 'Chưa nhập giá cho dịch vụ "%"', v_svc.name; end if;
        elsif v_item->>'price_mode' = 'member' and v_svc.member_price is not null then
          v_unit := v_svc.member_price;
        else
          v_unit := v_svc.price;
        end if;
        v_desc := v_svc.name || case when v_item->>'price_mode' = 'member' and v_svc.member_price is not null
                                     then ' (giá thành viên)' else '' end;
      end if;

    elsif v_type = 'package' then
      v_ref := (v_item->>'package_id')::uuid;
      select name, price into v_rec from public.packages where id = v_ref and is_active;
      if not found then raise exception 'Gói combo không tồn tại hoặc đã ngừng bán'; end if;
      v_unit := v_rec.price;
      v_desc := 'Gói ' || v_rec.name;

    elsif v_type = 'card_topup' then
      if v_card_line then raise exception 'Không dùng thẻ tài khoản để nạp thẻ'; end if;
      if v_disc <> 0 then raise exception 'Nạp thẻ không áp dụng giảm giá'; end if;
      v_tier := nullif(v_item->>'topup_tier_id', '')::uuid;
      if v_tier is not null then
        select topup_amount into v_unit from public.card_topup_tiers where id = v_tier and is_active;
        if v_unit is null then raise exception 'Mức nạp không tồn tại'; end if;
      else
        v_unit := round(coalesce((v_item->>'unit_price')::numeric, 0));
        if v_unit <= 0 then raise exception 'Chưa nhập số tiền nạp'; end if;
        select id into v_tier from public.card_topup_tiers where topup_amount = v_unit and is_active;
      end if;
      v_desc := 'Nạp thẻ tài khoản';

    else
      raise exception 'Loại dòng hoá đơn không hợp lệ: %', v_type;
    end if;

    if v_disc < 0 or v_disc > v_unit * v_qty then
      raise exception 'Giảm giá dòng "%" không hợp lệ', v_desc;
    end if;

    insert into public.invoice_items (invoice_id, item_type, service_id, package_id, topup_tier_id, description,
                                      quantity, unit_price, discount, paid_with_card,
                                      appointment_service_id, customer_package_id)
    values (v_inv, v_type::public.invoice_item_type,
            case when v_type = 'service' then v_ref end,
            case when v_type = 'package' then v_ref end,
            v_tier, v_desc, v_qty, v_unit, v_disc, v_card_line, v_aps_id, v_pkg_id)
    returning id into v_line;

    v_lines := v_lines || jsonb_build_object('id', v_line, 'sellers', coalesce(v_item->'sellers', '[]'::jsonb));
  end loop;

  -- dịch vụ trong lịch không có trên hoá đơn -> khách không làm
  if p_appointment_id is not null then
    delete from public.appointment_services
     where appointment_id = p_appointment_id and not (id = any(v_seen));
    update public.appointments set end_at = (select max(end_at) from public.appointment_services where appointment_id = p_appointment_id)
     where id = p_appointment_id;
  end if;

  -- ---- giảm cả hoá đơn: chia theo tỉ lệ vào các dòng (trừ nạp thẻ) ----
  if coalesce(p_discount, 0) > 0 then
    p_discount := round(p_discount);
    select coalesce(sum(amount), 0), count(*) into v_eligible, v_n from public.invoice_items
     where invoice_id = v_inv and item_type <> 'card_topup' and amount > 0;
    if p_discount > v_eligible then raise exception 'Giảm giá lớn hơn tổng tiền dịch vụ / gói'; end if;
    v_left := p_discount; v_k := 0;
    -- chia theo đúng thứ tự dòng gửi lên, dòng cuối nhận phần lẻ (giao diện tính y hệt)
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

  -- ---- chia doanh số ----
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

  -- ---- thanh toán ----
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

-- ============ 4. HUỶ HOÁ ĐƠN ĐÃ THU (chỉ chủ spa) ============
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
    if exists (select 1 from public.customer_package_services where customer_package_id = v_rec.id and used_qty > 0)
       or exists (select 1 from public.appointment_services where customer_package_id = v_rec.id) then
      raise exception 'Gói bán trong hoá đơn này đã được dùng, không huỷ được';
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
    update public.appointment_services set customer_package_id = null where appointment_id = v_inv.appointment_id;
  end if;
end $$;
revoke execute on function public.void_invoice(uuid, text) from public, anon;
grant execute on function public.void_invoice(uuid, text) to authenticated;

-- ============ 5. GÓI COMBO ============
-- p_services: [{"service_id": "...", "quantity": 10}]
-- Sửa gói không ảnh hưởng gói khách đã mua (số buổi được chép lúc mua).
create or replace function public.save_package(
  p_id uuid, p_name text, p_price numeric, p_validity_days int, p_description text,
  p_is_active boolean, p_services jsonb
)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid := p_id;
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ chủ / quản lý được sửa gói combo'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Vui lòng nhập tên gói'; end if;
  if p_price is null or p_price < 0 then raise exception 'Giá gói không hợp lệ'; end if;
  if p_validity_days is not null and p_validity_days <= 0 then raise exception 'Hạn dùng phải lớn hơn 0 ngày'; end if;
  if p_services is null or jsonb_array_length(p_services) = 0 then raise exception 'Gói cần ít nhất 1 dịch vụ'; end if;

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
    delete from public.package_services where package_id = v_id;
  end if;

  insert into public.package_services (package_id, service_id, quantity)
  select v_id, (s->>'service_id')::uuid, sum((s->>'quantity')::int)
    from jsonb_array_elements(p_services) s
   group by (s->>'service_id')::uuid;
  return v_id;
end $$;
revoke execute on function public.save_package(uuid, text, numeric, int, text, boolean, jsonb) from public, anon;
grant execute on function public.save_package(uuid, text, numeric, int, text, boolean, jsonb) to authenticated;
