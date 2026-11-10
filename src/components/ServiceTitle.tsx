import type { ReactNode } from "react";

/**
 * Cách hiện tên liệu trình thống nhất trong app:
 *  - dòng 1: TÊN TRUYỀN THÔNG (chữ in hoa, đậm, màu navy)
 *  - dòng 2: diễn giải ngắn tiếng Việt (chữ nhỏ, xám)
 *  - nhân viên: thêm tên nội bộ + ghi chú (chữ nhỏ hơn, nhạt)
 */
export default function ServiceTitle({
  nameEn,
  name,
  internalName,
  internalNote,
  showInternal = false,
  badge,
}: {
  nameEn: string | null;
  name: string;
  internalName?: string | null;
  internalNote?: string | null;
  showInternal?: boolean;
  badge?: ReactNode;
}) {
  const title = nameEn?.trim() || name;
  const caption = nameEn?.trim() ? name : null;
  const internal = showInternal && internalName && internalName !== name ? internalName : null;
  return (
    <span className="block min-w-0">
      <span className="block text-sm font-semibold uppercase tracking-wide text-navy">
        {title}
        {badge}
      </span>
      {caption && <span className="mt-0.5 block text-xs text-ink/70">{caption}</span>}
      {(internal || (showInternal && internalNote)) && (
        <span className="mt-0.5 block text-[11px] text-ink/50">
          🔒 {[internal, showInternal ? internalNote : null].filter(Boolean).join(" · ")}
        </span>
      )}
    </span>
  );
}
