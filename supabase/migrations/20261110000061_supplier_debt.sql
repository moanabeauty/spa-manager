-- Công nợ nhà cung cấp (chỉ chủ spa):
--  mỗi phiếu nhập: Tổng đơn (tiền hàng + chi phí) · Cần trả NCC · Đã trả NCC · Còn nợ; mỗi NCC: tổng dư nợ.
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  note text,
  created_at timestamptz not null default now()
);
create unique index suppliers_name_key on public.suppliers (lower(name));
alter table public.suppliers enable row level security;
create policy "staff read" on public.suppliers for select to authenticated using ((select public.is_staff()));
create policy "owner write" on public.suppliers for all to authenticated
  using ((select public.has_role('owner'))) with check ((select public.has_role('owner')));

alter table public.stock_receipts
  add column supplier_id uuid references public.suppliers(id),
  add column payable numeric(14,0);
create index on public.stock_receipts (supplier_id);
grant select (supplier_id) on public.stock_receipts to authenticated;

-- tên NCC gõ tay → tự gắn / tạo NCC
create or replace function public.stock_receipts_link_supplier()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_name text := nullif(trim(new.supplier), '');
begin
  if v_name is null then new.supplier_id := null; return new; end if;
  new.supplier := v_name;
  select id into new.supplier_id from public.suppliers where lower(name) = lower(v_name);
  if new.supplier_id is null then
    insert into public.suppliers (name) values (v_name) returning id into new.supplier_id;
  end if;
  return new;
end $$;
create trigger stock_receipts_link_supplier before insert or update of supplier on public.stock_receipts
  for each row execute function public.stock_receipts_link_supplier();
update public.stock_receipts set supplier = supplier where supplier is not null;
-- phiếu cũ đã duyệt: cần trả = tiền hàng (nếu có)
update public.stock_receipts set payable = goods_total where status = 'approved' and payable is null and goods_total is not null;

create table public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.stock_receipts(id) on delete cascade,
  amount numeric(14,0) not null check (amount > 0),
  method text not null default 'bank_transfer' check (method in ('cash','bank_transfer','other')),
  paid_on date not null default ((now() at time zone 'Asia/Ho_Chi_Minh')::date),
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.supplier_payments (receipt_id);
alter table public.supplier_payments enable row level security;
create policy "owner read" on public.supplier_payments for select to authenticated using ((select public.has_role('owner')));

-- sổ công nợ: mỗi phiếu đã duyệt có NCC hoặc có khoản cần trả
create or replace function public.supplier_ledger()
returns table (receipt_id uuid, code text, created_at timestamptz, approved_at timestamptz, warehouse text,
               supplier_id uuid, supplier text, goods_total numeric, extra_cost_total numeric,
               payable numeric, paid numeric, payments jsonb)
language sql stable security definer set search_path = '' as $$
  select r.id, r.code, r.created_at, r.approved_at, w.name, r.supplier_id, s.name,
         coalesce(r.goods_total, 0), r.extra_cost_total, coalesce(r.payable, 0),
         coalesce((select sum(p.amount) from public.supplier_payments p where p.receipt_id = r.id), 0),
         coalesce((select jsonb_agg(jsonb_build_object('amount', p.amount, 'method', p.method, 'paid_on', p.paid_on, 'note', p.note) order by p.paid_on, p.created_at)
                     from public.supplier_payments p where p.receipt_id = r.id), '[]'::jsonb)
    from public.stock_receipts r
    join public.warehouses w on w.id = r.warehouse_id
    left join public.suppliers s on s.id = r.supplier_id
   where public.has_role('owner') and r.status = 'approved' and (r.supplier_id is not null or coalesce(r.payable, 0) > 0)
   order by r.approved_at desc nulls last, r.created_at desc
$$;
revoke execute on function public.supplier_ledger() from public, anon;
grant execute on function public.supplier_ledger() to authenticated;

