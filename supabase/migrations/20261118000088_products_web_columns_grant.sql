-- Bảng products phân quyền theo từng cột (ẩn giá nhập). 3 cột website mới thêm chưa được cấp quyền đọc
-- → mọi truy vấn sản phẩm có các cột này bị từ chối (403): trang sản phẩm, nhập hàng, kho... không thấy sản phẩm.
grant select (show_on_web, image_url, web_description) on public.products to authenticated;
