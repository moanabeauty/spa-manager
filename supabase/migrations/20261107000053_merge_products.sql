-- Hóa đơn đã chốt: cho phép đổi liên kết sản phẩm (khi gộp sản phẩm), nội dung hóa đơn giữ nguyên
create or replace function public.ensure_invoice_draft()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status public.invoice_status;
begin
  -- dịch vụ trong lịch bị xoá / sản phẩm được gộp: chỉ đổi liên kết trên hoá đơn cũ, không đổi nội dung
  if tg_op = 'UPDATE' and tg_table_name = 'invoice_items'
     and (to_jsonb(new) - 'appointment_service_id' - 'amount' - 'product_id')
       = (to_jsonb(old) - 'appointment_service_id' - 'amount' - 'product_id') then
    return new;
  end if;
  select status into v_status from public.invoices
   where id = case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'Hoá đơn đã chốt, không sửa được';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- Gộp 2 sản phẩm trùng mã vạch thành 1 (vd cùng 1 chai vừa nằm ở danh sách hàng liệu trình, vừa ở hàng bán lẻ).
-- Sản phẩm giữ lại (p_keep) được bật cả "Hàng liệu trình" + "Hàng bán lẻ"; tồn kho, lịch sử nhập/xuất,
-- hóa đơn, yêu cầu xuất kho, kiểm kho, khuyến mãi của sản phẩm bị gộp (p_drop) chuyển sang p_keep.
-- Sản phẩm bị gộp chuyển sang Ngừng lưu hành. Chỉ chủ / quản lý.
create or replace function public.merge_products(p_keep uuid, p_drop uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d public.products;
  k public.products;
begin
  if not public.has_role('owner', 'manager') then raise exception 'Chỉ chủ hoặc quản lý được gộp sản phẩm'; end if;
  if p_keep is null or p_drop is null or p_keep = p_drop then raise exception 'Chọn 2 sản phẩm khác nhau để gộp'; end if;
  select * into k from public.products where id = p_keep for update;
  select * into d from public.products where id = p_drop for update;
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

  update public.stock_movements set product_id = p_keep where product_id = p_drop;   -- tồn kho tính từ bảng này
  update public.invoice_items set product_id = p_keep where product_id = p_drop;
  update public.stock_request_items set product_id = p_keep where product_id = p_drop;
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
         max_staff_discount_pct = coalesce(k.max_staff_discount_pct, d.max_staff_discount_pct),
         expiry_date = least(k.expiry_date, d.expiry_date),
         min_stock = greatest(k.min_stock, d.min_stock)
   where id = p_keep;
end $$;
revoke execute on function public.merge_products(uuid, uuid) from public, anon;
grant execute on function public.merge_products(uuid, uuid) to authenticated;
