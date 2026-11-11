-- NV kho xem lại chi tiết phiếu nhập mình đã tạo (11/11/2026):
-- chi phí (ship, chi phí khác) chỉ trả về cho người tạo phiếu, quản lý, chủ spa. Không có giá nhập.
create or replace function public.my_receipt_extra_costs(p_receipt_ids uuid[])
returns table(receipt_id uuid, extra_costs jsonb)
language sql stable security definer set search_path = '' as $$
  select r.id, coalesce(r.extra_costs, '[]'::jsonb)
    from public.stock_receipts r
   where r.id = any(p_receipt_ids)
     and (r.created_by = (select auth.uid()) or public.has_role('owner', 'manager'))
$$;
revoke execute on function public.my_receipt_extra_costs(uuid[]) from public, anon;
grant execute on function public.my_receipt_extra_costs(uuid[]) to authenticated;
