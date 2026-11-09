import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { todayVn } from "@/lib/format";
import { isMonth, shiftMonth, shortLabel } from "@/lib/reports";
import PayrollEditor, {
  type AttDay, type AttSum, type Branch, type Holiday, type Entry, type PaySetting, type Penalty, type PayrollRow, type PayrollConfig,
  type PayrollMode, type Staff,
} from "./PayrollEditor";

const TITLE: Record<PayrollMode, string> = {
  luong: "Bảng lương",
  "cham-cong": "Chấm công",
  "muc-luong": "Lương nhân viên",
  "ngay-lam-viec": "Ngày làm việc & ngày lễ",
};
const PATH: Record<PayrollMode, string> = {
  luong: "/quan-ly/bang-luong",
  "cham-cong": "/quan-ly/cham-cong",
  "muc-luong": "/quan-ly/cai-dat/luong",
  "ngay-lam-viec": "/quan-ly/cai-dat/ngay-lam-viec",
};

/** Dùng chung cho Bảng lương, Chấm công và 2 trang cài đặt lương / ngày làm việc */
export default async function PayrollScreen({ mode, thang }: { mode: PayrollMode; thang?: string }) {
  const { supabase, profile } = await getCurrentUser();
  const role = profile?.role;
  const ownerOnly = mode !== "cham-cong";
  if (ownerOnly ? role !== "owner" : role !== "owner" && role !== "manager")
    return <p className="card text-sm">Trang dành cho {ownerOnly ? "chủ spa" : "chủ spa / quản lý"}.</p>;
  const isOwner = role === "owner";
  const monthly = mode === "luong" || mode === "cham-cong";
  const month = isMonth(thang) ? thang : todayVn().slice(0, 7);
  const m1 = `${month}-01`;
  const next = `${shiftMonth(month, 1)}-01`;

  const [{ data: staff }, { data: branches }, { data: entries }, { data: penalties }, { data: attSum }, { data: attDays }, { data: cfgRow }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, role, branch_id, is_active")
      .in("role", ["owner", "manager", "receptionist", "technician", "warehouse", "marketing"])
      .order("full_name"),
    supabase.from("branches").select("id, name, latitude, longitude").order("name"),
    supabase.from("payroll_entries").select("staff_id, work_days, overtime_hours, other_allowance, other_deduction, note").eq("month", m1),
    supabase
      .from("staff_penalties")
      .select("id, staff_id, penalty_date, amount, reason")
      .gte("penalty_date", m1)
      .lt("penalty_date", next)
      .order("penalty_date", { ascending: false }),
    monthly ? supabase.rpc("attendance_month", { p_month: m1 }) : Promise.resolve({ data: [] }),
    monthly ? supabase.rpc("attendance_report", { p_month: m1 }) : Promise.resolve({ data: [] }),
    supabase.from("app_settings").select("value").eq("key", "payroll").maybeSingle(),
  ]);
  const { data: holidays } = await supabase
    .from("public_holidays")
    .select("holiday_date, name, applies_to_all, holiday_assignments(staff_id)")
    .order("holiday_date", { ascending: false })
    .limit(60);

  let rows: PayrollRow[] = [];
  let settings: PaySetting[] = [];
  const config: PayrollConfig | null = (cfgRow?.value ?? null) as PayrollConfig | null;
  let posted = false;
  if (isOwner && (mode === "luong" || mode === "muc-luong")) {
    const [{ data: sheet }, { data: ps }, { count }] = await Promise.all([
      mode === "luong" ? supabase.rpc("payroll_sheet", { p_month: m1 }) : Promise.resolve({ data: [] }),
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
        <h1 className="text-2xl font-bold text-navy">
          {TITLE[mode]}
          {monthly && ` tháng ${shortLabel(month)}`}
        </h1>
        <p className="text-sm text-ink/70">
          {mode === "luong" && "Lương cơ bản theo ngày công + trách nhiệm + phụ cấp ăn + thêm giờ + hoa hồng + tiền dịch vụ − phạt − BHXH"}
          {mode === "cham-cong" && "Ngày công lấy từ check-in / check-out của nhân viên; quản lý kiểm tra, duyệt, sửa và nhập phạt nội quy."}
          {mode === "muc-luong" && "Mức lương từng người và cách tính lương chung (phụ cấp ăn, tăng ca, BHXH)."}
          {mode === "ngay-lam-viec" && "Giờ vào / hết ca, tính tăng ca, vị trí chi nhánh để check-in và ngày lễ được nghỉ."}
        </p>
      </div>
      {monthly && (
        <div className="card flex flex-wrap items-center gap-2 p-3 print:hidden">
          <Link href={`${PATH[mode]}?thang=${shiftMonth(month, -1)}`} className="btn-ghost">‹ Tháng trước</Link>
          <Link href={`${PATH[mode]}?thang=${shiftMonth(month, 1)}`} className="btn-ghost">Tháng sau ›</Link>
          <Link href={PATH[mode]} className="btn-ghost">Tháng này</Link>
        </div>
      )}
      <PayrollEditor
        key={`${mode}-${month}`}
        mode={mode}
        month={month}
        isOwner={isOwner}
        staff={(staff ?? []) as Staff[]}
        branches={(branches ?? []) as Branch[]}
        entries={(entries ?? []) as Entry[]}
        penalties={(penalties ?? []) as Penalty[]}
        rows={rows}
        settings={settings}
        config={config}
        posted={posted}
        attSum={(attSum ?? []) as AttSum[]}
        attDays={(attDays ?? []) as AttDay[]}
        holidays={(holidays ?? []) as Holiday[]}
      />
    </div>
  );
}
