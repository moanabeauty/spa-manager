import Link from "next/link";
import type { Profile } from "@/lib/supabase/server";
import { canManageStock } from "@/lib/inventory";

/** Thanh chọn trang con trong Kho */
export function KhoNav({ active, role, pending }: { active: string; role: Profile["role"]; pending?: number }) {
  const items = [
    { href: "/quan-ly/kho", key: "ton", label: "Tồn kho" },
    ...(canManageStock(role) ? [{ href: "/quan-ly/kho/nhap-hang", key: "nhap", label: "Nhập hàng" }] : []),
    { href: "/quan-ly/kho/xin-xuat", key: "xuat", label: canManageStock(role) ? `Phiếu xin xuất${pending ? ` (${pending})` : ""}` : "Xin xuất hàng" },
    { href: "/quan-ly/kho/lich-su", key: "ls", label: "Lịch sử" },
    ...(canManageStock(role) ? [{ href: "/quan-ly/kho/san-pham", key: "sp", label: "Sản phẩm" }] : []),
  ];
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          className={`rounded-lg px-3 py-1.5 font-medium ${i.key === active ? "bg-beige text-navy" : "text-navy/70 hover:bg-beige/60"}`}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}

/** Chi nhánh được xem: chủ / quản lý chọn tự do, nhân viên khác cố định chi nhánh của mình */
export function pickBranch(
  profile: Pick<Profile, "role" | "branch_id"> | null,
  branches: { id: string; name: string }[],
  wanted?: string,
): { branchId: string; canSwitch: boolean } {
  const canSwitch = profile?.role === "owner" || profile?.role === "manager" || !profile?.branch_id;
  const branchId = canSwitch
    ? branches.find((b) => b.id === wanted)?.id ?? profile?.branch_id ?? branches[0]?.id ?? ""
    : profile!.branch_id!;
  return { branchId, canSwitch };
}
