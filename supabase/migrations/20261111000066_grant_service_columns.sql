-- services dùng quyền theo cột: cột mới phải grant select thì app mới đọc được.
-- Thiếu 2 cột này làm trang /menu và Quản lý → Menu dịch vụ bị lỗi 403.
grant select (internal_name, internal_note, fee_once_per_visit) on public.services to authenticated;
notify pgrst, 'reload schema';
