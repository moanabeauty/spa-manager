-- Tìm liệu trình: không bị cắt mất kết quả + tìm được theo tên nội bộ / sản phẩm trong quy trình
-- Lỗi cũ: ô tìm kiếm chung chỉ trả 8 liệu trình (ô của KTV 12), nên gõ "peel" thì mất
-- SENSITIVE ACNE PEEL, SOS PEEL, WHITE PEELING…; và gõ "Dermaquest", "Agrilac", "Azelac"
-- ở ô tìm kiếm chung không ra vì không tìm theo tên nội bộ.
-- Nay: tối đa 40 liệu trình; khớp tên truyền thông, diễn giải, tên nội bộ, nhóm, hoặc tên sản phẩm
-- dùng trong quy trình (bỏ qua dấu cách: "azelacru" = "AZELAC RU").

create or replace function public._service_match(p_service uuid, p_q text)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1
      from public.services s
      left join public.service_categories c on c.id = s.category_id
     where s.id = p_service
       and (s.name ilike '%' || p_q || '%' or s.name_en ilike '%' || p_q || '%'
            or s.internal_name ilike '%' || p_q || '%' or c.name ilike '%' || p_q || '%'
            or replace(coalesce(s.internal_name, ''), ' ', '') ilike '%' || replace(p_q, ' ', '') || '%'
            or exists (select 1 from public.service_procedure_steps st, unnest(st.products) pr
                        where st.service_id = s.id
                          and replace(pr, ' ', '') ilike '%' || replace(p_q, ' ', '') || '%'))
  );
$$;
revoke all on function public._service_match(uuid, text) from public, anon;

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
         concat_ws(' · ', case when nullif(s.name_en, '') is not null then s.name end,
                   case when s.internal_name is distinct from s.name then s.internal_name end, c.name),
         s.price, s.member_price,
         exists (select 1 from public.service_guides g where g.service_id = s.id)
    from public.services s
    left join public.service_categories c on c.id = s.category_id
   where s.is_active and public._service_match(s.id, v_q)
   order by 6 desc, (s.name_en ilike v_q || '%' or s.name ilike v_q || '%') desc, 2
   limit 40;
end $function$;

create or replace function public.staff_search_v3(p_q text)
returns table(kind text, id uuid, title text, subtitle text, capacity text, brand text, list_price numeric, min_price numeric)
language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if not public.is_staff() then raise exception 'Chỉ nhân viên dùng được tìm kiếm'; end if;
  if v_q is null or length(v_q) < 2 then return; end if;

  if public.my_role()::text <> 'warehouse' then
    return query
    select 'service'::text, s.id, coalesce(nullif(s.name_en, ''), s.name),
           concat_ws(' · ', case when nullif(s.name_en, '') is not null then s.name end,
                     case when s.internal_name is distinct from s.name then s.internal_name end, c.name),
           null::text, null::text, s.price, s.member_price
      from public.services s
      left join public.service_categories c on c.id = s.category_id
     where s.is_active and public._service_match(s.id, v_q)
     order by (exists (select 1 from public.service_guides g where g.service_id = s.id)) desc,
              (s.name_en ilike v_q || '%' or s.name ilike v_q || '%') desc, coalesce(s.name_en, s.name)
     limit 40;
  end if;

  return query select * from public.staff_search_v2(p_q);
end $function$;
