-- 1) Sửa lỗi hiển thị định lượng lẻ: to_char(…, 'FM999999990.###') làm tròn 0,4 → "0", 0,5 → "1";
--    'FM999999990.999' thì ra "3." với số tròn. Dùng chung 1 hàm định dạng: 0,4 · 2,5 · 3.
create or replace function public._fmt_qty(p numeric)
returns text language sql immutable set search_path = '' as $$
  select replace(trim_scale(round(p, 3))::text, '.', ',')
$$;
grant execute on function public._fmt_qty(numeric) to authenticated;

do $$
declare f regprocedure; d text;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public','private') and p.prosrc ~ 'FM999999990\.(###|999)'
  loop
    d := pg_get_functiondef(f);
    d := regexp_replace(d, 'trim\(to_char\(([^,()]+), ''FM999999990\.(###|999)''\)\)', 'public._fmt_qty(\1)', 'g');
    execute d;
  end loop;
end $$;

-- sửa lại nội dung các yêu cầu đã gửi bị hiện sai số (vd "0 ml" thay vì "0,4 ml")
update public.procedure_change_requests
   set to_product = regexp_replace(to_product, ' · [0-9.]+ ?([^ ·]*)$', ' · ' || public._fmt_qty(new_qty) || ' \1')
 where kind in ('swap','add_product','add_step') and new_qty is not null and to_product ~ ' · [0-9.]+ ?([^ ·]*)$';
update public.procedure_change_requests
   set to_product = regexp_replace(to_product, '^Định lượng mới [0-9.]+', 'Định lượng mới ' || public._fmt_qty(new_qty))
 where kind = 'qty' and new_qty is not null;
update public.procedure_change_requests c
   set from_product = regexp_replace(c.from_product, ' · [0-9.]+ ([^ ·]*)$', ' · ' || public._fmt_qty(i.qty) || ' \1')
  from public.service_step_items i
 where c.kind = 'qty' and c.item_id = i.id and i.qty is not null and c.from_product ~ ' · [0-9.]+ ([^ ·]*)$';

-- 2) Gợi ý định lượng: KTV chọn sản phẩm → hệ thống gợi ý lượng / buổi theo các liệu trình khác đang dùng sản phẩm đó
create or replace function public.product_dose_hint(p_product uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with uses as (
    select s.id service_id, coalesce(nullif(s.name_en, ''), s.name) service, i.qty
      from public.service_step_items i
      join public.services s on s.id = i.service_id
     where i.qty is not null and i.qty > 0
       and (i.product_id = p_product or p_product = any(coalesce(i.alt_product_ids, '{}'::uuid[])))
  ),
  approved as ( -- lượng quản lý đã duyệt khi KTV đổi / thêm sản phẩm này
    select c.new_qty qty from public.procedure_change_requests c
     where c.to_product_id = p_product and c.status = 'approved' and c.new_qty is not null
       and c.kind in ('swap','add_product','add_step')
  ),
  counts as (
    select qty, count(*) n from (select qty from uses union all select qty from approved) x group by qty
  )
  select jsonb_build_object(
    'unit', (select public.volume_unit(capacity, unit) from public.products where id = p_product),
    'suggest', (select qty from counts order by n desc, qty limit 1),
    'options', coalesce((select jsonb_agg(qty order by n desc, qty) from (select * from counts order by n desc, qty limit 4) o), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('name', service, 'qty', qty) order by service)
                            from (select distinct on (service_id) service_id, service, qty from uses order by service_id, qty) u), '[]'::jsonb)
  )
$$;
revoke execute on function public.product_dose_hint(uuid) from public, anon;
grant execute on function public.product_dose_hint(uuid) to authenticated;
