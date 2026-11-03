"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function ManagerTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1">
      {tabs.map((t) => {
        const on = t.href === "/quan-ly" ? path === "/quan-ly" : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${on ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
