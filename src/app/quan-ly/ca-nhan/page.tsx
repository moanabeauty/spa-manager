import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatShortDate, formatTime, formatVnd, todayVn } from "@/lib/format";
import { monthEnd } from "@/lib/reports";
import AttendanceFixForm from "./AttendanceFixForm";

export const metadata = { title: "Của tôi – Moana Beauty" };

type Att = { work_date: string; check_in: string; check_out: string | null; approval_status: string | null; ot_status: string | null; ot_hours_approved: number | null; in_status: string | null };

/** Màn Cá nhân của KTV (và mục "Của tôi" của quản lý, lễ tân, marketing): lương tạm tính, công, nghỉ còn, tăng ca, doanh số, yêu cầu chờ duyệt */
export default async function PersonalPage() {
  const { supabase, profile } = await getCurrentUser();
  if (!profile) return null;
  const month = todayVn().slice(0, 7);
  const from = `${month}-01`;
  const to = monthEnd(month);

  const [slipR, commR, feeR, cfgR, leavesR, attR, fixR, chgR, vouR, discR] = await Promise.all([
    profile.role === "owner" ? Promise.resolve({ data: null }) : supabase.rpc("my_payslip", { p_month: from }),
    supabase.from("staff_monthly_commissions").select("sales_amount, rate, commission_amount").eq("month", from).eq("staff_id", profile.id).maybeSingle(),
    supabase.from("technician_monthly_fees").select("services_done, fee_amount").eq("month", from).eq("technician_id", profile.id).maybeSingle(),
    supabase.from("app_settings").select("value").eq("key", "payroll").maybeSingle(),
    supabase.from("staff_leaves").select("leave_date, half_day, status, kind").eq("staff_id", profile.id).gte("leave_date", from).lte("leave_date", to).in("status", ["pending", "approved"]),
    supabase.from("staff_attendance").select("work_date, check_in, check_out, approval_status, ot_status, ot_hours_approved, in_status").eq("staff_id", profile.id).gte("work_date", from).lte("work_date", to).order("work_date", { ascending: false }),
    supabase.from("attendance_fix_requests").select("id, work_date, reason").eq("staff_id", profile.id).eq("status", "pending"),
    supabase.from("procedure_change_requests").select("id, to_product, reason").eq("requested_by", profile.id).eq("status", "pending"),
    supabase.from("cashbook_entries").select("id, amount, description").eq("created_by", profile.id).eq("status", "pending"),
    supabase.from("discount_requests").select("id, amount, kind").eq("requested_by", profile.id).eq("status", "pending"),
  ]);
  const p = (slipR.data ?? null) as Record<string, number | string | null> | null;
  const num = (k: string) => Number(p?.[k] ?? 0);
  const comm = commR.data as { sales_amount: number; rate: number; commission_amount: number } | null;
  const fee = feeR.data as { services_done: number; fee_amount: number } | null;
  const std = Number((cfgR.data?.value as { standard_days?: number } | null)?.standard_days ?? 27);
  const quota = Math.max(0, Number(to.slice(8, 10)) - std);
  const leaves = (leavesR.data ?? []) as { half_day: boolean; status: string; kind: string }[];
  const usedLeave = leaves.filter((l) => l.kind !== "unexcused").reduce((a, l) => a + (l.half_day ? 0.5 : 1), 0);
  const att = (attR.data ?? []) as Att[];
  const otApproved = att.reduce((a, r) => a + Number(r.ot_hours_approved ?? 0), 0);
  const otPending = att.filter((r) => r.ot_status === "pending").length;

  type Req = { key: string; text: string };
  const reqs: Req[] = [
    ...leaves.filter((l) => l.status === "pending").map((_, i) => ({ key: `l${i}`, text: "Đơn nghỉ phép" })),
    ...((fixR.data ?? []) as { id: string; work_date: string; reason: string }[]).map((r) => ({ key: r.id, text: `Sửa công ngày ${formatShortDate(r.work_date)}: ${r.reason}` })),
    ...((chgR.data ?? []) as { id: string; to_product: string; reason: string }[]).map((r) => ({ key: r.id, text: `Đổi sản phẩm sang ${r.to_product}` })),
    ...((vouR.data ?? []) as { id: string; amount: number; description: string | null }[]).map((r) => ({ key: r.id, text: `Thu chi tiền mặt ${formatVnd(Number(r.amount))}${r.description ? ` · ${r.description}` : ""}` })),
    ...((discR.data ?? []) as { id: string; amount: number; kind: string }[]).map((r) => ({ key: r.id, text: `${r.kind === "debt" ? "Cho nợ" : "Giảm giá"} ${formatVnd(Number(r.amount))}` })),
    ...att.filter((r) => r.in_status === "pending").map((r) => ({ key: `in${r.work_date}`, text: `Chấm vào sớm ngày ${formatShortDate(r.work_date)}` })),
    ...att.filter((r) => r.ot_status === "pending").map((r) => ({ key: `ot${r.work_date}`, text: `Tăng ca ngày ${formatShortDate(r.work_date)}` })),
    ...att.filter((r) => r.approval_status === "pending").map((r) => ({ key: `ap${r.work_date}`, text: `Ngày công ${formatShortDate(r.work_date)}` })),
  ];
  const row = "flex min-h-12 items-center justify-between border-b border-[#EFECE6] text-sm last:border-0";
  const [y, m] = month.split("-");
  const isKtv = profile.roles.includes("technician");

  return (
    <div className="-mx-4 -mt-6 space-y-3 pb-4">
      <div className="space-y-2.5 bg-navy px-5 pb-5 pt-5 text-white">
        <p className="text-[13px] text-beige-dark">Tháng {m}/{y} · tính đến hôm nay</p>
        <div>
          <p className="text-[13px] text-[#C9CADB]">Tổng lương tạm tính</p>
          <p className="text-[32px] font-bold leading-tight">{p ? formatVnd(num("net_pay")) : "—"}</p>
        </div>
        <p className="text-xs text-[#C9CADB]">Gồm lương cơ bản theo công, phụ cấp, hoa hồng, phí dịch vụ, tăng ca; đã trừ phạt và BHXH.</p>
      </div>

      <div className="space-y-3 px-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-[14px] bg-white p-3">
            <p className="text-xs text-[#646464]">Công</p>
            <p className="text-lg font-bold">{p ? `${num("work_days")} / ${std}` : `${att.length} / ${std}`}</p>
          </div>
          <div className="rounded-[14px] bg-white p-3">
            <p className="text-xs text-[#646464]">Nghỉ còn</p>
            <p className="text-lg font-bold">{Math.max(0, quota - usedLeave)} ngày</p>
          </div>
          <div className="rounded-[14px] bg-white p-3">
            <p className="text-xs text-[#646464]">Tăng ca</p>
            <p className="text-lg font-bold">{(p ? num("overtime_hours") : otApproved).toLocaleString("vi-VN")} giờ</p>
            {otPending > 0 && <p className="text-[11px] text-[#7A5600]">{otPending} ngày chờ duyệt</p>}
          </div>
        </div>

        <div className="space-y-2 rounded-[14px] bg-white p-3.5">
          <p className="text-[15px] font-bold">Doanh số của tôi</p>
          <div className="flex justify-between text-[13px]"><span>Doanh số bán (đã trừ hoàn)</span><b>{formatVnd(Number(comm?.sales_amount ?? 0))}</b></div>
          <div className="flex justify-between text-[13px]">
            <span>Hoa hồng{comm?.rate ? ` (${Math.round(Number(comm.rate) * 1000) / 10}%)` : " (3% / 5%)"}</span>
            <b>{formatVnd(Number(comm?.commission_amount ?? 0))}</b>
          </div>
          {isKtv && <div className="flex justify-between text-[13px]"><span>Phí dịch vụ · {Number(fee?.services_done ?? 0)} lượt</span><b>{formatVnd(Number(fee?.fee_amount ?? 0))}</b></div>}
          <div className="flex gap-4">
            <Link href="/quan-ly/hoa-don" className="flex min-h-8 items-center text-[13px] font-semibold text-navy">Hoá đơn tôi đã bán ›</Link>
            <Link href="/quan-ly/doanh-so" className="flex min-h-8 items-center text-[13px] font-semibold text-navy">Phiếu lương chi tiết ›</Link>
          </div>
        </div>

        <div className="rounded-[14px] bg-white px-3.5 py-1.5">
          <details className="border-b border-[#EFECE6]">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-sm">
              Bảng công chi tiết<span className="text-[#646464]">›</span>
            </summary>
            <ul className="pb-2 text-[13px]">
              {att.length === 0 && <li className="text-[#646464]">Tháng này chưa có ngày công.</li>}
              {att.map((r) => (
                <li key={r.work_date} className="flex justify-between py-1">
                  <span>{formatShortDate(r.work_date)}</span>
                  <span className="text-[#646464]">
                    {formatTime(r.check_in)} – {r.check_out ? formatTime(r.check_out) : "chưa ra"}
                    {r.approval_status === "pending" ? " · chờ duyệt" : r.approval_status === "rejected" ? " · không duyệt" : ""}
                    {Number(r.ot_hours_approved ?? 0) > 0 ? ` · TC ${r.ot_hours_approved}h` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </details>
          <Link href="/quan-ly/nghi-phep" className={row}>Đăng ký nghỉ<span className="text-[#646464]">›</span></Link>
          {isKtv && <Link href="/quan-ly/ngoai-gio?kieu=ra" className={row}>Xin tăng ca (chấm ra sau 18:30)<span className="text-[#646464]">›</span></Link>}
          <AttendanceFixForm />
          <Link href="/quan-ly/phieu-thu-chi" className={row}>Thu chi tiền mặt tại spa<span className="text-[#646464]">›</span></Link>
          <details>
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-sm">
              Yêu cầu của tôi
              {reqs.length > 0 ? (
                <span className="rounded-full bg-beige px-2 py-0.5 text-xs font-semibold text-[#5E4B30]">{reqs.length} chờ duyệt</span>
              ) : (
                <span className="text-xs text-[#646464]">không có</span>
              )}
            </summary>
            <ul className="space-y-1 pb-2 text-[13px]">
              {reqs.map((r) => (
                <li key={r.key} className="rounded-lg bg-cream px-2.5 py-1.5">⏳ {r.text}</li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    </div>
  );
}
