-- Đơn online (26/11/2026 tối): trạng thái Đã lên đơn → Đã ship khách → Đã hoàn thành (+ Hoàn hàng).
-- "Đã hoàn thành" KHÔNG bấm tay: đơn đã ship mà khách đã trả đủ (kể cả đã thu được COD) thì tự hoàn thành.
-- (trong cơ sở dữ liệu: preparing / shipping / delivered = hoàn thành / returned)

create or replace function public._online_autocomplete(p_invoice uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.invoice_shipments s
     set status = 'delivered', delivered_at = coalesce(s.delivered_at, now()), updated_at = now()
    from public.invoices i
   where s.invoice_id = p_invoice and i.id = p_invoice and i.status = 'paid'
     and s.status = 'shipping'
     and i.debt_amount - coalesce((select sum(d.amount) from public.debt_payments d where d.invoice_id = i.id), 0) <= 0;
end $$;
revoke execute on function public._online_autocomplete(uuid) from public, anon, authenticated;

-- thu nợ / thu được COD → kiểm tra hoàn thành
create or replace function public.debt_payments_autocomplete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public._online_autocomplete(new.invoice_id);
  return null;
end $$;
drop trigger if exists debt_payments_ai_autocomplete on public.debt_payments;
create trigger debt_payments_ai_autocomplete after insert on public.debt_payments
  for each row execute function public.debt_payments_autocomplete();

-- update_shipment: không cho bấm tay "Đã hoàn thành" (chuyển thành "Đã ship khách" rồi tự kiểm tra tiền)
create or replace function pg_temp.patch_fn(p_sig text, p_old text, p_new text)
returns void language plpgsql as $$
declare d text := pg_get_functiondef(p_sig::regprocedure);
begin
  if position(p_old in d) = 0 then raise exception 'Không tìm thấy đoạn cần sửa trong %', p_sig; end if;
  execute replace(d, p_old, p_new);
end $$;

select pg_temp.patch_fn('public.update_shipment(uuid, jsonb)',
  $o$  if v_inv.status = 'draft' then v_status := 'preparing'; end if;$o$,
  $n$  if v_inv.status = 'draft' then v_status := 'preparing'; end if;
  if v_status = 'delivered' then v_status := 'shipping'; end if; -- hoàn thành do app tự xét theo tiền$n$);

select pg_temp.patch_fn('public.update_shipment(uuid, jsonb)',
  $o$    update public.invoice_shipments set stock_back_at = now() where invoice_id = p_invoice;
  end if;
$o$,
  $n$    update public.invoice_shipments set stock_back_at = now() where invoice_id = p_invoice;
  end if;

  perform public._online_autocomplete(p_invoice);
$n$);

-- Phí ship: khách trả (shipper thu thêm của khách, tiền ship thuộc đơn vị ship) hoặc shop trả
alter table public.invoice_shipments
  add column if not exists ship_fee_payer text not null default 'customer' check (ship_fee_payer in ('customer','shop'));

select pg_temp.patch_fn('public.update_shipment(uuid, jsonb)',
  $o$shipping_fee, cod_amount, status, note, shipped_at, delivered_at)$o$,
  $n$shipping_fee, cod_amount, status, note, shipped_at, delivered_at, ship_fee_payer)$n$);
select pg_temp.patch_fn('public.update_shipment(uuid, jsonb)',
  $o$          case when v_status = 'delivered' then now() end)
  on conflict$o$,
  $n$          case when v_status = 'delivered' then now() end,
          case when p->>'ship_fee_payer' = 'shop' then 'shop' else 'customer' end)
  on conflict$n$);
select pg_temp.patch_fn('public.update_shipment(uuid, jsonb)',
  $o$    note = excluded.note, status = excluded.status,$o$,
  $n$    note = excluded.note, status = excluded.status, ship_fee_payer = excluded.ship_fee_payer,$n$);

-- hotline 2 cơ sở (chủ spa cung cấp 26/11/2026)
update public.branches set phone = '0835288888' where address like '67 Lưu Quang Vũ%';
update public.branches set phone = '0829989999' where address like '109 Nguyễn Sơn%';
