// Cấu hình chung. Sửa ở đây nếu giờ mở cửa thay đổi.

// Khoá "publishable" của Supabase là khoá công khai (an toàn khi để trong code trình duyệt);
// dữ liệu được bảo vệ bằng Row Level Security trong cơ sở dữ liệu.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://gbkanpqajzfyyhlslxdj.supabase.co";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "sb_publishable_woVwiX6fwua-U5rTAQebHQ_xMDCn_33";

export const TIMEZONE = "Asia/Ho_Chi_Minh";
export const TZ_OFFSET = "+07:00";

// Khung giờ khách được chọn khi đặt online
export const OPEN_HOUR = 9; // giờ bắt đầu nhận khách
export const LAST_START_HOUR = 19; // giờ bắt đầu muộn nhất (19:30 là suất cuối)
export const SLOT_MINUTES = 30;
export const MIN_LEAD_MINUTES = 60; // phải đặt trước ít nhất 60 phút
export const MAX_DAYS_AHEAD = 60;

