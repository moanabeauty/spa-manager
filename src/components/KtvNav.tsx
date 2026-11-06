"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = { href: string; label: string; match: string[]; icon: React.ReactNode };

const svg = (d: React.ReactNode) => (
  <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

const TABS: Tab[] = [
  { href: "/quan-ly", label: "Hôm nay", match: ["/quan-ly", "/quan-ly/ktv/lich", "/quan-ly/ktv/lieu-trinh", "/quan-ly/ngoai-gio"], icon: svg(<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />) },
  { href: "/quan-ly/ktv/dat-lich", label: "Lịch", match: ["/quan-ly/ktv/dat-lich"], icon: svg(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>) },
  { href: "/quan-ly/thu-tien", label: "Bán hàng", match: ["/quan-ly/thu-tien", "/quan-ly/hoa-don"], icon: svg(<><path d="M4 6h16l-2 9H6z" /><circle cx="9" cy="19" r="1.5" /><circle cx="16" cy="19" r="1.5" /></>) },
  { href: "/quan-ly/kho", label: "Kho", match: ["/quan-ly/kho"], icon: svg(<><path d="M3 8l9-5 9 5v8l-9 5-9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>) },
  { href: "/quan-ly/ca-nhan", label: "Cá nhân", match: ["/quan-ly/ca-nhan", "/quan-ly/doanh-so", "/quan-ly/nghi-phep", "/quan-ly/phieu-thu-chi"], icon: svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></>) },
];

/** Mục con hiện ở đầu trang cho các nhóm có nhiều trang */
const SUB: { group: string; items: { href: string; label: string }[] }[] = [
  {
    group: "/quan-ly/kho",
    items: [
      { href: "/quan-ly/kho", label: "Tồn kho" },
      { href: "/quan-ly/kho/xin-xuat", label: "Xin xuất hàng" },
      { href: "/quan-ly/kho/san-pham", label: "Sản phẩm" },
      { href: "/quan-ly/kho/lich-su", label: "Lịch sử" },
    ],
  },
  {
    group: "/quan-ly/thu-tien",
    items: [
      { href: "/quan-ly/thu-tien", label: "Thu tiền / bán hàng" },
      { href: "/quan-ly/hoa-don", label: "Hoá đơn tôi bán" },
    ],
  },
];

function hit(path: string, base: string) {
  return base === "/quan-ly" ? path === "/quan-ly" : path === base || path.startsWith(base + "/");
}

/** Thanh điều hướng app KTV: 5 tab dưới đáy (giống app điện thoại) */
export default function KtvNav() {
  const path = usePathname();
  const active = TABS.find((t) => t.match.some((m) => hit(path, m)));
  const sub = SUB.find((s) => active && s.group === active.href);
  const hideBottom = path.startsWith("/quan-ly/thu-tien") || path.startsWith("/quan-ly/ktv/lieu-trinh") || path.startsWith("/quan-ly/ktv/lich/");

  return (
    <>
      {sub && (
        <nav className="-mx-4 flex gap-1 overflow-x-auto border-b border-beige-dark/60 px-4 pb-2 print:hidden">
          {sub.items.map((i) => {
            const on = path === i.href || (i.href !== sub.group && path.startsWith(i.href));
            return (
              <Link key={i.href} href={i.href} className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${on ? "bg-beige text-navy" : "text-navy/70"}`}>
                {i.label}
              </Link>
            );
          })}
        </nav>
      )}
      {!hideBottom && (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[#E6DDCC] bg-white pb-[env(safe-area-inset-bottom)] print:hidden">
          <div className="mx-auto grid max-w-3xl grid-cols-5 px-1 pt-1.5 pb-2">
            {TABS.map((t) => {
              const on = t === active;
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  className={`flex min-h-12 flex-col items-center justify-center gap-0.5 text-[11px] ${on ? "font-bold text-navy" : "text-[#646464]"}`}
                >
                  {t.icon}
                  {t.label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </>
  );
}
