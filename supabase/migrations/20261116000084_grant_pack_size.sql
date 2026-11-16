-- Cột pack_size (thêm ở 20261113000081 cho "Theo hộp / Theo ống") chưa được cấp quyền đọc.
-- Hậu quả: trang Nhập hàng / Kiểm kho / Xin xuất… đọc products kèm pack_size bị lỗi quyền →
-- danh sách sản phẩm rỗng, NV kho quét / tìm mã không ra sản phẩm; "Phiếu nhập của tôi" cũng rỗng.
grant select (pack_size) on public.products to authenticated;
grant select (pack_size) on public.stock_receipt_items to authenticated;
