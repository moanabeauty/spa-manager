import { TIMEZONE, TZ_OFFSET } from "./config";

export function formatVnd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "Báo giá tại spa";
  return new Intl.NumberFormat("vi-VN").format(n) + "đ";
}

export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h} giờ ${m} phút`;
  if (h) return `${h} giờ`;
  return `${m} phút`;
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: TIMEZONE,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

/** Ngày hôm nay theo giờ Việt Nam, dạng YYYY-MM-DD */
export function todayVn(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(d);
}

/** "2026-11-05" + "09:30" -> Date (giờ Việt Nam) */
export function vnDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00${TZ_OFFSET}`);
}

export const STATUS_LABEL: Record<string, string> = {
  pending: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  in_progress: "Đang làm",
  completed: "Hoàn thành",
  cancelled: "Đã huỷ",
  no_show: "Không đến",
};

export const STATUS_STYLE: Record<string, string> = {
  pending: "bg-[#FFE8BA] text-[#7A5600]",
  confirmed: "bg-[#DCE3F5] text-navy",
  in_progress: "bg-[#E6DDF5] text-[#4B2D7A]",
  completed: "bg-[#D6EDD8] text-[#22612A]",
  cancelled: "bg-[#ECECEC] text-[#666]",
  no_show: "bg-[#F6D5D5] text-[#8A2323]",
};

/** Dịch lỗi Supabase sang tiếng Việt dễ hiểu */
export function vnError(message: string | undefined): string {
  if (!message) return "Có lỗi xảy ra, vui lòng thử lại.";
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Email hoặc mật khẩu không đúng.";
  if (m.includes("email not confirmed")) return "Email chưa được xác nhận. Vui lòng mở hộp thư và bấm link xác nhận.";
  if (m.includes("user already registered")) return "Email này đã có tài khoản. Hãy đăng nhập.";
  if (m.includes("password should be at least")) return "Mật khẩu cần ít nhất 6 ký tự.";
  if (m.includes("unable to validate email") || m.includes("invalid format")) return "Email không hợp lệ.";
  if (m.includes("rate limit")) return "Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.";
  if (m.includes("row-level security")) return "Bạn không có quyền thực hiện thao tác này.";
  if (m.includes("no_technician_overlap")) return "Kỹ thuật viên đã có lịch trùng giờ.";
  if (m.includes("duplicate key") && m.includes("phone")) return "Số điện thoại này đã có hồ sơ khách.";
  if (m.includes("violates check constraint")) return "Giá trị nhập không hợp lệ (số âm hoặc thời lượng bằng 0).";
  if (m.includes("invalid input syntax")) return "Giá trị nhập không hợp lệ.";
  return message;
}

export const ROLE_LABEL: Record<string, string> = {
  owner: "Chủ spa",
  manager: "Quản lý",
  receptionist: "Lễ tân",
  technician: "Kỹ thuật viên",
  warehouse: "Quản lý kho",
  customer: "Khách hàng",
};

/** "+84 912 345 678" -> "0912345678" (giống hàm normalize_phone trong cơ sở dữ liệu) */
export function normalizePhone(p: string): string {
  const d = p.replace(/\D/g, "");
  if (d.startsWith("84") && d.length === 11) return "0" + d.slice(2);
  return d;
}

/** Bỏ dấu tiếng Việt để tìm kiếm */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d");
}
