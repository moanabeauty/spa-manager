-- Bán hàng online (26/11/2026): nhân viên lên đơn cho khách, giao hàng, theo dõi tiền.
-- Hàng đã lên đơn = GIỮ HÀNG (chưa trừ kho, nhưng không bán cho người khác được).
-- Hàng đi rồi (chuyển "Đang giao" / "Đã giao") = TRỪ KHO thật.
-- Hoàn hàng sau khi đã gửi = nhập lại kho. Hoàn hàng khi chưa gửi = bỏ giữ hàng.

create or replace function pg_temp.patch_fn(p_sig text, p_old text, p_new text)
returns void language plpgsql as $$
declare d text := pg_get_functiondef(p_sig::regprocedure);
begin
  if position(p_old in d) = 0 then raise exception 'Không tìm thấy đoạn cần sửa trong %', p_sig; end if;
  execute replace(d, p_old, p_new);
end $$;

alter table public.invoice_shipments
  add column stock_out_at timestamptz,   -- lúc hàng rời kho (đã trừ tồn)
  add column stock_back_at timestamptz;  -- lúc hàng hoàn đã nhập lại kho

-- ---------------------------------------------------------------------
-- 1. Số lượng đang giữ cho đơn online (theo kho bán lẻ của chi nhánh)
-- ---------------------------------------------------------------------
create or replace function public.online_reserved_stock()
returns table (warehouse_id uuid, branch_id uuid, product_id uuid, quantity numeric)
language sql stable security definer set search_path = '' as $$
  select w.id, i.branch_id, ii.product_id, sum(ii.quantity)::numeric
    from public.invoices i
    join public.invoice_items ii on ii.invoice_id = i.id and ii.item_type = 'product'
    join public.warehouses w on w.branch_id = i.branch_id and w.type = 'retail'
    left join public.invoice_shipments s on s.invoice_id = i.id
   where i.channel = 'online' and i.status = 'paid'
     and s.stock_out_at is null and coalesce(s.status, 'preparing') <> 'returned'
   group by w.id, i.branch_id, ii.product_id
$$;
revoke execute on function public.online_reserved_stock() from public, anon;
grant execute on function public.online_reserved_stock() to authenticated;

-- ---------------------------------------------------------------------
-- 2. Chốt hoá đơn: kiểm tra còn hàng trừ phần đã giữ; đơn online chỉ giữ hàng, chưa trừ kho
-- ---------------------------------------------------------------------
select pg_temp.patch_fn('public.invoices_before_status()',
  $o$  new.paid_at := coalesce(new.paid_at, now());
$o$,
  $n$  new.paid_at := coalesce(new.paid_at, now());

  -- còn bán được = tồn thực − hàng đang giữ cho đơn online khác
  for v_item in
    select ii.product_id, sum(ii.quantity) as qty, p.name
      from public.invoice_items ii join public.products p on p.id = ii.product_id
     where ii.invoice_id = new.id and ii.item_type = 'product'
     group by ii.product_id, p.name
  loop
    select id into v_wh from public.warehouses where branch_id = new.branch_id and type = 'retail';
    if v_wh is null then raise exception 'Chi nhánh chưa có kho bán lẻ'; end if;
    perform pg_advisory_xact_lock(hashtext(v_wh::text || v_item.product_id::text));
    v_total := coalesce((select sum(quantity) from public.stock_movements where warehouse_id = v_wh and product_id = v_item.product_id), 0);
    v_bonus := coalesce((select r.quantity from public.online_reserved_stock() r where r.warehouse_id = v_wh and r.product_id = v_item.product_id), 0);
    if v_total - v_bonus < v_item.qty then
      if v_bonus > 0 then
        raise exception 'Không đủ hàng "%" (tồn %, đang giữ cho đơn online %, còn bán được %)', v_item.name, v_total, v_bonus, greatest(v_total - v_bonus, 0);
      end if;
      raise exception 'Không đủ hàng "%" trong kho (còn %)', v_item.name, v_total;
    end if;
  end loop;
$n$);

select pg_temp.patch_fn('public.invoices_before_status()',
  $o$    elsif v_item.item_type = 'product' then
      select id into v_wh$o$,
  $n$    elsif v_item.item_type = 'product' and new.channel = 'online' then
      null; -- đơn online: chỉ giữ hàng, trừ kho khi chuyển "Đang giao"

    elsif v_item.item_type = 'product' then
      select id into v_wh$n$);

