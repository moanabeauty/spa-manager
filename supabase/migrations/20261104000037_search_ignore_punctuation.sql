-- Tìm kiếm chung: tên sản phẩm khớp cả khi gõ không có dấu chấm / khoảng trắng (lait sr → LAIT S.R.)

create or replace function public.staff_search(p_q text)
 returns table(kind text, id uuid, title text, subtitle text)
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
    select 'customer'::text, c.id, c.full_name, c.phone
      from public.customers c
     where c.full_name ilike '%' || v_q || '%'
        or (length(v_digits) >= 3 and c.phone like '%' || v_digits || '%')
     order by c.full_name limit 8;

    return query
    select 'invoice'::text, i.id, i.code,
           concat_ws(' · ', c.full_name, case when i.channel = 'online' then 'Online' end, sh.tracking_code)
      from public.invoices i
      left join public.customers c on c.id = i.customer_id
      left join public.invoice_shipments sh on sh.invoice_id = i.id
     where (i.code ilike '%' || v_q || '%' or sh.tracking_code ilike '%' || v_q || '%')
       and i.status <> 'draft'
       and (v_role in ('owner','manager','receptionist') or public.can_see_invoice(i.id))
     order by i.created_at desc limit 8;
  end if;

  -- mã vạch khớp đúng xếp lên đầu; gõ từ 4 ký tự trở lên thì khớp cả một phần mã vạch
  return query
  select 'product'::text, p.id, concat_ws(' ', p.name, p.capacity), concat_ws(' · ', p.brand, p.sku, p.barcode)
    from public.products p
   where p.is_active
     and (p.barcode = v_code
          or (length(v_code) >= 4 and p.barcode ilike '%' || v_code || '%')
          or p.name ilike '%' || v_q || '%' or p.sku ilike v_q || '%' or p.brand ilike '%' || v_q || '%'
          -- bỏ qua dấu chấm / khoảng trắng / gạch: "lait sr 250" khớp "LAIT S.R. 250 ML"
          or (length(v_flat) >= 2 and regexp_replace(lower(concat_ws(' ', p.name, p.capacity)), '[^a-z0-9]', '', 'g') like '%' || v_flat || '%'))
   order by (p.barcode = v_code) desc nulls last, p.name limit 8;
end $function$;

revoke execute on function public.staff_search(text) from public, anon;
grant execute on function public.staff_search(text) to authenticated;
