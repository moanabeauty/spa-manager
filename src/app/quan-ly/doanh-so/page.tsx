import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatVnd, todayVn } from "@/lib/format";

export const metadata = { title: "Doanh số & hoa hồng – Moana Beauty" };

type Comm = { staff_id: string; full_name: string | null; sales_amount: number; rate: number; commission_amount: number };
type Fee = { technician_id: string; full_name: string | null; services_done: number; fee_amount: number };

function shiftMonth(m: string, d: number) {
  const [y, mo] = m.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + d, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ thang?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  const sp = await searchParams;
  const month = sp.thang && /^\d{4}-\d{2}$/.test(sp.thang) ? sp.thang : todayVn().slice(0, 7);
  const all = profile?.role === "owner" || profile?.role === "manager";

  let cq = supabase.from("staff_monthly_commissions").select("staff_id, full_name, sales_amount, rate, commission_amount").eq("month", `${month}-01`);
  let fq = supabase.from("technician_monthly_fees").select("technician_id, full_name, services_done, fee_amount").eq("month", `${month}-01`);
  if (!all) {
    cq = cq.eq("staff_id", profile!.id);
    fq = fq.eq("technician_id", profile!.id);
  }
  const [{ data: comm }, { data: fees }, { data: tiers }, { data: slip }] = await Promise.all([
    cq,
    fq,
    supabase.from("commission_tiers").select("min_monthly_sales, rate").order("min_monthly_sales"),
    profile?.role === "owner" ? Promise.resolve({ data: null }) : supabase.rpc("my_payslip", { p_month: `${month}-01` }),
  ]);
  const p = (slip ?? null) as Record<string, number | string | null> | null;
  const num = (k: string) => Number(p?.[k] ?? 0);

  const rows = new Map<string, { name: string; sales: number; rate: number; commission: number; done: number; fee: number }>();
  ((comm ?? []) as Comm[]).forEach((c) =>
    rows.set(c.staff_id, { name: c.full_name ?? "?", sales: Number(c.sales_amount), rate: Number(c.rate), commission: Number(c.commission_amount), done: 0, fee: 0 }),
  );
  ((fees ?? []) as Fee[]).forEach((f) => {
    const r = rows.get(f.technician_id) ?? { name: f.full_name ?? "?", sales: 0, rate: 0, commission: 0, done: 0, fee: 0 };
    r.done = Number(f.services_done);
    r.fee = Number(f.fee_amount);
    rows.set(f.technician_id, r);
  });
  const list = [...rows.values()].sort((a, b) => b.sales - a.sales);
  const [y, m] = month.split("-");
  const tl = (tiers ?? []) as { min_monthly_sales: number; rate: number }[];
  const pct = (r: number) => `${Math.round(Number(r) * 1000) / 10}%`;
  const tierText = tl
    .map((t, i) =>
      Number(t.min_monthly_sales) === 0 && tl[i + 1]
        ? `${pct(t.rate)} khi dưới ${formatVnd(Number(tl[i + 1].min_monthly_sales))}`
        : `${pct(t.rate)} từ ${formatVnd(Number(t.min_monthly_sales))}`,
    )
    .join(", ");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">{all ? "Doanh số & hoa hồng" : "Doanh số của tôi"}</h1>
        <p className="text-sm text-ink/70">Tháng {m}/{y}</p>
      </div>
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <Link href={`/quan-ly/doanh-so?thang=${shiftMonth(month, -1)}`} className="btn-ghost">‹ Tháng trước</Link>
        <Link href={`/quan-ly/doanh-so?thang=${shiftMonth(month, 1)}`} className="btn-ghost">Tháng sau ›</Link>
        <Link href="/quan-ly/doanh-so" className="btn-ghost">Tháng này</Link>
      </div>

      {list.length === 0 && <p className="card text-sm text-ink/60">Chưa có doanh số trong tháng này.</p>}
      {list.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-cream text-left text-xs text-ink/60">
              <tr>
                <th className="px-3 py-2">Nhân viên</th>
                <th className="px-3 py-2 text-right">Doanh số</th>
                <th className="px-3 py-2 text-right">Hoa hồng</th>
                <th className="px-3 py-2 text-right">Tiền DV KTV</th>
                <th className="px-3 py-2 text-right">Tổng</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => (
                <tr key={i} className="border-t border-beige">
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2 text-right">{formatVnd(r.sales)}</td>
                  <td className="px-3 py-2 text-right">
                    {formatVnd(r.commission)}
                    {r.rate > 0 && <span className="block text-xs text-ink/50">{Math.round(r.rate * 1000) / 10}%</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {formatVnd(r.fee)}
                    {r.done > 0 && <span className="block text-xs text-ink/50">{r.done} lượt</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-bold text-navy">{formatVnd(r.commission + r.fee)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {p && (num("base_salary") > 0 || num("work_hours") > 0) && (
        <div className="card p-4 text-sm">
          <p className="mb-2 font-semibold text-navy">Phiếu lương tạm tính của tôi</p>
          {[
            ["Lương cơ bản", num("base_pay"), `${num("work_hours")}/${num("standard_hours")} giờ`],
            ["Lương trách nhiệm", num("responsibility_pay"), ""],
            ["Phụ cấp ăn", num("meal_allowance"), `${num("work_days")} ngày`],
            ["Làm thêm giờ", num("overtime_pay"), num("overtime_hours") ? `${num("overtime_hours")} giờ` : ""],
            ["Hoa hồng", num("commission"), ""],
            ["Tiền dịch vụ", num("service_fee"), ""],
            ["Cộng khác", num("other_allowance"), ""],
            ["Phạt nội quy", -num("penalties"), num("penalty_count") ? `${num("penalty_count")} lần` : ""],
            ["Nghỉ không phép", -num("absence_deduction"), num("absences") ? `${num("absences")} ngày` : ""],
            ["BHXH, BHYT, BHTN", -num("insurance_employee"), ""],
            ["Trừ khác", -num("other_deduction"), ""],
          ]
            .filter(([, v]) => v !== 0)
            .map(([label, v, note]) => (
              <div key={label as string} className="flex justify-between py-0.5">
                <span>{label} {note && <span className="text-xs text-ink/50">({note})</span>}</span>
                <span className={(v as number) < 0 ? "text-[#8A2323]" : ""}>{formatVnd(v as number)}</span>
              </div>
            ))}
          <div className="mt-1 flex justify-between border-t border-beige pt-1 text-base font-bold text-navy">
            <span>Thực nhận</span><span>{formatVnd(num("net_pay"))}</span>
          </div>
          <p className="mt-1 text-xs text-ink/50">Số tạm tính theo chấm công hiện tại, chủ spa chốt khi trả lương.</p>
        </div>
      )}
      <p className="text-xs text-ink/60">
        Hoa hồng tính trên doanh số cả tháng ({tierText}). Không tính: gội đầu, dòng trả bằng thẻ tài khoản (đã tính lúc nạp), buổi trừ
        gói. Tiền DV KTV tính theo lịch hẹn đã hoàn thành. Hoá đơn đã huỷ không tính.
      </p>
    </div>
  );
}
