import Link from "next/link";
import { createClient, getCurrentUser, isStaffRole } from "@/lib/supabase/server";
import CheckInBar from "@/components/CheckInBar";
import PushToggle from "@/components/PushToggle";
import StaffNav from "@/components/StaffNav";
import KtvNav from "@/components/KtvNav";
import { todayVn } from "@/lib/format";
import { buildNav } from "@/lib/nav";
import { loadNavCounts } from "@/lib/navCounts";

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
  // KTV dùng giao diện app riêng: 5 tab dưới đáy, chấm công nằm ở màn Hôm nay
  if (role === "technician") {
    return (
      <div className="space-y-4 pb-24">
        <KtvNav />
        {children}
      </div>
    );
  }
  const supabase = await createClient();
  const [counts, { data: cfg }, { data: attendance }] = await Promise.all([
    loadNavCounts(role, profile!.branch_id),
    supabase.from("app_settings").select("value").eq("key", "payroll").maybeSingle(),
    role !== "owner"
      ? supabase
          .from("staff_attendance")
          .select("check_in, check_out, approval_status, approval_reason")
          .eq("staff_id", profile!.id)
          .eq("work_date", todayVn())
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const otStart = (cfg?.value as { ot_start?: string } | null)?.ot_start ?? "18:30";
  const groups = buildNav(role, counts);
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

  return (
    <div className="space-y-4 pb-20 sm:pb-0">
      {role !== "owner" && <CheckInBar today={attendance} otStart={otStart} />}
      {role === "owner" && vapidKey && <PushToggle publicKey={vapidKey} hideWhenOn />}
      <StaffNav groups={groups} />
      {children}
    </div>
  );
}
