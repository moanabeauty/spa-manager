-- Moana Spa Manager: Row Level Security
-- Nhóm quyền:
--   quản trị  = owner, manager
--   quầy      = owner, manager, receptionist, technician (lịch hẹn, hoá đơn)
--   kho       = owner, manager, warehouse
--   khách     = customer (chỉ thấy dữ liệu của chính mình)

do $$
declare t text;
begin
  foreach t in array array[
    'branches','profiles','customers','service_categories','services','packages','package_services',
    'promotions','promotion_registrations','card_topup_tiers','service_cards','appointments',
    'customer_packages','customer_package_services','appointment_services','invoices','products',
    'invoice_items','invoice_item_sellers','payments','card_transactions','commission_tiers',
    'commission_item_types','warehouses','stock_requests','stock_request_items','stock_movements']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ============ DANH MỤC CÔNG KHAI (khách xem để đặt lịch) ============
do $$
declare t text;
begin
  foreach t in array array['branches','service_categories','services','packages','package_services','promotions','card_topup_tiers']
  loop
    execute format('create policy "public read" on public.%I for select to anon, authenticated using (true)', t);
    execute format($p$create policy "management write" on public.%I for all to authenticated
      using ((select public.has_role('owner','manager'))) with check ((select public.has_role('owner','manager')))$p$, t);
  end loop;
end $$;

-- ============ NGƯỜI DÙNG ============
create policy "own or staff read" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_staff()));
create policy "update own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- chỉ cho tự sửa tên + SĐT; đổi vai trò dùng public.set_user_role()
revoke update on public.profiles from authenticated, anon;
grant update (full_name, phone) on public.profiles to authenticated;
revoke execute on function public.set_user_role(uuid, public.user_role, uuid) from anon, public;
grant execute on function public.set_user_role(uuid, public.user_role, uuid) to authenticated;

create policy "own or staff read" on public.customers for select to authenticated
  using (profile_id = (select auth.uid()) or (select public.is_staff()));
create policy "front desk insert" on public.customers for insert to authenticated
  with check ((select public.has_role('owner','manager','receptionist','technician')));
create policy "front desk or self update" on public.customers for update to authenticated
  using (profile_id = (select auth.uid()) or (select public.has_role('owner','manager','receptionist','technician')))
  with check (profile_id = (select auth.uid()) or (select public.has_role('owner','manager','receptionist','technician')));
create policy "management delete" on public.customers for delete to authenticated
  using ((select public.has_role('owner','manager')));

-- ============ LỊCH HẸN ============
create policy "own or staff read" on public.appointments for select to authenticated
  using (customer_id = (select public.my_customer_id()) or (select public.is_staff()));
create policy "front desk insert" on public.appointments for insert to authenticated
  with check ((select public.has_role('owner','manager','receptionist','technician')));
create policy "customer book online" on public.appointments for insert to authenticated
  with check (customer_id = (select public.my_customer_id()) and status = 'pending' and source = 'online');
create policy "front desk update" on public.appointments for update to authenticated
  using ((select public.has_role('owner','manager','receptionist','technician')))
  with check ((select public.has_role('owner','manager','receptionist','technician')));
create policy "customer cancel own pending" on public.appointments for update to authenticated
  using (customer_id = (select public.my_customer_id()) and status = 'pending')
  with check (customer_id = (select public.my_customer_id()) and status in ('pending','cancelled'));
create policy "management delete" on public.appointments for delete to authenticated
  using ((select public.has_role('owner','manager')));

create policy "own or staff read" on public.appointment_services for select to authenticated
  using ((select public.is_staff()) or exists (
    select 1 from public.appointments a where a.id = appointment_id and a.customer_id = (select public.my_customer_id())));
create policy "front desk write" on public.appointment_services for all to authenticated
  using ((select public.has_role('owner','manager','receptionist','technician')))
  with check ((select public.has_role('owner','manager','receptionist','technician')));
