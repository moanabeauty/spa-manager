-- Báo cáo tổng quan theo tuần / tháng / năm:
--   Doanh thu thực  = tiền mặt + chuyển khoản + POS khách trả trong kỳ (gồm thu nợ) − hoàn tiền
--   Doanh thu thuần = giá trị dịch vụ / sản phẩm đã làm, bán cho khách, quy ra tiền thật:
--                     dịch vụ lẻ + sản phẩm (đã trừ giảm giá) + dịch vụ trừ thẻ × mệnh giá/(mệnh giá + tặng)
--                     + buổi combo đã làm × (giá gói / tổng giá lẻ của gói)
--   Nợ khách hàng   = tại cuối kỳ: số dư thẻ × mệnh giá/(mệnh giá + tặng) + combo còn buổi × tỉ lệ giá gói
-- Nhóm liệu trình xếp theo doanh thu thuần.

create or replace function public.report_overview(p_from date, p_to date, p_branch uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_asof date := least(p_to, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_cut timestamptz := ((least(p_to, (now() at time zone 'Asia/Ho_Chi_Minh')::date) + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh');
  v jsonb;
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ chủ spa / quản lý xem được báo cáo'; end if;

  with
  inv as (
    select i.id, i.branch_id, i.debt_amount, (i.paid_at at time zone 'Asia/Ho_Chi_Minh')::date as day, i.discount,
           (select coalesce(sum(x.amount), 0) from public.invoice_items x where x.invoice_id = i.id and not x.paid_with_card) as noncard
      from public.invoices i
     where i.status = 'paid'
       and (i.paid_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
       and (p_branch is null or i.branch_id = p_branch)
  ),
  card_ratio as (
    select t.card_id,
           sum(t.amount) filter (where t.txn_type = 'topup') / nullif(sum(t.amount), 0) as r
      from public.card_transactions t
      left join public.invoices i on i.id = t.invoice_id
     where t.txn_type in ('topup','bonus') and (i.id is null or i.status = 'paid')
     group by t.card_id
  ),
  pkg_value as (
    select cp.id, cp.purchased_at, cp.expires_at, cp.is_active, i.status as inv_status,
           coalesce(i.branch_id, cu.home_branch_id) as branch_id,
           coalesce(ii.amount / nullif(ii.quantity, 0), 0) as paid,
           (select coalesce(sum(c.total_qty * c.unit_price), 0) from public.customer_package_items c
             where c.customer_package_id = cp.id and c.total_qty is not null) as total_value
      from public.customer_packages cp
      join public.customers cu on cu.id = cp.customer_id
      left join public.invoice_items ii on ii.id = cp.invoice_item_id
      left join public.invoices i on i.id = ii.invoice_id
  ),
  lines as (
    -- dịch vụ lẻ / sản phẩm trả tiền, giảm giá cả hoá đơn chia theo tỉ lệ
    select inv.day, ii.item_type::text as kind, ii.service_id, ii.description as name,
           ii.amount * (1 - case when inv.noncard > 0 then least(inv.discount, inv.noncard) / inv.noncard else 0 end) as amount,
           ii.amount as face, ii.quantity::numeric as cnt
      from inv join public.invoice_items ii on ii.invoice_id = inv.id
     where ii.item_type in ('service','product') and not ii.paid_with_card and ii.amount <> 0
    union all
    -- dịch vụ trả bằng thẻ: quy ra tiền thật theo tỉ lệ mệnh giá / (mệnh giá + tặng)
    select inv.day, 'card', ii.service_id, ii.description,
           ii.amount * coalesce((select cr.r from public.card_transactions t join card_ratio cr on cr.card_id = t.card_id
                                  where t.invoice_id = inv.id and t.txn_type = 'charge' limit 1), 1),
           ii.amount, ii.quantity
      from inv join public.invoice_items ii on ii.invoice_id = inv.id
     where ii.paid_with_card
    union all
    -- buổi combo đã làm: giá gói × giá lẻ buổi / tổng giá lẻ của gói
    select (a.start_at at time zone 'Asia/Ho_Chi_Minh')::date, 'combo', aps.service_id, null,
           case when pv.total_value > 0 then pv.paid * ci.unit_price / pv.total_value else 0 end,
           ci.unit_price, 1
      from public.appointment_services aps
      join public.appointments a on a.id = aps.appointment_id and a.status = 'completed'
      join public.customer_package_items ci on ci.id = aps.customer_package_item_id
      join pkg_value pv on pv.id = aps.customer_package_id
     where aps.customer_package_id is not null
       and coalesce(aps.is_active, true)
       and (a.start_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
       and (p_branch is null or a.branch_id = p_branch)
  ),
  cash as (
    select inv.day, p.method::text as m, p.amount, false as debt_in
      from inv join public.payments p on p.invoice_id = inv.id
     where p.method <> 'service_card'
    union all
    select (d.created_at at time zone 'Asia/Ho_Chi_Minh')::date, d.method::text, d.amount, true
      from public.debt_payments d join public.invoices i on i.id = d.invoice_id
     where i.status = 'paid'
       and (d.created_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
       and (p_branch is null or i.branch_id = p_branch)
    union all
    select (r.created_at at time zone 'Asia/Ho_Chi_Minh')::date, 'refund', -r.refund_amount, false
      from public.refunds r
     where (r.created_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
       and (p_branch is null or r.branch_id = p_branch)
  ),
  -- nợ khách tại cuối kỳ: thẻ
  cards as (
    select c.id,
           coalesce(sum(t.amount), 0) as bal,
           coalesce(sum(t.amount) filter (where t.txn_type = 'topup' and (i.id is null or i.status = 'paid')), 0) as tp,
           coalesce(sum(t.amount) filter (where t.txn_type = 'bonus' and (i.id is null or i.status = 'paid')), 0) as bn,
           coalesce((array_agg(i.branch_id order by t.created_at desc) filter (where t.txn_type = 'topup' and i.status = 'paid'))[1],
                    max(cu.home_branch_id::text)::uuid) as br
      from public.service_cards c
      join public.customers cu on cu.id = c.customer_id
      join public.card_transactions t on t.card_id = c.id and t.created_at < v_cut
      left join public.invoices i on i.id = t.invoice_id
     group by c.id
  ),
  cards_f as (
    select bal, case when tp + bn > 0 then bal * tp / (tp + bn) else bal end as owed
      from cards where bal > 0 and (p_branch is null or br = p_branch)
  ),
  -- nợ khách tại cuối kỳ: combo (buổi làm sau cuối kỳ được cộng trả lại)
  later as (
    select aps.customer_package_item_id as id, count(*) as n
      from public.appointment_services aps
      join public.appointments a on a.id = aps.appointment_id and a.status = 'completed'
     where aps.customer_package_item_id is not null and a.start_at >= v_cut
     group by 1
  ),
  pk_items as (
    select c.customer_package_id as id,
           sum(greatest(0, c.total_qty - greatest(0, c.used_qty - coalesce(l.n, 0)))) as rem_n,
           sum(greatest(0, c.total_qty - greatest(0, c.used_qty - coalesce(l.n, 0))) * c.unit_price) as rem_v
      from public.customer_package_items c left join later l on l.id = c.id
     where c.total_qty is not null
     group by 1
  ),
  pk as (
    select pk_items.rem_n,
           case when pv.total_value > 0 then pv.paid * pk_items.rem_v / pv.total_value else 0 end as owed
      from pkg_value pv join pk_items on pk_items.id = pv.id
     where pv.purchased_at < v_cut
       and (pv.inv_status is null or pv.inv_status = 'paid')
       and (pv.expires_at is null or pv.expires_at >= v_cut)
       and (pv.is_active or exists (select 1 from public.refunds r where r.customer_package_id = pv.id and r.created_at >= v_cut))
       and (p_branch is null or pv.branch_id = p_branch)
       and pk_items.rem_n > 0
  ),
  named as (
    select l.*, coalesce(sv.name, l.name, 'Khác') as sname,
           case when l.kind = 'product' then 'Sản phẩm bán lẻ' else coalesce(sc.name, 'Chưa phân nhóm') end as cat,
           coalesce(sc.sort_order, 999) as cat_sort
      from lines l
      left join public.services sv on sv.id = l.service_id
      left join public.service_categories sc on sc.id = sv.category_id
  )
  select jsonb_build_object(
    'as_of', v_asof,
    'real', (select jsonb_build_object(
        'cash',     coalesce(sum(amount) filter (where m = 'cash'), 0),
        'transfer', coalesce(sum(amount) filter (where m = 'bank_transfer'), 0),
        'pos',      coalesce(sum(amount) filter (where m = 'pos'), 0),
        'debt_in',  coalesce(sum(amount) filter (where debt_in), 0),
        'refund',   coalesce(-sum(amount) filter (where m = 'refund'), 0),
        'total',    coalesce(sum(amount), 0)) from cash),
    'net', (select jsonb_build_object(
        'service',   coalesce(round(sum(amount) filter (where kind = 'service')), 0),
        'product',   coalesce(round(sum(amount) filter (where kind = 'product')), 0),
        'card',      coalesce(round(sum(amount) filter (where kind = 'card')), 0),
        'card_face', coalesce(sum(face) filter (where kind = 'card'), 0),
        'combo',     coalesce(round(sum(amount) filter (where kind = 'combo')), 0),
        'combo_n',   coalesce(sum(cnt) filter (where kind = 'combo'), 0),
        'combo_face',coalesce(sum(face) filter (where kind = 'combo'), 0),
        'total',     coalesce(round(sum(amount)), 0)) from lines),
    'prepaid', (select jsonb_build_object(
        'package', coalesce(sum(ii.amount) filter (where ii.item_type = 'package'), 0),
        'package_n', coalesce(sum(ii.quantity) filter (where ii.item_type = 'package'), 0),
        'topup',   coalesce(sum(ii.amount) filter (where ii.item_type = 'card_topup'), 0),
        'topup_n', coalesce(sum(ii.quantity) filter (where ii.item_type = 'card_topup'), 0))
        from inv join public.invoice_items ii on ii.invoice_id = inv.id),
    'new_debt', (select coalesce(sum(debt_amount), 0) from inv),
    'liab', jsonb_build_object(
        'card_balance', (select coalesce(sum(bal), 0) from cards_f),
        'card_owed',    (select coalesce(round(sum(owed)), 0) from cards_f),
        'cards_n',      (select count(*) from cards_f),
        'pkg_owed',     (select coalesce(round(sum(owed)), 0) from pk),
        'pkg_sessions', (select coalesce(sum(rem_n), 0) from pk),
        'pkgs_n',       (select count(*) from pk)),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'real', d.real, 'net', d.net) order by d.day)
        from (select day, sum(r) as real, round(sum(n)) as net from (
                select day, amount as r, 0::numeric as n from cash
                union all select day, 0, amount from lines) z group by day) d), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('name', c.cat, 'amount', c.amount, 'cnt', c.cnt) order by c.amount desc, c.cat_sort)
        from (select cat, min(cat_sort) as cat_sort, round(sum(amount)) as amount, sum(cnt) as cnt from named group by cat) c), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(jsonb_build_object('name', s.sname, 'cat', s.cat, 'amount', s.amount, 'cnt', s.cnt) order by s.amount desc)
        from (select sname, cat, round(sum(amount)) as amount, sum(cnt) as cnt from named where kind <> 'product' group by sname, cat
              order by 3 desc limit 15) s), '[]'::jsonb)
  ) into v;
  return v;
end $$;

revoke execute on function public.report_overview(date, date, uuid) from public, anon;
grant execute on function public.report_overview(date, date, uuid) to authenticated;

-- Trang "Gói & thẻ": giá trị combo còn nợ tính theo tỉ lệ giá gói (khớp báo cáo tổng quan).
-- Số tiền hoàn khi huỷ gói vẫn theo công thức cũ (giá gói − buổi đã làm × giá lẻ) trong refund_quote.
create or replace function public.package_liabilities()
 returns table(customer_package_id uuid, customer_id uuid, customer_name text, phone text, branch_id uuid, package_name text,
               purchased_at timestamp with time zone, expires_at timestamp with time zone, expired boolean, paid numeric,
               used_sessions bigint, used_value numeric, remaining_sessions bigint, has_unlimited boolean, owed_value numeric, items jsonb)
 language plpgsql stable security definer set search_path to ''
as $function$
begin
  if not public.has_role('owner','manager') then raise exception 'Chỉ chủ spa / quản lý xem được báo cáo'; end if;
  return query
  with it as (
    select ci.customer_package_id as id,
           sum(greatest(0, ci.total_qty - ci.used_qty)) filter (where ci.total_qty is not null) as remaining,
           sum(least(ci.used_qty, ci.total_qty)) filter (where ci.total_qty is not null) as used_n,
           sum(least(ci.used_qty, ci.total_qty) * ci.unit_price) filter (where ci.total_qty is not null) as used_v,
           sum(greatest(0, ci.total_qty - ci.used_qty) * ci.unit_price) filter (where ci.total_qty is not null) as rem_v,
           sum(ci.total_qty * ci.unit_price) filter (where ci.total_qty is not null) as total_v,
           bool_or(ci.total_qty is null) as unlimited,
           jsonb_agg(jsonb_build_object('label', ci.label, 'total', ci.total_qty, 'used', ci.used_qty) order by ci.sort_order) as items
      from public.customer_package_items ci group by 1
  )
  select cp.id, cp.customer_id, cu.full_name, cu.phone, coalesce(i.branch_id, cu.home_branch_id),
         pk.name, cp.purchased_at, cp.expires_at, coalesce(cp.expires_at < now(), false),
         coalesce(ii.amount / ii.quantity, 0), coalesce(it.used_n, 0)::bigint,
         case when coalesce(it.total_v, 0) > 0 then round(coalesce(ii.amount / ii.quantity, 0) * it.used_v / it.total_v) else 0 end,
         coalesce(it.remaining, 0)::bigint, coalesce(it.unlimited, false),
         case when coalesce(it.total_v, 0) > 0 then round(coalesce(ii.amount / ii.quantity, 0) * it.rem_v / it.total_v)
              else coalesce(ii.amount / ii.quantity, 0) end,
         coalesce(it.items, '[]'::jsonb)
    from public.customer_packages cp
    join public.customers cu on cu.id = cp.customer_id
    join public.packages pk on pk.id = cp.package_id
    left join public.invoice_items ii on ii.id = cp.invoice_item_id
    left join public.invoices i on i.id = ii.invoice_id
    left join it on it.id = cp.id
   where cp.is_active
     and (i.id is null or i.status = 'paid')
     and (coalesce(it.remaining, 0) > 0 or coalesce(it.unlimited, false))
   order by cp.purchased_at desc;
end $function$;
