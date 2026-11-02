-- Hàm trigger chỉ chạy nội bộ, không cho gọi qua API
revoke execute on function
  public.appointment_services_before_write(), public.appointments_after_status(),
  public.customer_packages_after_insert(), public.customer_packages_before_insert(),
  public.ensure_invoice_draft(), public.ensure_seller_item_draft(), public.handle_new_user(),
  public.invoices_before_status(), public.payments_card_charge(), public.payments_card_check(),
  public.stock_movements_check(), public.stock_requests_review()
from public, anon, authenticated;
-- tính tổng hoá đơn: dùng view invoice_totals thay cho hàm
revoke execute on function public.invoice_total(uuid) from public, anon, authenticated;