-- trả tiền NCC cho 1 phiếu
create or replace function public.pay_supplier(p_receipt_id uuid, p_amount numeric, p_method text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_payable numeric; v_paid numeric; v_status text;
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa ghi trả tiền nhà cung cấp'; end if;
  select status, coalesce(payable, 0) into v_status, v_payable from public.stock_receipts where id = p_receipt_id for update;
  if v_status is null then raise exception 'Không tìm thấy phiếu nhập'; end if;
  if v_status <> 'approved' then raise exception 'Phiếu nhập chưa duyệt'; end if;
  p_amount := round(coalesce(p_amount, 0));
  if p_amount <= 0 then raise exception 'Số tiền trả không hợp lệ'; end if;
  select coalesce(sum(amount), 0) into v_paid from public.supplier_payments where receipt_id = p_receipt_id;
  if v_paid + p_amount > v_payable then raise exception 'Số tiền trả vượt quá số còn nợ của phiếu này'; end if;
  insert into public.supplier_payments (receipt_id, amount, method, note)
  values (p_receipt_id, p_amount, coalesce(nullif(p_method, ''), 'bank_transfer'), nullif(trim(p_note), ''));
end $$;
revoke execute on function public.pay_supplier(uuid, numeric, text, text) from public, anon;
grant execute on function public.pay_supplier(uuid, numeric, text, text) to authenticated;

-- duyệt phiếu: thêm NCC, số cần trả NCC, số trả ngay
drop function if exists public.approve_stock_receipt(uuid, jsonb, jsonb);
create or replace function public.approve_stock_receipt(p_receipt_id uuid, p_prices jsonb, p_extra_costs jsonb,
  p_supplier text default null, p_payable numeric default null, p_paid numeric default 0, p_method text default 'bank_transfer')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_it jsonb;
  v_extra jsonb := '[]'::jsonb;
  v_extra_total numeric := 0;
  v_amt numeric;
  v_goods numeric := 0;
  v_units int := 0;
  v_m record;
  v_price numeric;
  v_cost numeric;
  v_n int := 0;
  v_payable numeric;
  v_paid numeric := round(coalesce(p_paid, 0));
begin
  if not public.has_role('owner') then raise exception 'Chỉ chủ spa duyệt phiếu nhập'; end if;
  select status into v_status from public.stock_receipts where id = p_receipt_id for update;
  if v_status is null then raise exception 'Không tìm thấy phiếu nhập'; end if;
  if v_status <> 'pending' then raise exception 'Phiếu nhập này đã được duyệt'; end if;

  if p_extra_costs is not null and jsonb_typeof(p_extra_costs) = 'array' then
    for v_it in select value from jsonb_array_elements(p_extra_costs) loop
      v_amt := round(coalesce(nullif(v_it->>'amount', '')::numeric, 0));
      if v_amt < 0 then raise exception 'Chi phí không hợp lệ'; end if;
      if v_amt > 0 then
        v_extra := v_extra || jsonb_build_object('label', coalesce(nullif(trim(v_it->>'label'), ''), 'Chi phí khác'), 'amount', v_amt);
        v_extra_total := v_extra_total + v_amt;
      end if;
    end loop;
  end if;

  create temp table _px (movement_id uuid primary key, price numeric) on commit drop;
  for v_it in select value from jsonb_array_elements(coalesce(p_prices, '[]'::jsonb)) loop
    v_price := round(nullif(v_it->>'unit_cost', '')::numeric);
    if v_price is null or v_price < 0 then raise exception 'Vui lòng nhập đủ giá nhập cho từng sản phẩm'; end if;
    insert into _px values ((v_it->>'movement_id')::uuid, v_price) on conflict (movement_id) do update set price = excluded.price;
  end loop;

  for v_m in select m.id, m.quantity, p.price from public.stock_movements m left join _px p on p.movement_id = m.id
              where m.receipt_id = p_receipt_id loop
    if v_m.price is null then raise exception 'Vui lòng nhập đủ giá nhập cho từng sản phẩm'; end if;
    v_goods := v_goods + v_m.quantity * v_m.price;
    v_units := v_units + v_m.quantity;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Phiếu nhập không có sản phẩm'; end if;

  v_payable := round(coalesce(p_payable, v_goods));
  if v_payable < 0 then raise exception 'Số tiền cần trả nhà cung cấp không hợp lệ'; end if;
  if v_paid < 0 or v_paid > v_payable then raise exception 'Số tiền đã trả phải từ 0 đến số cần trả nhà cung cấp'; end if;
  if v_paid < v_payable and nullif(trim(coalesce(p_supplier, '')), '') is null then
    raise exception 'Vui lòng ghi tên nhà cung cấp để theo dõi công nợ';
  end if;

  for v_m in select m.id, m.product_id, m.quantity, p.price from public.stock_movements m join _px p on p.movement_id = m.id
              where m.receipt_id = p_receipt_id order by m.created_at loop
    v_cost := v_m.price + case when v_extra_total = 0 then 0
                               when v_goods > 0 then v_extra_total * v_m.price / v_goods
                               else v_extra_total / v_units end;
    v_cost := round(v_cost);
    update public.stock_movements set unit_cost = v_cost where id = v_m.id;
    if v_cost > 0 then update public.products set cost_price = v_cost where id = v_m.product_id; end if;
  end loop;

  update public.stock_receipts
     set status = 'approved', goods_total = v_goods, extra_costs = v_extra, extra_cost_total = v_extra_total,
         payable = v_payable, supplier = nullif(trim(coalesce(p_supplier, '')), ''),
         approved_by = auth.uid(), approved_at = now()
   where id = p_receipt_id;

  if v_paid > 0 then
    insert into public.supplier_payments (receipt_id, amount, method, note)
    values (p_receipt_id, v_paid, coalesce(nullif(p_method, ''), 'bank_transfer'), 'Trả khi duyệt phiếu');
  end if;
end $$;
revoke execute on function public.approve_stock_receipt(uuid, jsonb, jsonb, text, numeric, numeric, text) from public, anon;
grant execute on function public.approve_stock_receipt(uuid, jsonb, jsonb, text, numeric, numeric, text) to authenticated;

-- ============ Hạn sử dụng theo từng lần nhập ============
alter table public.stock_movements add column expiry_date date;
grant select (expiry_date) on public.stock_movements to authenticated;

-- p_items: [{"product_id": "...", "quantity": 3, "expiry_date": "2027-12-31"}]
create or replace function public.receive_stock(p_warehouse_id uuid, p_supplier text, p_note text, p_items jsonb, p_extra_costs jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_code text;
  v_type public.warehouse_type;
  v_it jsonb;
  v_qty int;
  v_prod uuid;
  v_exp date;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_extra jsonb := '[]'::jsonb;
  v_extra_total numeric := 0;
  v_amt numeric;
begin
  if not public.can_manage_warehouse(p_warehouse_id) then raise exception 'Bạn không có quyền nhập hàng vào kho này'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Phiếu nhập chưa có sản phẩm';
  end if;
  select type into v_type from public.warehouses where id = p_warehouse_id;

  if p_extra_costs is not null and jsonb_typeof(p_extra_costs) = 'array' then
    for v_it in select value from jsonb_array_elements(p_extra_costs) loop
      v_amt := round(coalesce(nullif(v_it->>'amount', '')::numeric, 0));
      if v_amt < 0 then raise exception 'Chi phí không hợp lệ'; end if;
      if v_amt > 0 then
        v_extra := v_extra || jsonb_build_object('label', coalesce(nullif(trim(v_it->>'label'), ''), 'Chi phí khác'), 'amount', v_amt);
        v_extra_total := v_extra_total + v_amt;
      end if;
    end loop;
  end if;

  insert into public.stock_receipts (warehouse_id, supplier, note, extra_costs, extra_cost_total, status)
  values (p_warehouse_id, nullif(trim(p_supplier), ''), nullif(trim(p_note), ''), v_extra, v_extra_total, 'pending')
  returning id, code into v_id, v_code;

  for v_it in select value from jsonb_array_elements(p_items) loop
    v_prod := (v_it->>'product_id')::uuid;
    v_qty := (v_it->>'quantity')::int;
    v_exp := nullif(v_it->>'expiry_date', '')::date;
    if v_qty is null or v_qty < 1 or v_qty > 100000 then raise exception 'Số lượng nhập không hợp lệ'; end if;
    if v_exp is not null and v_exp <= v_today then raise exception 'Hạn sử dụng phải sau hôm nay'; end if;
    if not exists (select 1 from public.products where id = v_prod) then raise exception 'Sản phẩm không tồn tại'; end if;
    insert into public.stock_movements (warehouse_id, product_id, movement_type, quantity, receipt_id, expiry_date, note)
    values (p_warehouse_id, v_prod, 'import', v_qty, v_id, v_exp, 'Nhập hàng ' || v_code);
    -- hạn của sản phẩm = lô gần hết hạn nhất (bỏ qua lô đã quá hạn)
    update public.products
       set for_treatment = for_treatment or v_type = 'treatment',
           for_retail = for_retail or v_type = 'retail',
           is_active = true,
           expiry_date = case when v_exp is null then expiry_date
                              when expiry_date is null or expiry_date < v_today or v_exp < expiry_date then v_exp
                              else expiry_date end
     where id = v_prod;
  end loop;
  return v_id;
end $$;
