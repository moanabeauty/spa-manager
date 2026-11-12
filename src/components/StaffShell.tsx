"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { activeNav, type IconName, type NavGroup } from "@/lib/nav";
import StaffSearch from "./StaffSearch";
import NotificationBell from "./NotificationBell";
import ThemeToggle from "./ThemeToggle";

const ICON_PATH: Record<IconName, string> = {
  home: "M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10",
  desk: "M4 4h16v6H4zM6 10v10M18 10v10M9 14h6",
  users: "M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M16 3.5a4 4 0 010 7.5M22 21v-1a6 6 0 00-4-5.6",
  box: "M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10",
  staff: "M4 5h16v14H4zM9 11a2 2 0 100-4 2 2 0 000 4zM6 16a3 3 0 016 0M14 9h4M14 13h4",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  check: "M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h9",
  megaphone: "M3 10v4a1 1 0 001 1h3l6 4V5L7 9H4a1 1 0 00-1 1zM17 9a4 4 0 010 6M19.5 6.5a7.5 7.5 0 010 11",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
};

export function NavIcon({ name, className = "h-5 w-5" }: { name: IconName | "more"; className?: string }) {
  const d = name === "more" ? "M5 12h.01M12 12h.01M19 12h.01" : ICON_PATH[name];
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={name === "more" ? 3 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Badge({ n, tone = "alert" }: { n: number; tone?: "alert" | "gold" | "light" }) {
  if (!n) return null;
  const cls = tone === "gold" ? "bg-gold text-[#1f2050]" : tone === "light" ? "bg-white text-navy" : "bg-[#C2410C] text-white";
  return (
    <span className={`ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-5 ${cls}`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

type ShellProps = {
  groups: NavGroup[];
  userId: string;
  unread: number;
  fullName: string;
  roleLabel: string;
  children: React.ReactNode;
};

/**
 * Khung khu nhân viên (chủ, quản lý, lễ tân, kho, marketing):
 * máy tính = menu dọc bên trái chia nhóm + thanh trên (tìm kiếm, chuông, chế độ tối, avatar);
 * điện thoại / máy tính bảng = thanh trên gọn + mục con ở đầu trang + thanh nhóm dưới đáy.
 */
export default function StaffShell({ groups, userId, unread, fullName, roleLabel, children }: ShellProps) {
  const path = usePathname();
  const { group, item } = activeNav(groups, path);

  return (
    <div className="staff-shell min-h-screen">
      <Sidebar groups={groups} activeHref={item?.href ?? null} />
      <div className="lg:pl-[17rem] print:pl-0">
        <TopBar userId={userId} unread={unread} fullName={fullName} roleLabel={roleLabel} crumb={group && item ? [group.label, item.label] : null} />
        <div className="staff-content mx-auto w-full max-w-5xl px-4 pb-24 pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
          <MobileSubNav group={group} activeHref={item?.href ?? null} />
          <div className="space-y-4">{children}</div>
        </div>
      </div>
      <BottomNav groups={groups} activeKey={group?.key ?? null} activeHref={item?.href ?? null} path={path} />
    </div>
  );
}

/* ---------------- Menu dọc (máy tính) ---------------- */
function Sidebar({ groups, activeHref }: { groups: NavGroup[]; activeHref: string | null }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[17rem] flex-col bg-navy text-[#EEE5D6] lg:flex print:hidden dark:bg-[#101126]">
      <Link href="/quan-ly" className="flex items-center gap-3 px-7 pb-6 pt-7" aria-label="Moana Beauty – Tổng quan">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-moana-light.png" alt="Moana Beauty" width={120} height={42} className="h-9 w-auto" />
      </Link>
      <div className="mx-7 h-px bg-linear-to-r from-gold/60 via-gold/20 to-transparent" />
      <nav className="sidebar-scroll flex-1 space-y-5 overflow-y-auto px-4 py-5">
        {groups.map((g) => {
          // nhóm 1 mục (Tổng quan, Chờ duyệt): hiện thẳng thành 1 dòng có biểu tượng
          if (g.items.length === 1) {
            const i = g.items[0];
            return (
              <div key={g.key}>
                <SideLink href={i.href} on={i.href === activeHref} badge={g.badge} icon={g.icon}>
                  {g.label}
                </SideLink>
              </div>
            );
          }
          return (
            <div key={g.key}>
              <p className="mb-1.5 flex items-center gap-2 px-3 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-gold/80">
                <NavIcon name={g.icon} className="h-3.5 w-3.5" />
                {g.label}
              </p>
              <div className="space-y-0.5">
                {g.items.map((i) => (
                  <SideLink key={i.href} href={i.href} on={i.href === activeHref} badge={i.badge ?? 0}>
                    {i.label}
                  </SideLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <p className="px-7 pb-5 pt-2 font-display text-sm italic tracking-wide text-gold/70">✦ Moana Beauty · Hà Nội</p>
    </aside>
  );
}

function SideLink({ href, on, badge, icon, children }: { href: string; on: boolean; badge: number; icon?: IconName; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] transition ${
        on ? "bg-white/10 font-semibold text-white" : "text-[#EEE5D6]/75 hover:bg-white/5 hover:text-white"
      }`}
    >
      {on && <span className="absolute -left-4 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-gold" />}
      {icon && <NavIcon name={icon} className="h-[18px] w-[18px]" />}
      <span className="min-w-0 truncate">{children}</span>
      <Badge n={badge} tone={on ? "gold" : "alert"} />
    </Link>
  );
}

/* ---------------- Thanh trên cùng ---------------- */
function TopBar({ userId, unread, fullName, roleLabel, crumb }: { userId: string; unread: number; fullName: string; roleLabel: string; crumb: [string, string] | null }) {
  return (
    <header className="sticky top-0 z-20 border-b border-beige-dark/50 bg-[#FAF8F3]/85 backdrop-blur-md print:hidden dark:bg-[#13142a]/85">
      <div className="mx-auto flex h-16 max-w-[88rem] items-center gap-3 px-4 sm:px-6 lg:h-[4.5rem] lg:px-10">
        <Link href="/quan-ly" className="shrink-0 lg:hidden" aria-label="Moana Beauty – Tổng quan">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-moana.png" alt="Moana Beauty" width={92} height={32} className="h-7 w-auto" />
        </Link>
        {crumb && (
          <p className="hidden shrink-0 text-xs text-ink/50 xl:block">
            {crumb[0] === crumb[1] ? crumb[0] : `${crumb[0]} / `}
            {crumb[0] !== crumb[1] && <span className="font-semibold text-ink/80">{crumb[1]}</span>}
          </p>
        )}
        <div className="hidden min-w-0 max-w-md flex-1 sm:block xl:ml-6">
          <StaffSearch />
        </div>
        <span className="flex-1 sm:hidden" />
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <NotificationBell userId={userId} initialUnread={unread} />
          <AvatarMenu fullName={fullName} roleLabel={roleLabel} />
        </div>
      </div>
      {/* điện thoại: ô tìm kiếm xuống dòng dưới */}
      <div className="px-4 pb-3 sm:hidden">
        <StaffSearch />
      </div>
    </header>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "M";
  const last = parts[parts.length - 1][0] ?? "";
  return (parts.length > 1 ? (parts[parts.length - 2][0] ?? "") + last : last).toUpperCase();
}

function AvatarMenu({ fullName, roleLabel }: { fullName: string; roleLabel: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2.5 rounded-full p-0.5 pr-0.5 hover:bg-beige/60 sm:pr-3" aria-label="Tài khoản">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-linear-to-br from-gold to-brown font-display text-base font-bold text-white ring-2 ring-white dark:ring-[#1e2040]">
          {initials(fullName)}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-[10rem] truncate text-sm font-semibold text-ink">{fullName}</span>
          <span className="block text-[11px] text-ink/55">{roleLabel}</span>
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-beige-dark/70 bg-surface py-1 text-sm shadow-xl">
          <div className="border-b border-beige px-4 py-3 sm:hidden">
            <p className="font-semibold">{fullName}</p>
            <p className="text-xs text-ink/55">{roleLabel}</p>
          </div>
          <Link href="/" className="block px-4 py-2.5 hover:bg-cream">Xem trang khách</Link>
          <Link href="/quan-ly/thong-bao" className="block px-4 py-2.5 hover:bg-cream">Thông báo</Link>
          <Link href="/doi-mat-khau" className="block px-4 py-2.5 hover:bg-cream">Đổi mật khẩu</Link>
          <form action="/dang-xuat" method="post" className="border-t border-beige">
            <button className="block w-full px-4 py-2.5 text-left text-brown hover:bg-cream">Đăng xuất</button>
          </form>
        </div>
      )}
    </div>
  );
}

/* ---------------- Điện thoại / máy tính bảng ---------------- */
function MobileSubNav({ group, activeHref }: { group: NavGroup | null; activeHref: string | null }) {
  if (!group || group.items.length < 2) return null;
  return (
    <nav className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:hidden print:hidden">
      <span className="flex shrink-0 items-center gap-1 pr-1 text-[11px] font-bold uppercase tracking-[0.14em] text-brown">
        <NavIcon name={group.icon} className="h-4 w-4" />
        {group.label}
      </span>
      {group.items.map((i) => {
        const on = i.href === activeHref;
        return (
          <Link
            key={i.href}
            href={i.href}
            className={`flex shrink-0 items-center rounded-full px-3.5 py-1.5 text-sm font-medium ${on ? "bg-navy text-white" : "bg-surface text-navy ring-1 ring-beige-dark/70"}`}
          >
            {i.label}
            {i.badge ? <span className="ml-1.5"><Badge n={i.badge} tone={on ? "light" : "alert"} /></span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

function BottomNav({ groups, activeKey, activeHref, path }: { groups: NavGroup[]; activeKey: string | null; activeHref: string | null; path: string }) {
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [path]);
  const primary = groups.slice(0, groups.length > 5 ? 4 : groups.length);
  const rest = groups.length > 5 ? groups.slice(4) : [];
  const restActive = rest.some((g) => g.key === activeKey);
  if (path.startsWith("/quan-ly/thu-tien")) return null; // trang thu tiền có thanh chốt hoá đơn riêng ở đáy
  const href = (g: NavGroup) => g.items[0]?.href ?? "/quan-ly";

  return (
    <>
      {more && (
        <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setMore(false)}>
          <div className="absolute inset-x-0 bottom-[var(--bottom-nav-h)] max-h-[70vh] overflow-y-auto rounded-t-3xl bg-surface p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            {rest.map((g) => (
              <div key={g.key} className="border-b border-beige py-2.5 last:border-0">
                <p className="flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-brown">
                  <NavIcon name={g.icon} className="h-4 w-4" />
                  {g.label}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {g.items.map((i) => (
                    <Link key={i.href} href={i.href} className={`flex items-center rounded-full px-3 py-1.5 text-sm ${i.href === activeHref ? "bg-navy font-semibold text-white" : "bg-cream text-navy"}`}>
                      {i.label}
                      {i.badge ? <span className="ml-1.5"><Badge n={i.badge} /></span> : null}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <nav className="staff-bottom-nav fixed inset-x-0 bottom-0 z-40 border-t border-beige-dark/60 bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden print:hidden">
        <div className="mx-auto flex h-[3.75rem] max-w-3xl">
          {primary.map((g) => {
            const on = g.key === activeKey && !more;
            return (
              <Link key={g.key} href={href(g)} className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${on ? "font-bold text-navy" : "text-ink/55"}`}>
                {on && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-gold" />}
                <NavIcon name={g.icon} />
                {g.label}
                {g.badge > 0 && <span className="absolute right-[22%] top-1.5 h-2 w-2 rounded-full bg-[#C2410C]" />}
              </Link>
            );
          })}
          {rest.length > 0 && (
            <button
              onClick={() => setMore(!more)}
              className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${more || restActive ? "font-bold text-navy" : "text-ink/55"}`}
            >
              <NavIcon name="more" />
              Thêm
              {rest.some((g) => g.badge > 0) && <span className="absolute right-[22%] top-1.5 h-2 w-2 rounded-full bg-[#C2410C]" />}
            </button>
          )}
        </div>
      </nav>
    </>
  );
}
