-- Bán sản phẩm lẻ trên màn hình Thu tiền.
-- Dòng "product": giá bán do người thu nhập, từ giá thấp nhất (giá niêm yết × (100% − % giảm tối đa)) đến giá niêm yết.
-- Bán trong khoảng này KHÔNG tính là giảm giá (không cần chủ spa duyệt). Giảm thêm vẫn theo quy tắc giảm giá cũ.
-- Kho bán lẻ của chi nhánh tự trừ khi chốt hoá đơn; huỷ hoá đơn thì nhập lại kho (đã có từ giai đoạn 4).

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
  v_min numeric;
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
      select id, name, price, member_price, card_allowed, is_active, duration_minutes
        into v_svc from public.services where id = v_ref;   -- không đọc cột ẩn (giá vốn, tiền KTV)
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

    elsif v_type = 'product' then
      -- bán lẻ: trừ kho bán lẻ của chi nhánh khi chốt hoá đơn (trigger invoices_before_status)
      if v_card_line then raise exception 'Thẻ tài khoản chỉ dùng để trả dịch vụ'; end if;
      v_ref := (v_item->>'product_id')::uuid;
      select name, capacity, retail_price, is_active, max_staff_discount_pct
        into v_rec from public.products where id = v_ref;   -- không đọc giá nhập
      if not found or not v_rec.is_active then raise exception 'Sản phẩm không tồn tại hoặc đã ngừng bán'; end if;
      if v_rec.retail_price is null then raise exception 'Sản phẩm "%" chưa có giá niêm yết', v_rec.name; end if;
      v_list := v_rec.retail_price;
      v_unit := round(coalesce(nullif(v_item->>'unit_price', '')::numeric, v_list));
      v_min := public.retail_min_price(v_list, v_rec.max_staff_discount_pct);
      if v_unit > v_list then raise exception 'Giá bán "%" không được cao hơn giá niêm yết', v_rec.name; end if;
      if v_unit < v_min then
        raise exception 'Giá bán "%" thấp nhất là %đ (giảm tối đa theo quy định)', v_rec.name, v_min;
      end if;
      v_desc := concat_ws(' ', v_rec.name, v_rec.capacity);

    else
      raise exception 'Loại dòng hoá đơn không hợp lệ: %', v_type;
    end if;

    if v_disc < 0 or v_disc > v_unit * v_qty then
      raise exception 'Giảm giá dòng "%" không hợp lệ', v_desc;
    end if;

    insert into public.invoice_items (invoice_id, item_type, service_id, package_id, product_id, topup_tier_id, description,
                                      quantity, unit_price, discount, paid_with_card, appointment_service_id, list_price)
    values (v_inv, v_type::public.invoice_item_type,
            case when v_type = 'service' then v_ref end,
            case when v_type = 'package' then v_ref end,
            case when v_type = 'product' then v_ref end,
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
    if p_discount > v_eligible then raise exception 'Giảm giá lớn hơn tổng tiền dịch vụ / gói / sản phẩm'; end if;
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

  if p_appointment_id is not null then
    if v_appt.status <> 'completed' then
      update public.appointments set status = 'completed' where id = p_appointment_id;
    end if;
  end if;
  return v_inv;
end $$;
revoke execute on function public.checkout_invoice(uuid, uuid, uuid, jsonb, jsonb, numeric, text) from public, anon;
grant execute on function public.checkout_invoice(uuid, uuid, uuid, jsonb, jsonb, numeric, text) to authenticated;

