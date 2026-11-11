-- 1) GIÁ VỐN NHẬP TRƯỚC – XUẤT TRƯỚC (FIFO)
--    Mỗi lần xuất (bán lẻ, dùng cho liệu trình, điều chỉnh giảm…) hệ thống tự ghi giá vốn của lần xuất đó
--    vào stock_movements.unit_cost, lấy theo các lô nhập cũ nhất còn lại. Lãi/lỗ tính trên giá đã ghi lúc xuất,
--    nên sau này sửa giá / ngừng / xoá mã sản phẩm cũng không làm đổi sổ sách cũ.
--    Tính chung cho cả công ty theo từng sản phẩm; chuyển kho (transfer_in / transfer_out) không tính là nhập/xuất.
-- 2) XOÁ MÃ SẢN PHẨM: chủ / quản lý / NV kho, khi tổng tồn kho = 0 và không còn chứng từ đang chờ.
--    Chưa từng phát sinh gì → xoá hẳn. Đã có lịch sử → ẩn hẳn khỏi app (deleted_at), giữ nguyên lịch sử & giá vốn đã xuất.
-- 3) GỘP SẢN PHẨM: thêm NV kho; chuyển cả dòng phiếu nhập; sửa lỗi trùng dòng trong yêu cầu xuất kho.

-- ============ 1) FIFO ============
create or replace function public.stock_movements_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_qty int; v_name text;
  v_before numeric; v_need numeric; v_skip numeric; v_cost numeric := 0; v_fallback numeric;
  v_take numeric; v_avail numeric; l record;
begin
  if new.quantity < 0 then
    perform pg_advisory_xact_lock(hashtext(new.warehouse_id::text || new.product_id::text));
    select coalesce(sum(quantity), 0) into v_qty from public.stock_movements
     where warehouse_id = new.warehouse_id and product_id = new.product_id;
    if v_qty + new.quantity < 0 then
      select name into v_name from public.products where id = new.product_id;
      raise exception 'Không đủ hàng "%" trong kho (còn %)', v_name, v_qty;
    end if;

    -- giá vốn FIFO cho lần xuất này (bỏ qua chuyển kho)
    if new.movement_type <> 'transfer_out' and new.unit_cost is null then
      perform pg_advisory_xact_lock(hashtext('fifo' || new.product_id::text));
      select cost_price into v_fallback from public.products where id = new.product_id;
      select coalesce(sum(-quantity), 0) into v_before from public.stock_movements
       where product_id = new.product_id and quantity < 0 and movement_type <> 'transfer_out';
      v_need := -new.quantity;
      v_skip := v_before;
      for l in
        select quantity::numeric as q, coalesce(unit_cost, v_fallback, 0) as c
          from public.stock_movements
         where product_id = new.product_id and quantity > 0 and movement_type <> 'transfer_in'
         order by created_at, id
      loop
        v_take := least(v_skip, l.q);
        v_skip := v_skip - v_take;
        v_avail := l.q - v_take;
        if v_avail > 0 then
          v_take := least(v_avail, v_need);
          v_cost := v_cost + v_take * l.c;
          v_need := v_need - v_take;
        end if;
        exit when v_need <= 0;
      end loop;
      if v_need > 0 then v_cost := v_cost + v_need * coalesce(v_fallback, 0); end if;
      new.unit_cost := round(v_cost / (-new.quantity));  -- cột unit_cost là số nguyên (đồng)
    end if;
  end if;
  return new;
end $$;

-- ============ 2) XOÁ MÃ SẢN PHẨM ============
alter table public.products add column if not exists deleted_at timestamptz;
alter table public.products add column if not exists deleted_by uuid references auth.users(id);

drop function if exists public.delete_product(uuid);  -- đổi kiểu trả về (void → text)

