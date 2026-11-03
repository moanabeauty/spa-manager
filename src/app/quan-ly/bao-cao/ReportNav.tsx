import Link from "next/link";

export default function ReportNav({ active, isOwner }: { active: string; isOwner: boolean }) {
  const items = [
    { href: "/quan-ly/bao-cao", key: "doanh-thu", label: "Doanh thu" },
    { href: "/quan-ly/bao-cao/goi-the", key: "goi-the", label: "Gói & thẻ còn nợ khách" },
    { href: "/quan-ly/bang-luong", key: "luong", label: isOwner ? "Bảng lương" : "Chấm công" },
    ...(isOwner ? [{ href: "/quan-ly/thu-chi", key: "thu-chi", label: "Thu chi & lợi nhuận" }] : []),
  ];
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${i.key === active ? "bg-beige text-navy" : "text-ink/70 hover:bg-beige/60"}`}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}
