-- Menu thật của Moana + luật hoa hồng mới
-- * Dịch vụ lẻ được tính doanh số (trừ gội đầu: commission_eligible = false)
-- * Dòng hoá đơn trả bằng thẻ tài khoản (paid_with_card) không tính doanh số (đã tính lúc nạp thẻ)
-- * Buổi làm từ gói combo không có hoá đơn nên tự nhiên không tính doanh số

alter table public.services
  add column name_en text,
  add column member_price numeric(12,0) check (member_price >= 0),
  add column cost numeric(12,0) check (cost >= 0),            -- giá vốn sản phẩm cho 1 lần làm
  add column branch_id uuid references public.branches(id),  -- null = có ở mọi chi nhánh
  add column commission_eligible boolean not null default true,
  alter column price drop not null;                            -- null = báo giá theo thực tế (BAP, filler, botox...)

create index on public.services (branch_id);

update public.commission_item_types set counts = true where item_type = 'service';

-- dòng nào khách trả bằng thẻ tài khoản
alter table public.invoice_items add column paid_with_card boolean not null default false;

create or replace function public.invoice_items_card_rule()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if new.paid_with_card then
    if new.item_type = 'card_topup' then
      raise exception 'Không dùng thẻ tài khoản để nạp thẻ';
    end if;
    if new.item_type = 'service' then
      select name into v_name from public.services where id = new.service_id and not card_allowed;
      if v_name is not null then
        raise exception 'Thẻ tài khoản không dùng cho dịch vụ: %', v_name;
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger invoice_items_card_rule before insert or update on public.invoice_items
for each row execute function public.invoice_items_card_rule();

-- thanh toán thẻ: chỉ kiểm tra chủ thẻ + số dư (dịch vụ cấm đã chặn ở dòng hoá đơn)
create or replace function public.payments_card_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_inv record;
  v_card record;
  v_balance numeric;
begin
  if new.method <> 'service_card' then return new; end if;
  select * into v_inv from public.invoices where id = new.invoice_id;
  select * into v_card from public.service_cards where id = new.service_card_id;
  if not v_card.is_active then raise exception 'Thẻ tài khoản đang bị khoá'; end if;
  if v_inv.customer_id is distinct from v_card.customer_id then
    raise exception 'Thẻ không thuộc khách hàng của hoá đơn';
  end if;
  select coalesce(sum(amount), 0) into v_balance from public.card_transactions where card_id = new.service_card_id;
  if v_balance < new.amount then
    raise exception 'Số dư thẻ không đủ (còn %)', v_balance;
  end if;
  return new;
end $$;

-- chốt hoá đơn: tiền trả bằng thẻ phải đúng bằng tổng các dòng đánh dấu trả bằng thẻ
create or replace function public.invoices_card_split_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_card_paid numeric; v_card_items numeric;
begin
  if new.status = 'paid' and old.status = 'draft' then
    select coalesce(sum(amount), 0) into v_card_paid from public.payments
     where invoice_id = new.id and method = 'service_card';
    select coalesce(sum(amount), 0) into v_card_items from public.invoice_items
     where invoice_id = new.id and paid_with_card;
    if v_card_paid <> v_card_items then
      raise exception 'Tiền trả bằng thẻ (%) phải bằng tổng các dòng đánh dấu trả bằng thẻ (%)', v_card_paid, v_card_items;
    end if;
  end if;
  return new;
end $$;

create trigger invoices_bu_card_split before update on public.invoices
for each row execute function public.invoices_card_split_check();

revoke execute on function public.invoice_items_card_rule(), public.invoices_card_split_check()
  from public, anon, authenticated;

create or replace view public.staff_monthly_sales with (security_invoker = true) as
select date_trunc('month', i.paid_at at time zone 'Asia/Ho_Chi_Minh')::date as month,
       s.staff_id, sum(s.amount) as sales_amount
  from public.invoice_item_sellers s
  join public.invoice_items ii on ii.id = s.invoice_item_id
  join public.invoices i on i.id = ii.invoice_id
  join public.commission_item_types t on t.item_type = ii.item_type and t.counts
  left join public.services sv on sv.id = ii.service_id
 where i.status = 'paid'
   and not ii.paid_with_card
   and coalesce(sv.commission_eligible, true)
 group by 1, 2;
