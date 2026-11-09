// Dùng chung cho app Kỹ thuật viên (KTV)
import { TIMEZONE } from "./config";

/** Cảnh báo tư vấn: thẻ dưới 2 triệu hoặc combo còn dưới 3 buổi */
export const CARD_ALERT = 2_000_000;
export const COMBO_ALERT = 3;

/** Lý do ở lại / đến sớm ngoài giờ */
export const OFFHOURS_REASONS = ["Làm cho khách", "Dọn dẹp, chuẩn bị", "Họp, đào tạo", "Khác"] as const;

/** Giờ bắt đầu sớm (trước giờ này chấm vào phải ghi lý do) và giờ tính tăng ca */
export const EARLY_START = "08:30";
export const OT_START = "18:30";

export type MyDayRow = {
  appointment_id: string;
  start_at: string;
  end_at: string | null;
  status: string;
  customer_id: string;
  customer_name: string;
  services: string;
  minutes: number;
  ktv_confirmed_at: string | null;
  ktv_confirmed_auto: boolean;
  is_consultation: boolean;
  card_balance: number;
  combo_min_left: number | null;
  debt: number;
  work_started: boolean;
  work_done: boolean;
};

/** Trạng thái hiển thị cho KTV: Chờ xác nhận / Đã nhận / Đang làm / Xong */
export function ktvState(r: Pick<MyDayRow, "status" | "ktv_confirmed_at" | "work_started" | "work_done">): {
  label: string;
  style: string;
} {
  if (r.work_done || r.status === "completed") return { label: "Xong", style: "bg-[#E4F2E9] text-[#1F5E3A]" };
  if (r.work_started || r.status === "in_progress") return { label: "Đang làm", style: "bg-[#E4E4EF] text-navy" };
  if (!r.ktv_confirmed_at) return { label: "Chờ xác nhận", style: "bg-beige text-[#5E4B30]" };
  return { label: "Đã nhận", style: "bg-white text-navy ring-1 ring-navy/30" };
}

export { nowVnHHMM } from "./format";

/** Số phút giữa 2 mốc "HH:MM" (b − a) */
export function minutesBetween(a: string, b: string): number {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  return bh * 60 + bm - (ah * 60 + am);
}

/** "Thứ Bảy 07/11" */
const WEEKDAY = new Intl.DateTimeFormat("vi-VN", { timeZone: TIMEZONE, weekday: "long" });

export function weekdayShort(date: string): string {
  const d = new Date(`${date}T12:00:00+07:00`);
  const wd = WEEKDAY.format(d);
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** "T7" / "CN" */
export function weekdayTiny(date: string): string {
  const dow = new Date(`${date}T12:00:00+07:00`).getUTCDay();
  return dow === 0 ? "CN" : `T${dow + 1}`;
}

/** Đồng hồ mm:ss từ một thời điểm */
export function elapsed(fromIso: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
}
