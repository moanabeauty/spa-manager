-- Tìm kiếm chung: gợi ý sản phẩm bán lẻ hiện Tên · Dung tích · Nhãn hàng · Giá niêm yết · Giá bán thấp nhất của KTV.
-- Thêm 4 cột trả về (capacity, brand, list_price, min_price) → tạo hàm mới staff_search_v2 (giữ hàm cũ, không xoá).
-- Giá chỉ trả cho sản phẩm bán lẻ (for_retail); sản phẩm chỉ dùng liệu trình thì để trống.

create or replace function public.staff_search_v2(p_q text)
 returns table(kind text, id uuid, title text, subtitle text,
               capacity text, brand text, list_price numeric, min_price numeric)
 language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
  v_digits text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g');
  v_code text := regexp_replace(coalesce(p_q, ''), '\s', '', 'g');
  v_role text := public.my_role()::text;
  v_flat text := regexp_replace(lower(coalesce(p_q, '')), '[^a-z0-9]', '', 'g');
begin
  if not public.is_staff() then raise exception 'Chỉ nhân viên dùng được tìm kiếm'; end if;
  if v_q is null or length(v_q) < 2 then return; end if;
  if v_code ~ '^\d{12}$' then v_code := '0' || v_code; end if;
  if v_digits like '84%' and length(v_digits) = 11 then v_digits := '0' || substr(v_digits, 3); end if;

  if v_role <> 'warehouse' then
    return query
    select 'customer'::text, s.id, s.full_name, concat_ws(' · ', s.code, s.phone),
           null::text, null::text, null::numeric, null::numeric
      from public.search_customers(v_q, 8) s;

    return query
    select 'invoice'::text, i.id, i.code,
           concat_ws(' · ', c.full_name, case when i.channel = 'online' then 'Online' end, sh.tracking_code),
           null::text, null::text, null::numeric, null::numeric
      from public.invoices i
      left join public.customers c on c.id = i.customer_id
      left join public.invoice_shipments sh on sh.invoice_id = i.id
     where (i.code ilike '%' || v_q || '%' or sh.tracking_code ilike '%' || v_q || '%')
       and i.status <> 'draft'
       and (v_role in ('owner','manager','receptionist') or public.can_see_invoice(i.id))
     order by i.created_at desc limit 8;
  end if;

  -- mã vạch khớp đúng xếp lên đầu, rồi đến hàng bán lẻ
  return query
  select 'product'::text, p.id, p.name,
         case when p.for_retail then null else 'Chỉ dùng liệu trình' end,
         p.capacity, p.brand,
         case when p.for_retail then p.retail_price end,
         case when p.for_retail and p.retail_price is not null
              then public.retail_min_price(p.retail_price, p.max_staff_discount_pct) end
    from public.products p
   where p.is_active
     and (p.barcode = v_code
          or (length(v_code) >= 4 and p.barcode ilike '%' || v_code || '%')
          or p.name ilike '%' || v_q || '%' or p.sku ilike v_q || '%' or p.brand ilike '%' || v_q || '%'
          or (length(v_flat) >= 2 and regexp_replace(lower(concat_ws(' ', p.name, p.capacity)), '[^a-z0-9]', '', 'g') like '%' || v_flat || '%'))
   order by (p.barcode = v_code) desc nulls last, p.for_retail desc, p.name limit 8;
end $function$;

revoke execute on function public.staff_search_v2(text) from public, anon;
grant execute on function public.staff_search_v2(text) to authenticated;
