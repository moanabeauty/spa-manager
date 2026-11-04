"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { activeNav, type IconName, type NavGroup } from "@/lib/nav";
import StaffSearch from "./StaffSearch";

const ICON_PATH: Record<IconName, string> = {
  home: "M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10",
  desk: "M4 4h16v6H4zM6 10v10M18 10v10M9 14h6",
  users: "M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M16 3.5a4 4 0 010 7.5M22 21v-1a6 6 0 00-4-5.6",
  box: "M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10",
  staff: "M4 5h16v14H4zM9 11a2 2 0 100-4 2 2 0 000 4zM6 16a3 3 0 016 0M14 9h4M14 13h4",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
};

function Icon({ name, className = "h-5 w-5" }: { name: IconName | "more"; className?: string }) {
  const d = name === "more" ? "M5 12h.01M12 12h.01M19 12h.01" : ICON_PATH[name];
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={name === "more" ? 3 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Badge({ n, dark }: { n: number; dark?: boolean }) {
  if (!n) return null;
  return (
    <span className={`ml-1 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-5 ${dark ? "bg-white text-navy" : "bg-[#C2410C] text-white"}`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** Điều hướng khu nhân viên: máy tính = thanh nhóm + mục con; điện thoại = mục con ở trên + thanh nhóm dưới đáy */
export default function StaffNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const { group, item } = activeNav(groups, path);
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [path]);

  // điện thoại: 4 nhóm hay dùng + "Thêm"
  const primary = groups.slice(0, groups.length > 5 ? 4 : groups.length);
  const rest = groups.length > 5 ? groups.slice(4) : [];
  const restActive = rest.some((g) => g.key === group?.key);
  const hideBottom = path.startsWith("/quan-ly/thu-tien"); // trang thu tiền có thanh chốt hoá đơn riêng ở đáy
  const href = (g: NavGroup) => g.items[0]?.href ?? "/quan-ly";

  return (
    <>
      <div className="space-y-2 print:hidden">
        <StaffSearch />
        {/* nhóm (máy tính) */}
        <nav className="hidden flex-wrap gap-1 sm:flex">
          {groups.map((g) => {
            const on = g.key === group?.key;
            return (
              <Link
                key={g.key}
                href={href(g)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${on ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark hover:bg-cream"}`}
              >
                <Icon name={g.icon} className="h-4 w-4" />
                {g.label}
                <Badge n={g.badge} dark={on} />
              </Link>
            );
          })}
        </nav>
        {/* mục con của nhóm đang mở */}
        {group && group.items.length > 1 && (
          <nav className="-mx-4 flex gap-1 overflow-x-auto border-b border-beige-dark/60 px-4 pb-2 sm:mx-0 sm:px-0">
            <span className="flex shrink-0 items-center gap-1 pr-1 text-xs font-bold uppercase tracking-wide text-brown sm:hidden">
              <Icon name={group.icon} className="h-4 w-4" />
              {group.label}
            </span>
            {group.items.map((i) => {
              const on = i.href === item?.href;
              return (
                <Link
                  key={i.href}
                  href={i.href}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${on ? "bg-beige text-navy" : "text-navy/70 hover:bg-beige/60"}`}
                >
                  {i.label}
                  <Badge n={i.badge ?? 0} />
                </Link>
              );
            })}
          </nav>
        )}
      </div>

      {/* thanh nhóm dưới đáy (điện thoại) */}
      {!hideBottom && (
        <>
          {more && (
            <div className="fixed inset-0 z-30 bg-black/30 sm:hidden" onClick={() => setMore(false)}>
              <div className="absolute inset-x-0 bottom-16 rounded-t-2xl bg-white p-3 shadow-lg" onClick={(e) => e.stopPropagation()}>
                {rest.map((g) => (
                  <div key={g.key} className="border-b border-beige py-2 last:border-0">
                    <p className="flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-wide text-brown">
                      <Icon name={g.icon} className="h-4 w-4" />
                      {g.label}
                      <Badge n={g.badge} />
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {g.items.map((i) => (
                        <Link key={i.href} href={i.href} className={`rounded-lg px-3 py-1.5 text-sm ${i.href === item?.href ? "bg-beige font-semibold text-navy" : "bg-cream text-navy"}`}>
                          {i.label}
                          <Badge n={i.badge ?? 0} />
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-beige-dark bg-white/95 backdrop-blur sm:hidden print:hidden">
            <div className="mx-auto flex max-w-3xl">
              {primary.map((g) => {
                const on = g.key === group?.key && !more;
                return (
                  <Link key={g.key} href={href(g)} className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${on ? "font-bold text-navy" : "text-ink/60"}`}>
                    <Icon name={g.icon} />
                    {g.label}
                    {g.badge > 0 && <span className="absolute right-[22%] top-1 h-2 w-2 rounded-full bg-[#C2410C]" />}
                  </Link>
                );
              })}
              {rest.length > 0 && (
                <button
                  onClick={() => setMore(!more)}
                  className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${more || restActive ? "font-bold text-navy" : "text-ink/60"}`}
                >
                  <Icon name="more" />
                  Thêm
                  {rest.some((g) => g.badge > 0) && <span className="absolute right-[22%] top-1 h-2 w-2 rounded-full bg-[#C2410C]" />}
                </button>
              )}
            </div>
          </nav>
        </>
      )}
    </>
  );
}