create policy "customer add to own pending" on public.appointment_services for insert to authenticated
  with check (technician_id is null and customer_package_id is null and exists (
    select 1 from public.appointments a where a.id = appointment_id
       and a.customer_id = (select public.my_customer_id()) and a.status = 'pending'));

-- ============ GÓI / THẺ / KHUYẾN MẠI CỦA KHÁCH ============
create policy "own or staff read" on public.customer_packages for select to authenticated
  using (customer_id = (select public.my_customer_id()) or (select public.is_staff()));
create policy "management write" on public.customer_packages for all to authenticated
  using ((select public.has_role('owner','manager'))) with check ((select public.has_role('owner','manager')));

create policy "own or staff read" on public.customer_package_services for select to authenticated
  using ((select public.is_staff()) or exists (
    select 1 from public.customer_packages cp where cp.id = customer_package_id and cp.customer_id = (select public.my_customer_id())));
create policy "management write" on public.customer_package_services for all to authenticated
  using ((select public.has_role('owner','manager'))) with check ((select public.has_role('owner','manager')));

create policy "own or staff read" on public.service_cards for select to authenticated
  using (customer_id = (select public.my_customer_id()) or (select public.is_staff()));
create policy "front desk insert" on public.service_cards for insert to authenticated
  with check ((select public.has_role('owner','manager','receptionist')));
create policy "management update" on public.service_cards for update to authenticated
  using ((select public.has_role('owner','manager'))) with check ((select public.has_role('owner','manager')));

create policy "own or staff read" on public.card_transactions for select to authenticated
  using ((select public.is_staff()) or exists (
    select 1 from public.service_cards c where c.id = card_id and c.customer_id = (select public.my_customer_id())));
-- giao dịch thẻ do hệ thống tự tạo; quản trị chỉ được điều chỉnh / hoàn tiền thủ công
create policy "management adjust" on public.card_transactions for insert to authenticated
  with check ((select public.has_role('owner','manager')) and txn_type in ('adjustment','refund'));

create policy "own or staff read" on public.promotion_registrations for select to authenticated
  using (customer_id = (select public.my_customer_id()) or (select public.is_staff()));
create policy "customer register" on public.promotion_registrations for insert to authenticated
  with check (customer_id = (select public.my_customer_id()) and status = 'pending' and invoice_id is null);
create policy "front desk write" on public.promotion_registrations for all to authenticated
  using ((select public.has_role('owner','manager','receptionist','technician')))
  with check ((select public.has_role('owner','manager','receptionist','technician')));

-- ============ HOÁ ĐƠN ============
create policy "own or staff read" on public.invoices for select to authenticated
  using (customer_id = (select public.my_customer_id()) or (select public.is_staff()));
create policy "front desk insert" on public.invoices for insert to authenticated
  with check ((select public.has_role('owner','manager','receptionist','technician')));
create policy "front desk update" on public.invoices for update to authenticated
  using ((select public.has_role('owner','manager','receptionist','technician')))
  with check ((select public.has_role('owner','manager','receptionist','technician')));
create policy "management delete draft" on public.invoices for delete to authenticated
  using ((select public.has_role('owner','manager')) and status = 'draft');

create policy "own or staff read" on public.invoice_items for select to authenticated
  using ((select public.is_staff()) or exists (
    select 1 from public.invoices i where i.id = invoice_id and i.customer_id = (select public.my_customer_id())));
create policy "front desk write" on public.invoice_items for all to authenticated
  using ((select public.has_role('owner','manager','receptionist','technician')))
  with check ((select public.has_role('owner','manager','receptionist','technician')));

-- KTV chỉ xem phần doanh số của mình; quầy/quản lý xem tất cả
create policy "own or desk read" on public.invoice_item_sellers for select to authenticated
  using (staff_id = (select auth.uid()) or (select public.has_role('owner','manager','receptionist')));
