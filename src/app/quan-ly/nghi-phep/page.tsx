import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { todayVn } from "@/lib/format";
import { isMonth, monthEnd, shiftMonth, shortLabel } from "@/lib/reports";
import LeaveTools, { type Leave } from "./LeaveTools";

export const metadata = { title: "Nghỉ phép – Moana Beauty" };

export default async function LeavePage({ searchParams }: { searchParams: Promise<{ thang?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  if (!profile) return null;
  const sp = await searchParams;
  const month = isMonth(sp.thang) ? sp.thang : todayVn().slice(0, 7);
  const manage = profile.role === "owner" || profile.role === "manager";

  const [{ data: leaves }, { data: pending }, { data: staff }] = await Promise.all([
    supabase
      .from("staff_leaves")
      .select("id, staff_id, leave_date, kind, half_day, reason, status, review_note, created_at")
      .gte("leave_date", `${month}-01`)
      .lte("leave_date", monthEnd(month))
      .in("status", ["pending", "approved", "rejected"])
      .order("leave_date", { ascending: false }),
    manage
      ? supabase
          .from("staff_leaves")
          .select("id, staff_id, leave_date, kind, half_day, reason, status, review_note, created_at")
          .eq("status", "pending")
          .order("leave_date")
      : Promise.resolve({ data: [] }),
    supabase
      .from("profiles")
      .select("id, full_name, role")
      .in("role", ["manager", "receptionist", "technician", "warehouse"])
      .eq("is_active", true)
      .order("full_name"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Nghỉ phép</h1>
        <p className="text-sm text-ink/70">
          {manage ? "Duyệt đơn nghỉ của nhân viên, ghi nghỉ không phép." : "Đăng ký nghỉ trước để quản lý xếp lịch và duyệt."}
        </p>
      </div>
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <span className="text-sm font-semibold text-navy">Tháng {shortLabel(month)}</span>
        <Link href={`/quan-ly/nghi-phep?thang=${shiftMonth(month, -1)}`} className="btn-ghost">‹ Trước</Link>
        <Link href={`/quan-ly/nghi-phep?thang=${shiftMonth(month, 1)}`} className="btn-ghost">Sau ›</Link>
        <Link href="/quan-ly/nghi-phep" className="btn-ghost">Tháng này</Link>
      </div>
      <LeaveTools
        key={month}
        me={profile.id}
        manage={manage}
        month={month}
        leaves={(leaves ?? []) as Leave[]}
        pending={(pending ?? []) as Leave[]}
        staff={(staff ?? []) as { id: string; full_name: string | null; role: string }[]}
      />
    </div>
  );
}
