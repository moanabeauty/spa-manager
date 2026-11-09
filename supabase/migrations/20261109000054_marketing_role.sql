-- Vai trò mới: Marketing (chạy riêng vì giá trị enum mới phải được lưu trước khi dùng)
alter type public.user_role add value if not exists 'marketing';
