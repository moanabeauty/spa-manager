-- Xoá mã sản phẩm (tạo nhầm / trùng). Chỉ chủ spa hoặc quản lý.
-- Chỉ xoá hẳn được khi sản phẩm CHƯA từng phát sinh gì (nhập/xuất kho, phiếu nhập, hoá đơn,
-- yêu cầu xuất kho, kiểm kho, khuyến mãi). Đã có lịch sử thì không xoá để giữ đúng sổ sách:
-- chuyển sang "Ngừng lưu hành" (hoặc gộp sản phẩm) thay vì xoá.
create or replace function public.delete_product(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_used text[] := '{}';
begin
  if not public.has_role('owner', 'manager') then
    raise exception 'Chỉ chủ spa hoặc quản lý được xoá mã sản phẩm';
  end if;
  if not exists (select 1 from public.products where id = p_id) then
    raise exception 'Không tìm thấy sản phẩm';
  end if;

  if exists (select 1 from public.stock_movements where product_id = p_id) then v_used := v_used || 'nhập/xuất kho'; end if;
  if exists (select 1 from public.stock_receipt_items where product_id = p_id) then v_used := v_used || 'phiếu nhập hàng'; end if;
  if exists (select 1 from public.invoice_items where product_id = p_id) then v_used := v_used || 'hoá đơn'; end if;
  if exists (select 1 from public.stock_request_items where product_id = p_id) then v_used := v_used || 'yêu cầu xuất kho'; end if;
  if exists (select 1 from public.stock_count_items where product_id = p_id) then v_used := v_used || 'phiếu kiểm kho'; end if;
  if exists (select 1 from public.promotion_items where product_id = p_id) then v_used := v_used || 'gói khuyến mãi'; end if;

  if array_length(v_used, 1) > 0 then
    raise exception 'Không xoá được vì sản phẩm đã có trong: %. Hãy chuyển sang "Ngừng lưu hành" (hoặc gộp vào sản phẩm đúng) thay vì xoá.',
      array_to_string(v_used, ', ');
  end if;

  delete from public.products where id = p_id;
end $$;
revoke execute on function public.delete_product(uuid) from public, anon;
grant execute on function public.delete_product(uuid) to authenticated;
