-- Mã khách theo nguyên tắc Moana (20/11/2026)
-- Trước: app tự đánh mã KH00001…, song song với mã M… trên sheet → nhân viên gõ số mã cũ (85 = M0085)
-- thì app ra KH00085 của người khác, kéo theo gói của người khác.
-- Nay: chỉ còn 1 hệ mã M…
--   * khách nhập từ sheet: dùng lại đúng mã trên sheet (M0085, M00363…)
--   * khách lẻ tạo trong app: M00418–M00421; khách mới sau này: M00422… tự động
--   * khách Long Biên: giữ mã L (L00039, L00050, L0008)
--   * tài khoản nhân viên / chủ / test: mã nội bộ NB01…, không chiếm số M

-- 1) khách nhập từ sheet -> mã cũ
update public.customers
   set code = upper(substring(note from 'Mã KH cũ:\s*(M\d+)'))
 where note ~ 'Mã KH cũ:\s*M\d+';

-- 2) tài khoản nhân viên / chủ / test -> mã nội bộ NB01, NB02… (không chiếm số M)
with nb as (
  select id, row_number() over (order by created_at) n from public.customers
   where code in ('KH00001','KH00002','KH00003','KH00004','KH00005','KH00006','KH00007','KH00008',
                  'KH00009','KH00010','KH00011','KH00012','KH00013','KH00016','KH00018')
)
update public.customers c set code = 'NB' || lpad(nb.n::text, 2, '0') from nb where nb.id = c.id;

-- 3) khách Long Biên: giữ mã L của chi nhánh Long Biên (đang ghi trong tên)
update public.customers set code = 'L00039' where code = 'KH00017';
update public.customers set code = 'L00050' where code = 'KH00023';
update public.customers set code = 'L0008'  where code = 'KH00024';

-- khách lẻ tạo trong app -> đánh tiếp sau M00417
update public.customers set code = 'M00418' where code = 'KH00130';  -- C Trang Đào
update public.customers set code = 'M00419' where code = 'KH00131';  -- An Chu
update public.customers set code = 'M00420' where code = 'KH00132';  -- Anh DAvid
update public.customers set code = 'M00421' where code = 'KH00133';  -- Trang

-- còn sót mã KH (nếu có khách tạo thêm trước khi chạy) -> số M tiếp theo
with r as (select id, row_number() over (order by created_at) n from public.customers where code like 'KH%')
update public.customers c set code = 'M' || lpad((421 + r.n)::text, 5, '0') from r where r.id = c.id;

-- 4) khách mới: tiếp số sau mã M lớn nhất
select setval('public.customer_code_seq',
              greatest(417, (select max(substr(code, 2)::int) from public.customers where code ~ '^M\d+$')));
alter table public.customers alter column code set default ('M' || lpad(nextval('public.customer_code_seq')::text, 5, '0'));

-- 5) tìm khách: hiểu mã M (M0085 / m85 / chỉ gõ số 85), bỏ cách hiểu KH cũ
create or replace function public.search_customers(p_q text, p_limit integer default 8)
returns table(id uuid, code text, full_name text, phone text, note text, home_branch_id uuid,
              packages_left integer, card_balance numeric, last_visit timestamptz)
language plpgsql stable security definer set search_path to '' as $function$
declare
  v_q text := btrim(coalesce(p_q, ''));
  v_fold text := public.vn_fold(btrim(coalesce(p_q, '')));
  v_digits text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g');
  v_code text := upper(regexp_replace(coalesce(p_q, ''), '\s', '', 'g'));
  v_num int;              -- số trong mã khách: M0085 / m85 / 85 -> 85
  v_is_code boolean := false;
  v_words text[];
  v_see boolean := public.can_view_customer_phone();
  v_min int;
