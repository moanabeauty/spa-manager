-- Giai đoạn 6: thêm trạng thái "đã dùng" cho đăng ký khuyến mãi (tách riêng vì enum mới phải commit trước khi dùng)
alter type public.registration_status add value if not exists 'used';
