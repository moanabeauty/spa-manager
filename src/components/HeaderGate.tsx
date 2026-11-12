"use client";

import { usePathname } from "next/navigation";

/** Ẩn thanh trên của trang khách khi nhân viên đang ở khu /quan-ly (đã có thanh trên riêng) */
export default function HeaderGate({ hideOnStaff, children }: { hideOnStaff: boolean; children: React.ReactNode }) {
  const path = usePathname();
  if (hideOnStaff && (path === "/quan-ly" || path.startsWith("/quan-ly/"))) return null;
  return <>{children}</>;
}
