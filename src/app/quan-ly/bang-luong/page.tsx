import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { todayVn } from "@/lib/format";
import { isMonth, shiftMonth, shortLabel } from "@/lib/reports";
import ReportNav from "../bao-cao/ReportNav";
import PayrollEditor, { type AttDay, type AttSum, type Entry, type PaySetting, type Penalty, type PayrollRow, type PayrollConfig, type Staff } from "./PayrollEditor";

export const metadata = { title: "Bảng lương – Moana Beauty" };

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ thang?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  const role = profile?.role;
  if (role !== "owner" && role !== "manager") return <p className="card text-sm">Trang dành cho chủ spa / quản lý.</p>;
  const isOwner = role === "owner";
  const sp = await searchParams;
  const month = isMonth(sp.thang) ? sp.thang : todayVn().slice(0, 7);
  const m1 = `${month}-01`;
  const next = `${shiftMonth(month, 1)}-01`;

  const [{ data: staff }, { data: branches }, { data: entries }, { data: penalties }, { data: attSum }, { data: attDays }, { data: cfgRow }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, role, branch_id, is_active")
      .in("role", ["owner", "manager", "receptionist", "technician", "warehouse"])
      .order("full_name"),
    supabase.from("branches").select("id, name").order("name"),
    supabase.from("payroll_entries").select("staff_id, work_days, overtime_hours, other_allowance, other_deduction, note").eq("month", m1),
    supabase
      .from("staff_penalties")
      .select("id, staff_id, penalty_date, amount, reason")
      .gte("penalty_date", m1)
      .lt("penalty_date", next)
      .order("penalty_date", { ascending: false }),
    supabase.rpc("attendance_month", { p_month: m1 }),
    supabase.rpc("attendance_report", { p_month: m1 }),
    supabase.from("app_settings").select("value").eq("key", "payroll").maybeSingle(),
  ]);

  let rows: PayrollRow[] = [];
  let settings: PaySetting[] = [];
  const config: PayrollConfig | null = (cfgRow?.value ?? null) as PayrollConfig | null;
  let posted = false;
  if (isOwner) {
    const [{ data: sheet }, { data: ps }, { count }] = await Promise.all([
      supabase.rpc("payroll_sheet", { p_month: m1 }),
      supabase.from("staff_pay_settings").select("staff_id, base_salary, responsibility_pay, insurance_salary, meal_per_day, standard_days, on_payroll, note"),
      supabase.from("cashbook_entries").select("id", { count: "exact", head: true }).eq("source", "payroll").eq("source_month", m1),
    ]);
    rows = (sheet ?? []) as PayrollRow[];
    settings = (ps ?? []) as PaySetting[];
    posted = (count ?? 0) > 0;
  }

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <h1 className="text-2xl font-bold text-navy">{isOwner ? "Bảng lương" : "Chấm công"} tháng {shortLabel(month)}</h1>
        <p className="text-sm text-ink/70">
          {isOwner
            ? "Lương cơ bản theo ngày công + trách nhiệm + phụ cấp ăn + thêm giờ + hoa hồng + tiền dịch vụ − phạt − BHXH"
            : "Ngày công lấy từ check-in / check-out của nhân viên; quản lý kiểm tra, sửa và nhập phạt nội quy. Chủ spa xem bảng lương."}
        </p>
      </div>
      <ReportNav active="luong" isOwner={isOwner} />
      <div className="card flex flex-wrap items-center gap-2 p-3 print:hidden">
        <Link href={`/quan-ly/bang-luong?thang=${shiftMonth(month, -1)}`} className="btn-ghost">‹ Tháng trước</Link>
        <Link href={`/quan-ly/bang-luong?thang=${shiftMonth(month, 1)}`} className="btn-ghost">Tháng sau ›</Link>
        <Link href="/quan-ly/bang-luong" className="btn-ghost">Tháng này</Link>
      </div>
      <PayrollEditor
        key={month}
        month={month}
        isOwner={isOwner}
        staff={(staff ?? []) as Staff[]}
        branches={(branches ?? []) as { id: string; name: string }[]}
        entries={(entries ?? []) as Entry[]}
        penalties={(penalties ?? []) as Penalty[]}
        rows={rows}
        settings={settings}
        config={config}
        posted={posted}
        attSum={(attSum ?? []) as AttSum[]}
        attDays={(attDays ?? []) as AttDay[]}
      />
    </div>
  );
}