begin
  if not public.is_staff() or public.my_role()::text = 'marketing' then
    raise exception 'Chỉ nhân viên tìm được khách hàng';
  end if;
  if length(v_q) < 2 then return; end if;

  if v_code ~ '^[ML]\d{1,6}$' then        -- mã M / mã L (khách Long Biên)
    v_is_code := true;
    if v_code like 'M%' then v_num := substr(v_code, 2)::int; end if;
    v_digits := '';                       -- gõ mã thì không dò SĐT
  elsif v_code ~ '^\d{1,5}$' then
    v_num := v_code::int;                 -- chỉ gõ số: dò cả mã khách lẫn SĐT
  end if;

  if v_digits like '84%' and length(v_digits) = 11 then v_digits := '0' || substr(v_digits, 3); end if;
  v_min := case when v_see then 3 else 9 end;
  v_words := case when v_is_code then '{}'::text[]
                  else array_remove(regexp_split_to_array(v_fold, '\s+'), '') end;

  return query
  with hits as (
    select c.*,
           case when c.code = v_code then 0
                when v_num is not null and c.code ~ '^M\d+$' and substr(c.code, 2)::int = v_num then 0
                when v_is_code and c.code like v_code || '%' then 1
                when length(v_digits) >= v_min and c.phone = v_digits then 1
                when v_see and length(v_digits) >= 3 and c.phone like v_digits || '%' then 2
                when v_see and length(v_digits) >= 3 and c.phone like '%' || v_digits || '%' then 3
                when c.search_name like v_fold || '%' then 4
                else 5 end as rank
      from public.customers c
     where c.code = v_code
        or (v_num is not null and c.code ~ '^M\d+$' and substr(c.code, 2)::int = v_num)
        or (v_is_code and c.code like v_code || '%')
        or (length(v_digits) >= v_min and c.phone = v_digits)
        or (v_see and length(v_digits) >= 3 and c.phone like '%' || v_digits || '%')
        or (array_length(v_words, 1) > 0
            and not exists (select 1 from unnest(v_words) w where position(w in c.search_name) = 0))
     order by rank, c.full_name
     limit least(greatest(coalesce(p_limit, 8), 1), 30)
  )
  select h.id, h.code, h.full_name,
         case when v_see or h.phone = v_digits then h.phone end,
         h.note, h.home_branch_id,
         (select coalesce(sum(case when i.total_qty is null then 1 else greatest(i.total_qty - i.used_qty, 0) end), 0)::int
            from public.customer_packages cp join public.customer_package_items i on i.customer_package_id = cp.id
           where cp.customer_id = h.id and cp.is_active and (cp.expires_at is null or cp.expires_at >= now())),
         (select coalesce(sum(b.balance), 0) from public.service_card_balances b
            join public.service_cards sc on sc.id = b.card_id and sc.is_active where b.customer_id = h.id),
         (select max(a.start_at) from public.appointments a where a.customer_id = h.id and a.status = 'completed')
    from hits h
   order by h.rank, h.full_name;
end $function$;

-- 6) chặn trừ buổi combo của khách khác: buổi combo gắn vào lịch phải thuộc đúng khách của lịch
create or replace function public._check_package_item_owner()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_appt_cust uuid;
  v_item_cust uuid;
begin
  if new.customer_package_item_id is null then return new; end if;
  select customer_id into v_appt_cust from public.appointments where id = new.appointment_id;
  select cp.customer_id into v_item_cust
    from public.customer_package_items i join public.customer_packages cp on cp.id = i.customer_package_id
   where i.id = new.customer_package_item_id;
  if v_item_cust is distinct from v_appt_cust then
    raise exception 'Buổi combo này không thuộc khách của lịch hẹn – vui lòng chọn lại khách / liệu trình';
  end if;
  return new;
end $$;

drop trigger if exists trg_check_package_item_owner on public.appointment_services;
create trigger trg_check_package_item_owner
  before insert or update of customer_package_item_id, appointment_id on public.appointment_services
  for each row execute function public._check_package_item_owner();
