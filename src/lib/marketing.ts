// Tab Marketing: nhãn, màu, kiểu dữ liệu dùng chung
export type MkPost = {
  id: string;
  title: string;
  pic_id: string | null;
  channels: string[];
  format: string;
  due_date: string | null;
  publish_date: string | null;
  status: string;
  brief: string | null;
  draft_url: string | null;
  published_url: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  submitted_at: string | null;
  published_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type MkPlan = {
  id: string;
  kind: string;
  title: string;
  start_at: string;
  end_at: string | null;
  location: string | null;
  pic_id: string | null;
  note: string | null;
  status: string;
  created_by: string;
  created_at: string;
};

export type MkPerson = { id: string; full_name: string | null; role: string };

export const POST_COLS =
  "id, title, pic_id, channels, format, due_date, publish_date, status, brief, draft_url, published_url, review_note, reviewed_at, submitted_at, published_at, created_by, created_at, updated_at";
export const PLAN_COLS = "id, kind, title, start_at, end_at, location, pic_id, note, status, created_by, created_at";

export const CHANNELS: { key: string; label: string; short: string; color: string }[] = [
  { key: "facebook", label: "Facebook", short: "FB", color: "bg-[#DCE6FA] text-[#1D4ED8]" },
  { key: "tiktok", label: "TikTok", short: "TT", color: "bg-[#E5E5E5] text-[#111]" },
  { key: "instagram", label: "Instagram", short: "IG", color: "bg-[#F9DDEB] text-[#A21C5E]" },
  { key: "zalo", label: "Zalo OA", short: "ZL", color: "bg-[#D9EEFB] text-[#0369A1]" },
  { key: "website", label: "Website", short: "WEB", color: "bg-beige text-navy" },
];
export const channelOf = (k: string) => CHANNELS.find((c) => c.key === k);

export const FORMATS: Record<string, string> = {
  post: "Bài viết + ảnh",
  album: "Album ảnh",
  video: "Video",
  reel: "Reels / video ngắn",
  story: "Story",
  article: "Bài web / blog",
  other: "Khác",
};

/** Trạng thái bài viết theo thứ tự quy trình */
export const POST_STATUS: Record<string, { t: string; c: string; bar: string }> = {
  idea: { t: "Ý tưởng", c: "bg-[#ECECEC] text-[#555]", bar: "bg-[#BDBDBD]" },
  doing: { t: "Đang làm", c: "bg-[#DCE3F5] text-navy", bar: "bg-[#7F8BC9]" },
  review: { t: "Chờ duyệt", c: "bg-[#FFE8BA] text-[#7A5600]", bar: "bg-[#E0A526]" },
  revise: { t: "Cần sửa", c: "bg-[#F6D5D5] text-[#8A2323]", bar: "bg-[#D9534F]" },
  approved: { t: "Đã duyệt", c: "bg-[#E6DDF5] text-[#4B2D7A]", bar: "bg-[#8E6CC4]" },
  published: { t: "Đã đăng", c: "bg-[#D6EDD8] text-[#22612A]", bar: "bg-[#4E9A57]" },
  cancelled: { t: "Huỷ", c: "bg-[#ECECEC] text-[#999] line-through", bar: "bg-[#DDDDDD]" },
};
export const POST_STATUS_ORDER = ["idea", "doing", "review", "revise", "approved", "published", "cancelled"];

/** Bài chưa nộp mà đã quá deadline */
export function isLate(p: Pick<MkPost, "status" | "due_date">, today: string): boolean {
  return !!p.due_date && p.due_date < today && ["idea", "doing", "revise"].includes(p.status);
}
/** Đã quá ngày đăng mà chưa đăng */
export function isLatePublish(p: Pick<MkPost, "status" | "publish_date">, today: string): boolean {
  return !!p.publish_date && p.publish_date < today && !["published", "cancelled"].includes(p.status);
}

export const PLAN_KIND: Record<string, { t: string; icon: string; c: string }> = {
  video: { t: "Quay video", icon: "🎬", c: "bg-[#F9DDEB] text-[#A21C5E]" },
  photo: { t: "Chụp ảnh", icon: "📷", c: "bg-[#D9EEFB] text-[#0369A1]" },
  meeting: { t: "Họp content", icon: "💬", c: "bg-[#FFE8BA] text-[#7A5600]" },
  other: { t: "Khác", icon: "📌", c: "bg-beige text-navy" },
};
export const PLAN_STATUS: Record<string, { t: string; c: string }> = {
  planned: { t: "Sắp tới", c: "bg-[#DCE3F5] text-navy" },
  done: { t: "Đã xong", c: "bg-[#D6EDD8] text-[#22612A]" },
  cancelled: { t: "Huỷ", c: "bg-[#ECECEC] text-[#999]" },
};

export function personName(people: MkPerson[], id: string | null | undefined): string {
  if (!id) return "Chưa giao";
  return people.find((p) => p.id === id)?.full_name ?? "(nhân viên cũ)";
}

/** "2026-11-09" -> "T2 09/11" */
export function dayLabel(d: string): string {
  return new Intl.DateTimeFormat("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }).format(
    new Date(`${d}T12:00:00+07:00`),
  );
}

/** Ngày cuối tháng "2026-11" -> "2026-11-30" */
export function lastDay(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(d).padStart(2, "0")}`;
}

export function isYm(s: string | undefined): s is string {
  return !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}
