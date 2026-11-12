-- Cột deleted_at / deleted_by (thêm khi làm "Xoá mã sản phẩm") chưa được cấp quyền đọc cho nhân viên đăng nhập.
-- Hậu quả: mọi trang đọc products kèm deleted_at (Sản phẩm, chi tiết SP, Tồn kho, Nhập hàng, Xin xuất,
-- Chuyển kho, Kiểm kho) bị lỗi quyền và hiện rỗng / "Không tìm thấy sản phẩm".
grant select (deleted_at, deleted_by) on public.products to authenticated;
