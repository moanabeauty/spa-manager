-- Tìm liệu trình cho app KTV (chỉ trả về liệu trình, không trả về khách / SĐT / hoá đơn)
create or replace function public.service_search(p_q text)
 returns table(id uuid, title text, subtitle text, list_price numeric, member_price numeric, has_guide boolean)
 language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if not public.is_staff() then raise exception 'Chỉ nhân viên dùng được tìm kiếm'; end if;
  if v_q is null or length(v_q) < 2 then return; end if;
  return query
  select s.id, coalesce(nullif(s.name_en, ''), s.name),
         concat_ws(' · ', case when nullif(s.name_en, '') is not null then s.name end, c.name),
         s.price, s.member_price,
         exists (select 1 from public.service_guides g where g.service_id = s.id)
    from public.services s
    left join public.service_categories c on c.id = s.category_id
   where s.is_active
     and (s.name ilike '%' || v_q || '%' or s.name_en ilike '%' || v_q || '%' or c.name ilike '%' || v_q || '%')
   order by 6 desc, (s.name_en ilike v_q || '%' or s.name ilike v_q || '%') desc, 2
   limit 12;
end $function$;

revoke execute on function public.service_search(text) from public, anon;
grant execute on function public.service_search(text) to authenticated;