-- ---------------------------------------------------------------------
-- 3. Cập nhật giao hàng: hàng đi → trừ kho; hoàn hàng → nhập lại kho
-- ---------------------------------------------------------------------
create or replace function public.update_shipment(p_invoice uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_status text := coalesce(nullif(p->>'status', ''), 'preparing');
  v_inv record;
  v_old record;
  v_wh uuid;
begin
  if not public.has_role('owner','manager','receptionist','technician') then raise exception 'Bạn không có quyền sửa đơn giao hàng'; end if;
  if not public.can_see_invoice(p_invoice) then raise exception 'Bạn không xem được hoá đơn này'; end if;
  select * into v_inv from public.invoices where id = p_invoice for update;
  if not found or v_inv.channel <> 'online' then raise exception 'Chỉ hoá đơn online mới có thông tin giao hàng'; end if;
  if v_inv.status = 'cancelled' then raise exception 'Đơn đã huỷ'; end if;
  if v_status not in ('preparing','shipping','delivered','returned') then raise exception 'Trạng thái giao hàng không hợp lệ'; end if;
  if v_inv.status = 'draft' then v_status := 'preparing'; end if; -- lúc mới lên đơn: luôn là đang chuẩn bị (giữ hàng)

  select * into v_old from public.invoice_shipments where invoice_id = p_invoice for update;
  if found then
    if v_old.status = 'returned' and v_status <> 'returned' then
      raise exception 'Đơn đã hoàn hàng, không đổi trạng thái được (lên đơn mới nếu khách mua lại)';
    end if;
    if v_old.stock_out_at is not null and v_status = 'preparing' then
      raise exception 'Hàng đã xuất kho, không đưa về "Đang chuẩn bị" được';
    end if;
  end if;

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

  if v_inv.status <> 'paid' then return; end if;
  select * into v_old from public.invoice_shipments where invoice_id = p_invoice;
  select id into v_wh from public.warehouses where branch_id = v_inv.branch_id and type = 'retail';

  -- hàng rời kho → trừ tồn
  if v_status in ('shipping','delivered') and v_old.stock_out_at is null then
    if v_wh is null then raise exception 'Chi nhánh chưa có kho bán lẻ'; end if;
    insert into public.stock_movements (warehouse_id, product_id, movement_type, quantity, invoice_item_id, note)
    select v_wh, ii.product_id, 'export_sale', -ii.quantity, ii.id, 'Gửi hàng đơn online ' || v_inv.code
      from public.invoice_items ii where ii.invoice_id = p_invoice and ii.item_type = 'product';
    update public.invoice_shipments set stock_out_at = now() where invoice_id = p_invoice;
  end if;

  -- hoàn hàng sau khi đã gửi → nhập lại kho (giữ giá vốn lúc xuất)
  if v_status = 'returned' and v_old.stock_out_at is not null and v_old.stock_back_at is null then
    insert into public.stock_movements (warehouse_id, product_id, movement_type, quantity, unit_cost, invoice_item_id, note)
    select m.warehouse_id, m.product_id, 'adjustment', -m.quantity, m.unit_cost, m.invoice_item_id, 'Nhập lại hàng hoàn – đơn online ' || v_inv.code
      from public.stock_movements m join public.invoice_items ii on ii.id = m.invoice_item_id
     where ii.invoice_id = p_invoice and m.movement_type = 'export_sale';
    update public.invoice_shipments set stock_back_at = now() where invoice_id = p_invoice;
  end if;
end $$;
revoke execute on function public.update_shipment(uuid, jsonb) from public, anon;
grant execute on function public.update_shipment(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Huỷ hoá đơn: chỉ nhập lại phần hàng còn đang ở ngoài kho (đơn chưa gửi / đã hoàn thì không nhập thêm)
-- ---------------------------------------------------------------------
select pg_temp.patch_fn('public.void_invoice(uuid, text)',
  $o$  select m.warehouse_id, m.product_id, 'adjustment', -m.quantity, m.invoice_item_id, 'Nhập lại do huỷ hoá đơn ' || v_inv.code
    from public.stock_movements m join public.invoice_items ii on ii.id = m.invoice_item_id
   where ii.invoice_id = p_invoice and m.movement_type = 'export_sale';$o$,
  $n$  select m.warehouse_id, m.product_id, 'adjustment', -sum(m.quantity), m.invoice_item_id, 'Nhập lại do huỷ hoá đơn ' || v_inv.code
    from public.stock_movements m join public.invoice_items ii on ii.id = m.invoice_item_id
   where ii.invoice_id = p_invoice and m.movement_type in ('export_sale','adjustment')
   group by m.warehouse_id, m.product_id, m.invoice_item_id
  having sum(m.quantity) < 0;$n$);
