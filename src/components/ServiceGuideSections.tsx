export type ServiceGuide = { indication: string | null; indication_ext: string | null; consult_guide: string | null };

const PARTS: { key: keyof ServiceGuide; id: string; title: string }[] = [
  { key: "indication", id: "chi-dinh", title: "Chỉ định" },
  { key: "indication_ext", id: "mo-rong", title: "Chỉ định mở rộng & cơ chế phối hợp sản phẩm" },
  { key: "consult_guide", id: "tu-van", title: "Hướng dẫn tư vấn" },
];

/** Chỉ định · Chỉ định mở rộng & cơ chế · Hướng dẫn tư vấn (bảng service_guides).
 *  collapsible: dạng gập/mở (dùng trong màn Quy trình liệu trình của KTV) */
export default function ServiceGuideSections({ guide, collapsible = false }: { guide: ServiceGuide | null; collapsible?: boolean }) {
  if (collapsible) {
    const has = PARTS.filter((p) => guide?.[p.key]);
    if (has.length === 0) return null;
    return (
      <div className="space-y-2">
        {has.map((p, i) => (
          <details key={p.key} open={i === 0} className="group rounded-[14px] bg-white px-3.5 py-3">
            <summary className="flex cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden justify-between gap-2 text-[15px] font-bold text-navy">
              {p.title}
              <span className="text-xs font-semibold text-brown group-open:hidden">Xem</span>
              <span className="hidden text-xs font-semibold text-brown group-open:inline">Thu gọn</span>
            </summary>
            <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-ink/85">{guide?.[p.key]}</p>
          </details>
        ))}
      </div>
    );
  }
  return (
    <>
      {PARTS.map((p) => (
        <section key={p.key} id={p.id} className="card scroll-mt-4 space-y-2">
          <h2 className="text-lg font-bold text-navy">{p.title}</h2>
          {guide?.[p.key] ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink/85">{guide[p.key]}</p>
          ) : (
            <p className="text-sm text-ink/50">Chưa có nội dung.</p>
          )}
        </section>
      ))}
    </>
  );
}
