import { formatDmy } from "./format";
// Dùng chung cho CRM khách hàng (giai đoạn 8)

export type CrmCustomer = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  birthday: string | null;
  gender: string | null;
  home_branch_id: string | null;
  created_at: string;
  first_visit: string | null;
  last_visit: string | null;
  visit_count: number;
  spent_12m: number;
  spent_total: number;
  card_balance: number;
  sessions_left: number;
  has_package: boolean;
  has_card: boolean;
  full_menu: boolean;
  segments: string[];
  group_ids: string[];
  open_reminders: number;
};

export type CrmProfile = {
  customer_id: string;
  address: string | null;
  source: string | null;
  skin_type: string | null;
  skin_concerns: string | null;
  health_note: string | null;
  internal_note: string | null;
  menu_unlocked: boolean;
};

export type Group = { id: string; name: string; color: string; description: string | null; sort_order: number };

export type CrmSettings = {
  vip_spend_12m: number;
  inactive_days: number;
  birthday_days_before: number;
  package_expiry_days: number;
  unlock_menu_by_card: boolean;
};

/** Nhóm khách tự động (tính trong hàm crm_customers) */
export const SEGMENTS: { key: string; label: string; style: string; hint: string }[] = [
  { key: "moi", label: "Khách mới", style: "bg-[#DCE3F5] text-navy", hint: "Chưa mua gói / thẻ, đến tối đa 1 lần" },
  { key: "quay_lai", label: "Khách quay lại", style: "bg-[#E6DDF5] text-[#4B2D7A]", hint: "Đã đến từ 2 lần" },
  { key: "thanh_vien", label: "Đã mua gói / thẻ", style: "bg-[#D6EDD8] text-[#22612A]", hint: "Có gói combo hoặc thẻ nạp sẵn" },
  { key: "vip", label: "VIP", style: "bg-[#FFE8BA] text-[#7A5600]", hint: "Chi tiêu 12 tháng vượt mức cài đặt" },
  { key: "con_buoi", label: "Còn buổi / số dư", style: "bg-[#D6EDD8] text-[#22612A]", hint: "Còn buổi gói hoặc tiền trong thẻ" },
  { key: "lau_chua_den", label: "Lâu chưa quay lại", style: "bg-[#F6D5D5] text-[#8A2323]", hint: "Quá số ngày cài đặt chưa đến" },
  { key: "sinh_nhat", label: "Sinh nhật tháng này", style: "bg-[#FDE2EF] text-[#8A2357]", hint: "" },
];
export const SEGMENT_BY_KEY = new Map(SEGMENTS.map((s) => [s.key, s]));

export const REMINDER_KIND: Record<string, { label: string; style: string }> = {
  followup: { label: "Hỏi thăm sau làm", style: "bg-[#E6DDF5] text-[#4B2D7A]" },
  recall: { label: "Mời quay lại", style: "bg-[#DCE3F5] text-navy" },
  package_expiry: { label: "Gói sắp hết hạn", style: "bg-[#FFE8BA] text-[#7A5600]" },
  idle: { label: "Lâu chưa đến", style: "bg-[#F6D5D5] text-[#8A2323]" },
  birthday: { label: "Sinh nhật", style: "bg-[#FDE2EF] text-[#8A2357]" },
  manual: { label: "Nhắc thủ công", style: "bg-[#ECECEC] text-[#444]" },
  contact: { label: "Đã liên hệ", style: "bg-[#D6EDD8] text-[#22612A]" },
};

export const SOURCES = ["Facebook", "Instagram", "TikTok", "Google / Maps", "Zalo", "Bạn bè giới thiệu", "Khách vãng lai", "Khác"];
export const SKIN_TYPES = ["Da thường", "Da khô", "Da dầu", "Da hỗn hợp", "Da nhạy cảm", "Da mụn"];

export function shortDate(iso: string | null | undefined): string {
  return formatDmy(iso);
}

/** Số ngày từ ngày (YYYY-MM-DD) đến hôm nay */
export function daysSince(date: string | null, today: string): number | null {
  if (!date) return null;
  return Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${date}T00:00:00Z`).getTime()) / 86400000);
}

export function toCrmCustomer(r: Record<string, unknown>): CrmCustomer {
  return {
    ...(r as CrmCustomer),
    visit_count: Number(r.visit_count ?? 0),
    spent_12m: Number(r.spent_12m ?? 0),
    spent_total: Number(r.spent_total ?? 0),
    card_balance: Number(r.card_balance ?? 0),
    sessions_left: Number(r.sessions_left ?? 0),
    open_reminders: Number(r.open_reminders ?? 0),
    segments: (r.segments as string[]) ?? [],
    group_ids: (r.group_ids as string[]) ?? [],
  };
}
