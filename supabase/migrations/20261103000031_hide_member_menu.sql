-- Ẩn hẳn thông tin dịch vụ cao cấp với khách chưa mua gói (chủ spa yêu cầu):
-- không đếm số dịch vụ ẩn, không lộ tên nhóm dịch vụ, không lộ gói combo.

-- 1. Không còn hàm đếm dịch vụ ẩn cho khách / người chưa đăng nhập
revoke execute on function public.menu_locked_summary() from anon, authenticated;

-- 2. Nhóm dịch vụ: chỉ hiện nhóm có ít nhất 1 dịch vụ người xem được phép thấy
--    (truy vấn con chạy với quyền của người xem nên tự lọc theo cấp menu)
alter policy "public read" on public.service_categories
  using ((select public.can_view_full_menu())  -- nhân viên / khách đã mua gói (hàm này khách chưa đăng nhập gọi được)
         or exists (select 1 from public.services s where s.category_id = service_categories.id));

-- 3. Gói combo (tên, thành phần, dịch vụ trong gói): chỉ nhân viên và khách đã mở toàn bộ menu
alter policy "public read" on public.packages using ((select public.can_view_full_menu()));
alter policy "public read" on public.package_items using ((select public.can_view_full_menu()));
alter policy "public read" on public.package_item_services using ((select public.can_view_full_menu()));
