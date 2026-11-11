-- HSD sản phẩm cập nhật ngay khi NV kho nhập hạn sử dụng trên phiếu nhập (11/11/2026),
-- không chờ Chủ duyệt. HSD trên thông tin sản phẩm = HSD gần nhất (chưa qua) trong các lô nhập.
--   - Tính trên mọi phiếu chờ duyệt + đã duyệt (phiếu "Không duyệt" bị loại ra).
--   - Nếu mọi lô đều đã qua hạn: lấy HSD muộn nhất (để vẫn thấy cảnh báo "đã hết hạn").
--   - Sản phẩm chưa có lô nào ghi HSD: giữ nguyên HSD đang ghi tay.

create or replace function public.refresh_product_expiry(p_product_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_next date;
  v_last date;
begin
  select min(i.expiry_date) filter (where i.expiry_date >= v_today), max(i.expiry_date)
    into v_next, v_last
    from public.stock_receipt_items i
    join public.stock_receipts r on r.id = i.receipt_id
   where i.product_id = p_product_id
     and i.expiry_date is not null
     and r.status <> 'rejected';
  if v_last is null then return; end if;
  update public.products set expiry_date = coalesce(v_next, v_last)
   where id = p_product_id and expiry_date is distinct from coalesce(v_next, v_last);
end $$;
revoke execute on function public.refresh_product_expiry(uuid) from public, anon, authenticated;

create or replace function public.trg_receipt_item_expiry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform public.refresh_product_expiry(old.product_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.product_id <> old.product_id) then
    perform public.refresh_product_expiry(new.product_id);
  end if;
  return null;
end $$;

drop trigger if exists receipt_item_expiry on public.stock_receipt_items;
create trigger receipt_item_expiry
  after insert or delete or update of expiry_date, product_id on public.stock_receipt_items
  for each row execute function public.trg_receipt_item_expiry();

create or replace function public.trg_receipt_status_expiry()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_p uuid;
begin
  for v_p in select distinct product_id from public.stock_receipt_items where receipt_id = new.id loop
    perform public.refresh_product_expiry(v_p);
  end loop;
  return null;
end $$;

drop trigger if exists receipt_status_expiry on public.stock_receipts;
create trigger receipt_status_expiry
  after update of status on public.stock_receipts
  for each row when (old.status is distinct from new.status)
  execute function public.trg_receipt_status_expiry();

-- Đồng bộ lại cho sản phẩm đã có lô nhập
select public.refresh_product_expiry(p.id)
  from (select distinct product_id as id from public.stock_receipt_items where expiry_date is not null) p;
