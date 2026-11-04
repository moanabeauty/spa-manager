-- Mã khách hàng (KH00001…) + tìm khách theo SĐT / mã KH / tên (không cần gõ dấu), trả gợi ý kèm gói, số dư thẻ

-- bỏ dấu tiếng Việt để tìm "nguyen thi" ra "Nguyễn Thị"
create or replace function public.vn_fold(p text)
 returns text language sql immutable parallel safe set search_path to ''
as $$
  select translate(lower(normalize(coalesce(p, ''), NFC)),
    'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ',
    'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd')
$$;

create sequence if not exists public.customer_code_seq;
alter table public.customers add column if not exists code text;

do $$
declare r record;
begin
  for r in select id from public.customers where code is null order by created_at, id loop
    update public.customers set code = 'KH' || lpad(nextval('public.customer_code_seq')::text, 5, '0') where id = r.id;
  end loop;
end $$;

alter table public.customers
  alter column code set default ('KH' || lpad(nextval('public.customer_code_seq')::text, 5, '0')),
  alter column code set not null;
alter table public.customers add constraint customers_code_key unique (code);
alter table public.customers add column if not exists search_name text
  generated always as (public.vn_fold(full_name)) stored;
create index if not exists customers_search_name_idx on public.customers (search_name);

-- Gợi ý khách: gõ SĐT (từ 3 số), mã KH (KH12 / 12), hoặc tên (không dấu, nhiều từ)
create or replace function public.search_customers(p_q text, p_limit int default 8)
 returns table(id uuid, code text, full_name text, phone text, note text, home_branch_id uuid,
               packages_left int, card_balance numeric, last_visit timestamptz)
 language plpgsql stable security definer set search_path to ''
as $$
declare
  v_q text := btrim(coalesce(p_q, ''));
  v_fold text := public.vn_fold(btrim(coalesce(p_q, '')));
  v_digits text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g');
  v_code text := upper(regexp_replace(coalesce(p_q, ''), '\s', '', 'g'));
  v_words text[];
begin
  if not public.is_staff() or public.my_role()::text = 'warehouse' then
    raise exception 'Chỉ nhân viên tìm được khách hàng';
  end if;
  if length(v_q) < 2 then return; end if;
  if v_digits like '84%' and length(v_digits) = 11 then v_digits := '0' || substr(v_digits, 3); end if;
  if v_code ~ '^\d{1,5}$' then v_code := 'KH' || lpad(v_code, 5, '0'); end if;
  if v_code ~ '^KH\d{1,5}$' then v_code := 'KH' || lpad(substr(v_code, 3), 5, '0'); end if;
  v_words := array_remove(regexp_split_to_array(v_fold, '\s+'), '');

  return query
  with hits as (
    select c.*,
           case when c.code = v_code then 0
                when length(v_digits) >= 3 and c.phone = v_digits then 1
                when length(v_digits) >= 3 and c.phone like v_digits || '%' then 2
                when length(v_digits) >= 3 and c.phone like '%' || v_digits || '%' then 3
                when c.search_name like v_fold || '%' then 4
                else 5 end as rank
      from public.customers c
     where c.code = v_code
        or (length(v_digits) >= 3 and c.phone like '%' || v_digits || '%')
        or (v_digits = '' and c.code ilike '%' || v_code || '%' and v_code ~ '^KH')
        or (array_length(v_words, 1) > 0
            and not exists (select 1 from unnest(v_words) w where position(w in c.search_name) = 0))
     order by rank, c.full_name
     limit least(greatest(coalesce(p_limit, 8), 1), 30)
  )
  select h.id, h.code, h.full_name, h.phone, h.note, h.home_branch_id,
         (select coalesce(sum(case when i.total_qty is null then 1 else greatest(i.total_qty - i.used_qty, 0) end), 0)::int
            from public.customer_packages cp join public.customer_package_items i on i.customer_package_id = cp.id
           where cp.customer_id = h.id and cp.is_active and (cp.expires_at is null or cp.expires_at >= now())),
         (select coalesce(sum(b.balance), 0) from public.service_card_balances b
            join public.service_cards sc on sc.id = b.card_id and sc.is_active where b.customer_id = h.id),
         (select max(a.start_at) from public.appointments a where a.customer_id = h.id and a.status = 'completed')
    from hits h
   order by h.rank, h.full_name;
end $$;
revoke execute on function public.search_customers(text, int) from public, anon;
grant execute on function public.search_customers(text, int) to authenticated;

-- ô tìm chung: thêm mã KH, tên không dấu
do $$
declare d text;
begin
  d := pg_get_functiondef('public.staff_search(text)'::regprocedure);
  d := replace(d,
    $x$select 'customer'::text, c.id, c.full_name, c.phone
      from public.customers c
     where c.full_name ilike '%' || v_q || '%'
        or (length(v_digits) >= 3 and c.phone like '%' || v_digits || '%')
     order by c.full_name limit 8;$x$,
    $x$select 'customer'::text, s.id, s.full_name, concat_ws(' · ', s.code, s.phone)
      from public.search_customers(v_q, 8) s;$x$);
  if position('search_customers' in d) = 0 then raise exception 'staff_search: không tìm thấy đoạn cần sửa'; end if;
  execute d;
end $$;

-- danh sách khách (CRM): tìm thêm theo mã KH và tên không dấu
do $$
declare d text;
begin
  d := pg_get_functiondef('public.crm_customers(text,text,uuid,uuid,uuid,integer)'::regprocedure);
  d := replace(d,
    $x$or c.full_name ilike '%' || v_q || '%')$x$,
    $x$or c.full_name ilike '%' || v_q || '%'
            or c.search_name like '%' || public.vn_fold(v_q) || '%'
            or c.code = upper(regexp_replace(v_q, '\s', '', 'g')))$x$);
  if position('vn_fold(v_q)' in d) = 0 then raise exception 'crm_customers: không tìm thấy đoạn cần sửa'; end if;
  execute d;
end $$;