create or replace function public.delete_product(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  p public.products;
  v_stock text;
  v_wait text[] := '{}';
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if not public.has_role('owner', 'manager', 'warehouse') then
    raise exception 'Chỉ chủ spa, quản lý hoặc NV kho được xoá mã sản phẩm';
  end if;
  select * into p from public.products where id = p_id and deleted_at is null for update;
  if p.id is null then raise exception 'Không tìm thấy sản phẩm'; end if;

  -- còn tồn ở kho nào thì không cho xoá
  select string_agg(w.name || ': ' || s.q, ', ') into v_stock
    from (select warehouse_id, sum(quantity) q from public.stock_movements
           where product_id = p_id group by warehouse_id having sum(quantity) <> 0) s
    join public.warehouses w on w.id = s.warehouse_id;
  if v_stock is not null then
    raise exception 'Không xoá được vì còn tồn kho (%). Xuất / kiểm kho về 0 trước khi xoá.', v_stock;
  end if;

  -- chứng từ đang chờ xử lý có sản phẩm này
  if exists (select 1 from public.stock_receipt_items i join public.stock_receipts r on r.id = i.receipt_id
              where i.product_id = p_id and r.status = 'pending') then v_wait := v_wait || 'phiếu nhập chờ duyệt'; end if;
  if exists (select 1 from public.stock_request_items i join public.stock_requests r on r.id = i.request_id
              where i.product_id = p_id and r.status = 'pending') then v_wait := v_wait || 'yêu cầu xuất kho chờ duyệt'; end if;
  if exists (select 1 from public.stock_count_items i join public.stock_counts c on c.id = i.count_id
              where i.product_id = p_id and c.status = 'pending') then v_wait := v_wait || 'phiếu kiểm kho chờ duyệt'; end if;
  if exists (select 1 from public.invoice_items i join public.invoices v on v.id = i.invoice_id
              where i.product_id = p_id and v.status = 'draft') then v_wait := v_wait || 'hoá đơn chưa thanh toán'; end if;
  if exists (select 1 from public.promotion_items i join public.promotions m on m.id = i.promotion_id
              where i.product_id = p_id and m.is_active and (m.end_date is null or m.end_date >= v_today)) then
    v_wait := v_wait || 'gói khuyến mãi đang chạy';
  end if;
  if array_length(v_wait, 1) > 0 then
    raise exception 'Không xoá được vì sản phẩm đang nằm trong: %. Xử lý xong các chứng từ này rồi xoá.', array_to_string(v_wait, ', ');
  end if;

  -- chưa từng phát sinh gì → xoá hẳn
  if not exists (select 1 from public.stock_movements where product_id = p_id)
     and not exists (select 1 from public.stock_receipt_items where product_id = p_id)
     and not exists (select 1 from public.invoice_items where product_id = p_id)
     and not exists (select 1 from public.stock_request_items where product_id = p_id)
     and not exists (select 1 from public.stock_count_items where product_id = p_id)
     and not exists (select 1 from public.promotion_items where product_id = p_id) then
    delete from public.products where id = p_id;
    return 'deleted';
  end if;

  -- đã có lịch sử → ẩn khỏi app, giữ lịch sử; nhả mã SP & mã vạch để dùng lại được
  update public.products
     set deleted_at = now(), deleted_by = auth.uid(), is_active = false, sku = null, barcode = null,
         note = concat_ws(' · ', nullif(note, ''),
                'Đã xoá ' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY')
                || coalesce(' · mã cũ ' || p.sku, '') || coalesce(' · mã vạch cũ ' || p.barcode, ''))
   where id = p_id;
  return 'hidden';
end $$;
revoke execute on function public.delete_product(uuid) from public, anon;
grant execute on function public.delete_product(uuid) to authenticated;

-- ============ 3) GỘP SẢN PHẨM ============
create or replace function public.merge_products(p_keep uuid, p_drop uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d public.products;
  k public.products;
begin
  if not public.has_role('owner', 'manager', 'warehouse') then raise exception 'Chỉ chủ, quản lý hoặc NV kho được gộp sản phẩm'; end if;
  if p_keep is null or p_drop is null or p_keep = p_drop then raise exception 'Chọn 2 sản phẩm khác nhau để gộp'; end if;
  select * into k from public.products where id = p_keep and deleted_at is null for update;
  select * into d from public.products where id = p_drop and deleted_at is null for update;
  if k.id is null or d.id is null then raise exception 'Không tìm thấy sản phẩm'; end if;

  -- kiểm kho: cùng 1 phiếu có cả 2 sản phẩm thì cộng dồn vào sản phẩm giữ lại
  update public.stock_count_items ki
     set system_qty = ki.system_qty + di.system_qty, counted_qty = ki.counted_qty + di.counted_qty
    from public.stock_count_items di
   where ki.product_id = p_keep and di.product_id = p_drop and di.count_id = ki.count_id;
  delete from public.stock_count_items di
   where di.product_id = p_drop
     and exists (select 1 from public.stock_count_items ki where ki.count_id = di.count_id and ki.product_id = p_keep);
  update public.stock_count_items set product_id = p_keep where product_id = p_drop;

  -- yêu cầu xuất kho: cùng 1 yêu cầu có cả 2 sản phẩm thì cộng dồn số lượng
  update public.stock_request_items ki
     set quantity = ki.quantity + di.quantity
    from public.stock_request_items di
   where ki.product_id = p_keep and di.product_id = p_drop and di.request_id = ki.request_id;
  delete from public.stock_request_items di
   where di.product_id = p_drop
     and exists (select 1 from public.stock_request_items ki where ki.request_id = di.request_id and ki.product_id = p_keep);
  update public.stock_request_items set product_id = p_keep where product_id = p_drop;

  update public.stock_movements set product_id = p_keep where product_id = p_drop;   -- tồn kho tính từ bảng này
  update public.stock_receipt_items set product_id = p_keep where product_id = p_drop; -- phiếu nhập (kể cả phiếu chờ duyệt)
  update public.invoice_items set product_id = p_keep where product_id = p_drop;
  update public.promotion_items set product_id = p_keep where product_id = p_drop;

  -- sản phẩm bị gộp: bỏ mã vạch (mã vạch là duy nhất) và ngừng lưu hành
  update public.products
     set is_active = false, barcode = null,
         note = concat_ws(' · ', nullif(note, ''), 'Đã gộp vào ' || concat_ws(' ', k.brand, k.name, k.capacity))
   where id = p_drop;

  -- sản phẩm giữ lại: dùng cả 2, ô nào còn trống thì lấy từ sản phẩm bị gộp
  update public.products
     set for_treatment = true,
         for_retail = true,
         is_active = true,
         barcode = coalesce(k.barcode, d.barcode),
         brand = coalesce(nullif(k.brand, ''), d.brand),
         capacity = coalesce(nullif(k.capacity, ''), d.capacity),
         category = coalesce(k.category, d.category),
         used_in = coalesce(k.used_in, d.used_in),
         retail_price = coalesce(k.retail_price, d.retail_price),
         cost_price = coalesce(k.cost_price, d.cost_price),
         supplier_list_price = coalesce(k.supplier_list_price, d.supplier_list_price),
         max_staff_discount_pct = coalesce(k.max_staff_discount_pct, d.max_staff_discount_pct),
         expiry_date = least(k.expiry_date, d.expiry_date),
         min_stock = greatest(k.min_stock, d.min_stock)
   where id = p_keep;
  perform public.refresh_product_expiry(p_keep);
end $$;
revoke execute on function public.merge_products(uuid, uuid) from public, anon;
grant execute on function public.merge_products(uuid, uuid) to authenticated;
