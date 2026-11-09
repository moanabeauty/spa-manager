import type { ReactNode } from "react";

// Phiếu theo dõi da 3 màu (khoá trong cơ sở dữ liệu vẫn là green / yellow / red)
export type SkinColor = "green" | "yellow" | "red";

export const SKIN_COLORS: { key: SkinColor; label: string; short: string; dot: string; bar: string; soft: string; text: string }[] = [
  // Xanh chàm và nâu vàng theo bảng màu guideline Moana (#2B2D64, #A0845E); đỏ thêm ngoài bảng
  { key: "green", label: "Xanh – da tốt, ổn định", short: "Xanh", dot: "bg-[#2B2D64]", bar: "border-l-[#2B2D64]", soft: "bg-[#E9EAF3] border-[#A9AACB]", text: "text-[#2B2D64]" },
  { key: "yellow", label: "Vàng – cần theo dõi, cải thiện", short: "Vàng", dot: "bg-[#A0845E]", bar: "border-l-[#A0845E]", soft: "bg-[#F3ECE1] border-[#D3C1A3]", text: "text-[#6E5A3E]" },
  { key: "red", label: "Đỏ – có vấn đề, cần xử lý", short: "Đỏ", dot: "bg-[#C94A4A]", bar: "border-l-[#C94A4A]", soft: "bg-[#FCE4E4] border-[#E8A5A5]", text: "text-[#8A2323]" },
];
export const SKIN_COLOR = new Map(SKIN_COLORS.map((c) => [c.key, c]));

/** Nhu cầu khách hay gặp (bấm chọn nhanh) */
export const NEED_TAGS = [
  "Trị mụn",
  "Mờ thâm, nám",
  "Sáng da",
  "Cấp ẩm",
  "Làm dịu da",
  "Se lỗ chân lông",
  "Trẻ hoá, chống lão hoá",
  "Nâng cơ, gọn mặt",
  "Trị sẹo",
  "Thư giãn",
  "Tóc, da đầu",
  "Body",
  "Quan tâm gói combo",
  "Quan tâm thẻ nạp",
  "Mua sản phẩm tại nhà",
];

export type SkinRecord = {
  id: string;
  customer_id: string;
  appointment_id: string | null;
  branch_id: string | null;
  record_date: string;
  overall: SkinColor;
  criteria: Record<string, SkinColor>;
  reaction: string | null;
  customer_needs: string | null;
  need_tags: string[];
  recommendation: string | null;
  homecare: string | null;
  next_visit_days: number | null;
  internal_note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export function shortDay(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export function SkinDot({ color, size = "h-3 w-3" }: { color: SkinColor | null | undefined; size?: string }) {
  const c = color ? SKIN_COLOR.get(color) : null;
  return <span className={`inline-block shrink-0 rounded-full ${size} ${c ? c.dot : "bg-[#D9D4C8]"}`} title={c?.short ?? "Chưa có"} />;
}

export function SkinBadge({ color }: { color: SkinColor }) {
  const c = SKIN_COLOR.get(color)!;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${c.soft} ${c.text}`}>
      <SkinDot color={color} size="h-2.5 w-2.5" />
      {c.short}
    </span>
  );
}

/** Thẻ hiển thị 1 phiếu da (dùng ở hồ sơ khách, lịch hẹn, trang khách) */
export function SkinRecordCard({
  r,
  showInternal,
  footer,
  heading,
}: {
  r: Pick<SkinRecord, "record_date" | "overall" | "need_tags" | "recommendation" | "homecare" | "next_visit_days"> &
    Partial<Pick<SkinRecord, "criteria" | "reaction" | "customer_needs" | "internal_note">>;
  showInternal?: boolean;
  footer?: ReactNode;
  heading?: ReactNode;
}) {
  const c = SKIN_COLOR.get(r.overall)!;
  return (
    <div className={`rounded-xl border border-l-4 p-3 text-sm ${c.soft} ${c.bar}`}>
      <div className={`flex flex-wrap items-center gap-2 ${c.text}`}>
        <SkinDot color={r.overall} />
        <b>{c.label}</b>
        <span className="ml-auto text-xs text-ink/60">{heading ?? shortDay(r.record_date)}</span>
      </div>
      {(r.need_tags?.length > 0 || r.customer_needs) && (
        <p className="mt-2 text-ink">
          <span className="font-semibold">Nhu cầu khách: </span>
          {r.need_tags?.join(", ")}
          {r.need_tags?.length > 0 && r.customer_needs ? " · " : ""}
          {r.customer_needs}
        </p>
      )}
      {r.recommendation && <p className="mt-1 text-ink"><span className="font-semibold">Đề xuất buổi sau: </span>{r.recommendation}</p>}
      {r.homecare && <p className="mt-1 text-ink"><span className="font-semibold">Chăm sóc da sau liệu trình: </span>{r.homecare}</p>}
      {r.next_visit_days && <p className="mt-1 text-xs text-ink/70">Hẹn quay lại sau {r.next_visit_days} ngày</p>}
      {showInternal && r.internal_note && (
        <p className="mt-1 rounded-lg bg-white/70 px-2 py-1 text-xs text-ink/80">Ghi chú nội bộ: {r.internal_note}</p>
      )}
      {footer}
    </div>
  );
}
