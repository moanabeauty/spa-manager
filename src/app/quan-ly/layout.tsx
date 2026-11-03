import Link from "next/link";
import { getCurrentUser, isStaffRole } from "@/lib/supabase/server";
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
  const tabs = [
    { href: "/quan-ly", label: "Lịch hẹn" },
    { href: "/quan-ly/tao-lich", label: "+ Tạo lịch" },
    { href: "/quan-ly/khach-hang", label: "Khách hàng" },
    ...(role !== "technician" ? [{ href: "/quan-ly/hoa-don", label: "Hoá đơn" }] : []),
    { href: "/quan-ly/doanh-so", label: role === "owner" || role === "manager" ? "Doanh số" : "Doanh số của tôi" },
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
