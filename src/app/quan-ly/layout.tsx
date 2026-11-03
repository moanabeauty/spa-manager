import Link from "next/link";
import { createClient, getCurrentUser, isStaffRole } from "@/lib/supabase/server";
import ManagerTabs from "./ManagerTabs";

export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await getCurrentUser();
  if (!user) {
    return (
      <div className="card text-sm">
        Vui lòng <Link href="/dang-nhap?next=/quan-ly" className="font-semibold text-navy underline">đăng nhập</Link>.
      </div>
    );
  }
  if (!isStaffRole(profile?.role)) {
    return (
      <div className="card">
        <h1 className="text-lg font-bold text-navy">Trang dành cho nhân viên</h1>
        <p className="mt-2 text-sm">Tài khoản của bạn chưa được cấp quyền nhân viên. Vui lòng nhờ chủ spa cấp quyền.</p>
      </div>
    );
  }
  const role = profile!.role;
  let pendingDiscounts = 0;
  if (role === "owner" || role === "manager") {
    const supabase = await createClient();
    const { count } = await supabase
      .from("discount_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    pendingDiscounts = count ?? 0;
  }
  let pendingStock = 0;
  if (role === "owner" || role === "manager" || role === "warehouse") {
    const supabase = await createClient();
    let q = supabase.from("stock_requests").select("id, warehouses!inner(branch_id)", { count: "exact", head: true }).eq("status", "pending");
    if (role === "warehouse" && profile!.branch_id) q = q.eq("warehouses.branch_id", profile!.branch_id);
    const { count } = await q;
    pendingStock = count ?? 0;
  }
  const kho = { href: "/quan-ly/kho", label: pendingStock ? `Kho (${pendingStock})` : "Kho" };
  const tabs =
    role === "warehouse"
      ? [kho]
      : [
          { href: "/quan-ly", label: "Lịch hẹn" },
          { href: "/quan-ly/tao-lich", label: "+ Tạo lịch" },
          { href: "/quan-ly/khach-hang", label: "Khách hàng" },
          { href: "/quan-ly/hoa-don", label: "Hoá đơn" },
          { href: "/quan-ly/doanh-so", label: role === "owner" || role === "manager" ? "Doanh số" : "Doanh số của tôi" },
          kho,
          ...(role === "owner" || role === "manager"
            ? [{ href: "/quan-ly/duyet-giam-gia", label: pendingDiscounts ? `Duyệt giảm giá (${pendingDiscounts})` : "Duyệt giảm giá" }]
            : []),
          ...(role === "owner" || role === "manager" ? [{ href: "/quan-ly/goi-combo", label: "Gói combo" }] : []),
          ...(role === "owner" || role === "manager" ? [{ href: "/quan-ly/dich-vu", label: "Menu dịch vụ" }] : []),
          ...(role === "owner" ? [{ href: "/quan-ly/nhan-vien", label: "Nhân viên" }] : []),
        ];
  return (
    <div className="space-y-4">
      <div className="print:hidden"><ManagerTabs tabs={tabs} /></div>
      {children}
    </div>
  );
}
