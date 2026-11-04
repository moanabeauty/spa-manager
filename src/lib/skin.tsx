import type { ReactNode } from "react";

// Phiếu theo dõi da 3 màu
export type SkinColor = "green" | "yellow" | "red";

export const SKIN_COLORS: { key: SkinColor; label: string; short: string; dot: string; bar: string; soft: string; text: string }[] = [
  { key: "green", label: "Xanh – da tốt, ổn định", short: "Xanh", dot: "bg-[#3E9B4F]", bar: "border-l-[#3E9B4F]", soft: "bg-[#E3F3E5] border-[#9CD3A5]", text: "text-[#22612A]" },
  { key: "yellow", label: "Vàng – cần theo dõi, cải thiện", short: "Vàng", dot: "bg-[#E0A526]", bar: "border-l-[#E0A526]", soft: "bg-[#FFF3D6] border-[#F0CF85]", text: "text-[#7A5600]" },
  { key: "red", label: "Đỏ – có vấn đề, cần xử lý", short: "Đỏ", dot: "bg-[#C94A4A]", bar: "border-l-[#C94A4A]", soft: "bg-[#FCE4E4] border-[#E8A5A5]", text: "text-[#8A2323]" },
];
export const SKIN_COLOR = new Map(SKIN_COLORS.map((c) => [c.key, c]));

/** Các mục đánh giá trên phiếu (mỗi mục chọn 1 trong 3 màu, bỏ trống = không đánh giá) */
export const SKIN_CRITERIA: { key: string; label: string }[] = [
  { key: "mun", label: "Mụn" },
  { key: "tham", label: "Thâm / nám / sắc tố" },
  { key: "am", label: "Độ ẩm" },
  { key: "dau", label: "Dầu nhờn" },
  { key: "nhay_cam", label: "Nhạy cảm / đỏ" },
  { key: "lo_chan_long", label: "Lỗ chân lông" },
  { key: "lao_hoa", label: "Nếp nhăn / lão hoá" },
  { key: "seo", label: "Sẹo" },
];

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
  r: Pick<SkinRecord, "record_date" | "overall" | "criteria" | "need_tags" | "recommendation" | "homecare" | "next_visit_days"> &
    Partial<Pick<SkinRecord, "reaction" | "customer_needs" | "internal_note">>;
  showInternal?: boolean;
  footer?: ReactNode;
  heading?: ReactNode;
}) {
  const c = SKIN_COLOR.get(r.overall)!;
  const crit = SKIN_CRITERIA.filter((x) => r.criteria?.[x.key]);
  return (
    <div className={`rounded-xl border border-l-4 p-3 text-sm ${c.soft} ${c.bar}`}>
      <div className={`flex flex-wrap items-center gap-2 ${c.text}`}>
        <SkinDot color={r.overall} />
        <b>{c.label}</b>
        <span className="ml-auto text-xs text-ink/60">{heading ?? shortDay(r.record_date)}</span>
      </div>
      {crit.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {crit.map((x) => (
            <span key={x.key} className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-xs text-ink ring-1 ring-beige-dark">
              <SkinDot color={r.criteria[x.key]} size="h-2 w-2" /> {x.label}
            </span>
          ))}
        </div>
      )}
      {(r.need_tags?.length > 0 || r.customer_needs) && (
        <p className="mt-2 text-ink">
          <span className="font-semibold">Nhu cầu khách: </span>
          {r.need_tags?.join(", ")}
          {r.need_tags?.length > 0 && r.customer_needs ? " · " : ""}
          {r.customer_needs}
        </p>
      )}
      {showInternal && r.reaction && <p className="mt-1 text-ink"><span className="font-semibold">Phản ứng da: </span>{r.reaction}</p>}
      {r.recommendation && <p className="mt-1 text-ink"><span className="font-semibold">Đề xuất: </span>{r.recommendation}</p>}
      {r.homecare && <p className="mt-1 text-ink"><span className="font-semibold">Chăm sóc tại nhà: </span>{r.homecare}</p>}
      {r.next_visit_days && <p className="mt-1 text-xs text-ink/70">Hẹn quay lại sau {r.next_visit_days} ngày</p>}
      {showInternal && r.internal_note && (
        <p className="mt-1 rounded-lg bg-white/70 px-2 py-1 text-xs text-ink/80">Ghi chú nội bộ: {r.internal_note}</p>
      )}
      {footer}
    </div>
  );
}
