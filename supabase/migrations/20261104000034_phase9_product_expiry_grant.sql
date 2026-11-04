-- nhân viên đọc được hạn sử dụng sản phẩm (bảng products cấp quyền đọc theo từng cột, giá nhập vẫn ẩn)
grant select (expiry_date) on public.products to authenticated;