create policy "front desk insert" on public.invoice_item_sellers for insert to authenticated
  with check ((select public.has_role('owner','manager','receptionist','technician')));
create policy "front desk update" on public.invoice_item_sellers for update to authenticated
  using ((select public.has_role('owner','manager','receptionist','technician')))
  with check ((select public.has_role('owner','manager','receptionist','technician')));
create policy "front desk delete" on public.invoice_item_sellers for delete to authenticated
  using ((select public.has_role('owner','manager','receptionist','technician')));

create policy "own or staff read" on public.payments for select to authenticated
  using ((select public.is_staff()) or exists (
    select 1 from public.invoices i where i.id = invoice_id and i.customer_id = (select public.my_customer_id())));
create policy "front desk write" on public.payments for all to authenticated
  using ((select public.has_role('owner','manager','receptionist','technician')))
  with check ((select public.has_role('owner','manager','receptionist','technician')));

-- ============ HOA HỒNG (cấu hình) ============
create policy "staff read" on public.commission_tiers for select to authenticated using ((select public.is_staff()));
create policy "owner write" on public.commission_tiers for all to authenticated
  using ((select public.has_role('owner'))) with check ((select public.has_role('owner')));
create policy "staff read" on public.commission_item_types for select to authenticated using ((select public.is_staff()));
create policy "owner write" on public.commission_item_types for all to authenticated
  using ((select public.has_role('owner'))) with check ((select public.has_role('owner')));

-- ============ KHO ============
create policy "staff read" on public.products for select to authenticated using ((select public.is_staff()));
create policy "stock write" on public.products for all to authenticated
  using ((select public.has_role('owner','manager','warehouse'))) with check ((select public.has_role('owner','manager','warehouse')));

create policy "staff read" on public.warehouses for select to authenticated using ((select public.is_staff()));
create policy "owner write" on public.warehouses for all to authenticated
  using ((select public.has_role('owner'))) with check ((select public.has_role('owner')));

create policy "staff read" on public.stock_movements for select to authenticated using ((select public.is_staff()));
create policy "stock insert" on public.stock_movements for insert to authenticated
  with check ((select public.has_role('owner','manager','warehouse')));

create policy "own or stock read" on public.stock_requests for select to authenticated
  using (requested_by = (select auth.uid()) or (select public.has_role('owner','manager','warehouse')));
create policy "staff request" on public.stock_requests for insert to authenticated
  with check ((select public.is_staff()) and requested_by = (select auth.uid()) and status = 'pending');
create policy "stock review" on public.stock_requests for update to authenticated
  using ((select public.has_role('owner','manager','warehouse')))
  with check ((select public.has_role('owner','manager','warehouse')));
create policy "requester cancel pending" on public.stock_requests for update to authenticated
  using (requested_by = (select auth.uid()) and status = 'pending')
  with check (requested_by = (select auth.uid()) and status in ('pending','cancelled'));

create policy "own or stock read" on public.stock_request_items for select to authenticated
  using (exists (select 1 from public.stock_requests r where r.id = request_id
    and (r.requested_by = (select auth.uid()) or (select public.has_role('owner','manager','warehouse')))));
create policy "requester edit pending" on public.stock_request_items for all to authenticated
  using (exists (select 1 from public.stock_requests r where r.id = request_id
    and r.requested_by = (select auth.uid()) and r.status = 'pending'))
  with check (exists (select 1 from public.stock_requests r where r.id = request_id
    and r.requested_by = (select auth.uid()) and r.status = 'pending'));

-- helper functions chỉ dành cho người đã đăng nhập
revoke execute on function public.my_role(), public.is_staff(), public.my_customer_id(),
  public.has_role(variadic public.user_role[]), public.invoice_total(uuid) from anon, public;
grant execute on function public.my_role(), public.is_staff(), public.my_customer_id(),
  public.has_role(variadic public.user_role[]), public.invoice_total(uuid) to authenticated;
