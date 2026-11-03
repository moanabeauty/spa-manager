"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatVnd, ROLE_LABEL, todayVn, vnError } from "@/lib/format";
import { shortLabel } from "@/lib/reports";
import MoneyInput from "@/components/MoneyInput";

export type Staff = { id: string; full_name: string | null; role: string; branch_id: string | null; is_active: boolean };
export type Entry = { staff_id: string; work_days: number; overtime_hours: number; other_allowance: number; other_deduction: number; note: string | null };
export type Penalty = { id: string; staff_id: string; penalty_date: string; amount: number; reason: string };
export type PaySetting = {
  staff_id: string; base_salary: number; responsibility_pay: number; insurance_salary: number;
  meal_per_day: number | null; on_payroll: boolean; note: string | null;
};
export type PayrollConfig = {
  standard_days: number; hours_per_day: number; overtime_rate: number; meal_per_day: number;
  bhxh_employee_pct: number; bhxh_employer_pct: number;
};
export type PayrollRow = {
  staff_id: string; full_name: string | null; role: string; branch_id: string | null; has_entry: boolean;
  base_salary: number; standard_days: number; work_days: number; base_pay: number; responsibility_pay: number;
  meal_allowance: number; overtime_hours: number; overtime_pay: number; sales_amount: number; commission_rate: number;
  commission: number; services_done: number; service_fee: number; other_allowance: number; gross_pay: number;
  penalties: number; penalty_count: number; insurance_salary: number; insurance_employee: number; other_deduction: number;
  net_pay: number; insurance_employer: number; note: string | null;
};

type Tab = "cham-cong" | "phat" | "luong" | "muc-luong" | "cai-dat";
const n = (v: unknown) => Number(v ?? 0);

export default function PayrollEditor(props: {
  month: string; isOwner: boolean; staff: Staff[]; branches: { id: string; name: string }[];
  entries: Entry[]; penalties: Penalty[]; rows: PayrollRow[]; settings: PaySetting[]; config: PayrollConfig | null; posted: boolean;
}) {
  const { month, isOwner } = props;
  const [tab, setTab] = useState<Tab>(isOwner ? "luong" : "cham-cong");
  const tabs: { key: Tab; label: string }[] = [
    ...(isOwner ? [{ key: "luong" as Tab, label: "Bảng lương" }] : []),
    { key: "cham-cong", label: "Chấm công" },
    { key: "phat", label: `Phạt nội quy${props.penalties.length ? ` (${props.penalties.length})` : ""}` },
    ...(isOwner ? [{ key: "muc-luong" as Tab, label: "Mức lương" }, { key: "cai-dat" as Tab, label: "Cài đặt" }] : []),
  ];
  const branchName = (id: string | null) => props.branches.find((b) => b.id === id)?.name.replace("Moana ", "") ?? "";
  const settingIds = new Set(props.settings.map((s) => s.staff_id));
  const entryIds = new Set(props.entries.map((e) => e.staff_id));
  const people = props.staff.filter(
    (s) => (s.is_active && s.role !== "owner") || entryIds.has(s.id) || settingIds.has(s.id),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 print:hidden">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${tab === t.key ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "luong" && isOwner && <Sheet {...props} branchName={branchName} />}
      {tab === "cham-cong" && <Attendance month={month} people={people} entries={props.entries} branchName={branchName} />}
      {tab === "phat" && <Penalties month={month} people={people} penalties={props.penalties} />}
      {tab === "muc-luong" && isOwner && <Salaries people={people} allStaff={props.staff} settings={props.settings} config={props.config} branchName={branchName} />}
      {tab === "cai-dat" && isOwner && props.config && <Settings config={props.config} />}
    </div>
  );
}

// ============ BẢNG LƯƠNG ============
function Sheet({ month, rows, posted, config, branchName }: {
  month: string; rows: PayrollRow[]; posted: boolean; config: PayrollConfig | null; branchName: (id: string | null) => string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const sum = (k: keyof PayrollRow) => rows.reduce((a, r) => a + n(r[k]), 0);
  const missing = rows.filter((r) => !r.has_entry && r.role !== "owner");
  const noSalary = rows.filter((r) => !n(r.base_salary) && r.role !== "owner");

  async function post() {
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().rpc("post_payroll_to_cashbook", { p_month: `${month}-01` });
    setBusy(false);
    if (error) return setMsg(vnError(error.message));
    setMsg("Đã ghi vào sổ chi.");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Box label="Tổng thực nhận" value={sum("net_pay")} strong />
        <Box label="BHXH trừ lương NV" value={sum("insurance_employee")} />
        <Box label="BHXH Moana đóng cho NV" value={sum("insurance_employer")} />
        <Box label="Tổng chi phí lương" value={sum("net_pay") + sum("insurance_employee") + sum("insurance_employer")} hint="thực nhận + BHXH 2 phần" strong />
      </div>
      {(missing.length > 0 || noSalary.length > 0) && (
        <div className="card border-l-4 border-l-[#E0A526] p-3 text-sm print:hidden">
          {missing.length > 0 && <p>Chưa chấm công: {missing.map((r) => r.full_name).join(", ")}.</p>}
          {noSalary.length > 0 && <p>Chưa nhập lương cơ bản: {noSalary.map((r) => r.full_name).join(", ")} (mục “Mức lương”).</p>}
        </div>
      )}
      {rows.length === 0 && <p className="card text-sm text-ink/60">Chưa có nhân viên.</p>}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-cream text-left text-xs text-ink/60">
            <tr>
              <th className="px-3 py-2">Nhân viên</th>
              <th className="px-2 py-2 text-right">Công</th>
              <th className="px-2 py-2 text-right">Lương + phụ cấp</th>
              <th className="px-2 py-2 text-right">Hoa hồng + tiền DV</th>
              <th className="px-2 py-2 text-right">Giảm trừ</th>
              <th className="px-3 py-2 text-right">Thực nhận</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const fixed = n(r.base_pay) + n(r.responsibility_pay) + n(r.meal_allowance) + n(r.overtime_pay) + n(r.other_allowance);
              const perf = n(r.commission) + n(r.service_fee);
              const ded = n(r.penalties) + n(r.insurance_employee) + n(r.other_deduction);
              const isOpen = open === r.staff_id;
              return (
                <Fragment key={r.staff_id}>
                  <tr className="cursor-pointer border-t border-beige hover:bg-cream/60" onClick={() => setOpen(isOpen ? null : r.staff_id)}>
                    <td className="px-3 py-2">
                      <span className="font-medium">{r.full_name ?? "?"}</span>
                      <span className="block text-xs text-ink/50">
                        {ROLE_LABEL[r.role]} {branchName(r.branch_id) && `· ${branchName(r.branch_id)}`} {isOpen ? "▲" : "▼"}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right">
                      {n(r.work_days)}
                      {n(r.overtime_hours) > 0 && <span className="block text-xs text-ink/50">+{n(r.overtime_hours)}h</span>}
                    </td>
                    <td className="px-2 py-2 text-right">{formatVnd(fixed)}</td>
                    <td className="px-2 py-2 text-right">{formatVnd(perf)}</td>
                    <td className="px-2 py-2 text-right text-[#8A2323]">{ded ? `−${formatVnd(ded)}` : "–"}</td>
                    <td className="px-3 py-2 text-right font-bold text-navy">{formatVnd(n(r.net_pay))}</td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-cream/50">
                      <td colSpan={6} className="px-3 pb-3">
                        <Payslip r={r} config={config} month={month} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {rows.length > 0 && (
              <tr className="border-t border-beige-dark bg-cream font-bold text-navy">
                <td className="px-3 py-2">Tổng ({rows.length} người)</td>
                <td />
                <td className="px-2 py-2 text-right">
                  {formatVnd(sum("base_pay") + sum("responsibility_pay") + sum("meal_allowance") + sum("overtime_pay") + sum("other_allowance"))}
                </td>
                <td className="px-2 py-2 text-right">{formatVnd(sum("commission") + sum("service_fee"))}</td>
                <td className="px-2 py-2 text-right">−{formatVnd(sum("penalties") + sum("insurance_employee") + sum("other_deduction"))}</td>
                <td className="px-3 py-2 text-right">{formatVnd(sum("net_pay"))}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button className="btn-primary" disabled={busy || !rows.length} onClick={post}>
          {posted ? "Cập nhật lại vào sổ chi" : "Ghi lương vào sổ chi"}
        </button>
        <button className="btn-outline" onClick={() => window.print()}>In bảng lương</button>
        {posted && <span className="text-xs text-[#22612A]">✓ Đã ghi sổ chi tháng {shortLabel(month)}</span>}
        {msg && <span className="text-sm">{msg}</span>}
      </div>
      <p className="text-xs text-ink/60 print:hidden">
        Bấm vào từng người để xem phiếu lương chi tiết. “Ghi lương vào sổ chi” tạo 2 khoản chi cuối tháng ở trang Thu chi: lương thực nhận
        và tiền BHXH nộp cơ quan bảo hiểm (phần trừ lương nhân viên + phần Moana đóng). Bấm lại sau khi sửa chấm công để cập nhật số mới.
      </p>
    </div>
  );
}

function Payslip({ r, config, month }: { r: PayrollRow; config: PayrollConfig | null; month: string }) {
  const line = (label: string, v: number, note?: string, minus?: boolean) => (
    <div className="flex justify-between gap-3 py-0.5">
      <span>
        {label}
        {note && <span className="block text-xs text-ink/50">{note}</span>}
      </span>
      <span className={minus ? "text-[#8A2323]" : ""}>{minus && v ? "−" : ""}{formatVnd(v)}</span>
    </div>
  );
  const hourly = config ? Math.round(n(r.base_salary) / n(config.standard_days) / n(config.hours_per_day)) : 0;
  return (
    <div className="grid gap-4 pt-2 text-sm sm:grid-cols-2">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase text-ink/50">Thu nhập tháng {shortLabel(month)}</p>
        {line("Lương cơ bản theo ngày công", n(r.base_pay), `${formatVnd(n(r.base_salary))} × ${n(r.work_days)}/${n(r.standard_days)} công`)}
        {line("Lương trách nhiệm", n(r.responsibility_pay))}
        {line("Phụ cấp ăn", n(r.meal_allowance), `${n(r.work_days)} công`)}
        {line("Làm thêm giờ", n(r.overtime_pay), n(r.overtime_hours) ? `${n(r.overtime_hours)} giờ × ${formatVnd(hourly)} × ${config?.overtime_rate ?? 1.5}` : undefined)}
        {line("Hoa hồng", n(r.commission), n(r.sales_amount) ? `doanh số ${formatVnd(n(r.sales_amount))} × ${Math.round(n(r.commission_rate) * 1000) / 10}%` : undefined)}
        {line("Tiền dịch vụ", n(r.service_fee), n(r.services_done) ? `${n(r.services_done)} lượt` : undefined)}
        {n(r.other_allowance) > 0 && line("Cộng khác", n(r.other_allowance))}
        <div className="mt-1 flex justify-between border-t border-beige pt-1 font-semibold">
          <span>Tổng thu nhập</span><span>{formatVnd(n(r.gross_pay))}</span>
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase text-ink/50">Giảm trừ</p>
        {line("Phạt theo nội quy", n(r.penalties), n(r.penalty_count) ? `${n(r.penalty_count)} lần` : undefined, true)}
        {line("BHXH, BHYT, BHTN (nhân viên đóng)", n(r.insurance_employee), n(r.insurance_salary) ? `${config?.bhxh_employee_pct ?? 10.5}% × lương đóng BH ${formatVnd(n(r.insurance_salary))}` : "không đóng BHXH", true)}
        {n(r.other_deduction) > 0 && line("Trừ khác", n(r.other_deduction), undefined, true)}
        <div className="mt-1 flex justify-between border-t border-beige pt-1 text-base font-bold text-navy">
          <span>Thực nhận</span><span>{formatVnd(n(r.net_pay))}</span>
        </div>
        {n(r.insurance_employer) > 0 && (
          <p className="mt-2 text-xs text-ink/60">
            Moana đóng thêm BHXH cho nhân viên: {formatVnd(n(r.insurance_employer))} ({config?.bhxh_employer_pct ?? 21.5}%, không trừ vào lương)
          </p>
        )}
        {r.note && <p className="mt-1 text-xs text-ink/60">Ghi chú: {r.note}</p>}
      </div>
    </div>
  );
}

// ============ CHẤM CÔNG ============
function Attendance({ month, people, entries, branchName }: {
  month: string; people: Staff[]; entries: Entry[]; branchName: (id: string | null) => string;
}) {
  const router = useRouter();
  const init = useMemo(() => {
    const m: Record<string, Entry> = {};
    people.forEach((p) => {
      const e = entries.find((x) => x.staff_id === p.id);
      m[p.id] = e
        ? { ...e, work_days: n(e.work_days), overtime_hours: n(e.overtime_hours), other_allowance: n(e.other_allowance), other_deduction: n(e.other_deduction) }
        : { staff_id: p.id, work_days: 0, overtime_hours: 0, other_allowance: 0, other_deduction: 0, note: null };
    });
    return m;
  }, [people, entries]);
  const [rows, setRows] = useState(init);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (id: string, patch: Partial<Entry>) => {
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
    setDirty((d) => new Set(d).add(id));
    setMsg(null);
  };

  async function save() {
    setBusy(true);
    setMsg(null);
    const payload = [...dirty].map((id) => ({ month: `${month}-01`, ...rows[id], note: rows[id].note?.trim() || null }));
    const { error } = await createClient().from("payroll_entries").upsert(payload, { onConflict: "month,staff_id" });
    setBusy(false);
    if (error) return setMsg(vnError(error.message));
    setDirty(new Set());
    setMsg("Đã lưu chấm công.");
    router.refresh();
  }

  const numInput = (id: string, k: "work_days" | "overtime_hours", step: string) => (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      max={k === "work_days" ? 31 : undefined}
      step={step}
      className="w-16 rounded-lg border border-beige-dark bg-white px-2 py-1.5 text-right text-sm"
      value={rows[id][k] || ""}
      placeholder="0"
      onChange={(e) => set(id, { [k]: Math.max(0, Number(e.target.value) || 0) } as Partial<Entry>)}
    />
  );

  return (
    <div className="space-y-3">
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-cream text-left text-xs text-ink/60">
            <tr>
              <th className="px-3 py-2">Nhân viên</th>
              <th className="px-2 py-2">Ngày công</th>
              <th className="px-2 py-2">Giờ thêm</th>
              <th className="px-2 py-2">Cộng khác</th>
              <th className="px-2 py-2">Trừ khác</th>
              <th className="px-3 py-2">Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className={`border-t border-beige ${dirty.has(p.id) ? "bg-[#FFF8E6]" : ""}`}>
                <td className="px-3 py-2">
                  <span className="font-medium">{p.full_name ?? "?"}</span>
                  <span className="block text-xs text-ink/50">{ROLE_LABEL[p.role]} {branchName(p.branch_id) && `· ${branchName(p.branch_id)}`}</span>
                </td>
                <td className="px-2 py-2">{numInput(p.id, "work_days", "0.5")}</td>
                <td className="px-2 py-2">{numInput(p.id, "overtime_hours", "0.5")}</td>
                <td className="px-2 py-2"><MoneyInput value={rows[p.id].other_allowance} onChange={(v) => set(p.id, { other_allowance: v })} className="w-24" ariaLabel="Cộng khác" /></td>
                <td className="px-2 py-2"><MoneyInput value={rows[p.id].other_deduction} onChange={(v) => set(p.id, { other_deduction: v })} className="w-24" ariaLabel="Trừ khác" /></td>
                <td className="px-3 py-2">
                  <input
                    className="w-36 rounded-lg border border-beige-dark bg-white px-2 py-1.5 text-sm"
                    value={rows[p.id].note ?? ""}
                    placeholder="thưởng lễ, tạm ứng…"
                    onChange={(e) => set(p.id, { note: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={busy || dirty.size === 0} onClick={save}>
          {busy ? "Đang lưu…" : `Lưu chấm công${dirty.size ? ` (${dirty.size} người)` : ""}`}
        </button>
        {msg && <span className="text-sm">{msg}</span>}
      </div>
      <p className="text-xs text-ink/60">
        Ngày công nhập được nửa ngày (vd 25,5). Giờ thêm được trả 150% đơn giá giờ của lương cơ bản. “Cộng khác” (thưởng, phụ cấp khác) và
        “Trừ khác” (tạm ứng, đền hàng…) ghi rõ ở ô ghi chú. Phạt nội quy nhập ở mục “Phạt nội quy”.
      </p>
    </div>
  );
}

// ============ PHẠT NỘI QUY ============
function Penalties({ month, people, penalties }: { month: string; people: Staff[]; penalties: Penalty[] }) {
  const router = useRouter();
  const today = todayVn();
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(today.startsWith(month) ? today : `${month}-01`);
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = (id: string) => people.find((p) => p.id === id)?.full_name ?? "?";

  async function add() {
    setError(null);
    if (!staffId) return setError("Chọn nhân viên");
    if (amount <= 0) return setError("Nhập số tiền phạt");
    if (!reason.trim()) return setError("Ghi lý do phạt");
    if (!date.startsWith(month)) return setError(`Ngày phạt phải trong tháng ${shortLabel(month)}`);
    setBusy(true);
    const { error } = await createClient().from("staff_penalties").insert({ staff_id: staffId, penalty_date: date, amount, reason: reason.trim() });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    setAmount(0);
    setReason("");
    router.refresh();
  }
  async function remove(id: string) {
    if (!confirm("Xoá khoản phạt này?")) return;
    const { error } = await createClient().from("staff_penalties").delete().eq("id", id);
    if (error) return alert(vnError(error.message));
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="card grid gap-2 p-3 sm:grid-cols-2">
        <label className="text-xs">
          Nhân viên
          <select className="input mt-1 py-2 text-sm" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">– Chọn –</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </label>
        <label className="text-xs">
          Ngày
          <input type="date" className="input mt-1 py-2 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-xs">
          Số tiền phạt
          <MoneyInput value={amount} onChange={setAmount} className="mt-1 block w-full py-2.5" ariaLabel="Số tiền phạt" />
        </label>
        <label className="text-xs">
          Lý do (theo nội quy)
          <input className="input mt-1 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Đi muộn, không đồng phục…" />
        </label>
        <div className="flex items-center gap-2 sm:col-span-2">
          <button className="btn-primary" disabled={busy} onClick={add}>Thêm khoản phạt</button>
          {error && <span className="text-sm text-[#8A2323]">{error}</span>}
        </div>
      </div>
      <div className="card p-0">
        <p className="px-4 pt-3 text-sm font-semibold text-navy">Phạt tháng {shortLabel(month)}</p>
        {penalties.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink/60">Chưa có khoản phạt nào.</p>
        ) : (
          <ul className="divide-y divide-beige text-sm">
            {penalties.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{name(p.staff_id)}</span> · {p.reason}
                  <span className="block text-xs text-ink/50">{shortLabel(p.penalty_date)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-[#8A2323]">−{formatVnd(n(p.amount))}</span>
                  <button className="text-xs text-ink/50 underline" onClick={() => remove(p.id)}>Xoá</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ============ MỨC LƯƠNG ============
function Salaries({ people, allStaff, settings, config, branchName }: {
  people: Staff[]; allStaff: Staff[]; settings: PaySetting[]; config: PayrollConfig | null; branchName: (id: string | null) => string;
}) {
  const router = useRouter();
  const list = useMemo(() => {
    const ids = new Set(people.map((p) => p.id));
    return [...people, ...allStaff.filter((s) => !ids.has(s.id) && s.role === "owner")];
  }, [people, allStaff]);
  const init = useMemo(() => {
    const m: Record<string, PaySetting> = {};
    list.forEach((p) => {
      const s = settings.find((x) => x.staff_id === p.id);
      m[p.id] = s
        ? { ...s, base_salary: n(s.base_salary), responsibility_pay: n(s.responsibility_pay), insurance_salary: n(s.insurance_salary) }
        : { staff_id: p.id, base_salary: 0, responsibility_pay: 0, insurance_salary: 0, meal_per_day: null, on_payroll: p.role !== "owner", note: null };
    });
    return m;
  }, [list, settings]);
  const [rows, setRows] = useState(init);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (id: string, patch: Partial<PaySetting>) => {
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
    setDirty((d) => new Set(d).add(id));
    setMsg(null);
  };
  async function save() {
    setBusy(true);
    const payload = [...dirty].map((id) => ({ ...rows[id], note: rows[id].note?.trim() || null, updated_at: new Date().toISOString() }));
    const { error } = await createClient().from("staff_pay_settings").upsert(payload, { onConflict: "staff_id" });
    setBusy(false);
    if (error) return setMsg(vnError(error.message));
    setDirty(new Set());
    setMsg("Đã lưu mức lương.");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-cream text-left text-xs text-ink/60">
            <tr>
              <th className="px-3 py-2">Nhân viên</th>
              <th className="px-2 py-2">Lương cơ bản / tháng</th>
              <th className="px-2 py-2">Lương trách nhiệm</th>
              <th className="px-2 py-2">Lương đóng BHXH</th>
              <th className="px-2 py-2">Phụ cấp ăn / công</th>
              <th className="px-3 py-2">Tính lương</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const r = rows[p.id];
              return (
                <tr key={p.id} className={`border-t border-beige ${dirty.has(p.id) ? "bg-[#FFF8E6]" : ""} ${r.on_payroll ? "" : "opacity-60"}`}>
                  <td className="px-3 py-2">
                    <span className="font-medium">{p.full_name ?? "?"}</span>
                    <span className="block text-xs text-ink/50">{ROLE_LABEL[p.role]} {branchName(p.branch_id) && `· ${branchName(p.branch_id)}`}</span>
                  </td>
                  <td className="px-2 py-2"><MoneyInput value={r.base_salary} onChange={(v) => set(p.id, { base_salary: v })} className="w-28" ariaLabel="Lương cơ bản" /></td>
                  <td className="px-2 py-2"><MoneyInput value={r.responsibility_pay} onChange={(v) => set(p.id, { responsibility_pay: v })} className="w-28" ariaLabel="Lương trách nhiệm" /></td>
                  <td className="px-2 py-2"><MoneyInput value={r.insurance_salary} onChange={(v) => set(p.id, { insurance_salary: v })} className="w-28" ariaLabel="Lương đóng BHXH" /></td>
                  <td className="px-2 py-2">
                    <MoneyInput
                      value={r.meal_per_day ?? 0}
                      onChange={(v) => set(p.id, { meal_per_day: v || null })}
                      placeholder={config ? String(config.meal_per_day / 1000) + "k" : "30k"}
                      className="w-20"
                      ariaLabel="Phụ cấp ăn"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={r.on_payroll} onChange={(e) => set(p.id, { on_payroll: e.target.checked })} aria-label="Có trong bảng lương" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={busy || dirty.size === 0} onClick={save}>{busy ? "Đang lưu…" : "Lưu mức lương"}</button>
        {msg && <span className="text-sm">{msg}</span>}
      </div>
      <p className="text-xs text-ink/60">
        Lương cơ bản là mức đủ {config?.standard_days ?? 26} ngày công, tháng nào thiếu / thừa công thì tính theo tỉ lệ. Lương trách nhiệm
        trả đủ theo tháng. Lương đóng BHXH để 0 nếu nhân viên chưa đóng bảo hiểm. Phụ cấp ăn để trống thì theo mức chung
        ({formatVnd(config?.meal_per_day ?? 30000)}/công). Bỏ tích “Tính lương” với người không nhận lương ở đây (vd chủ spa).
      </p>
    </div>
  );
}

// ============ CÀI ĐẶT CHUNG ============
function Settings({ config }: { config: PayrollConfig }) {
  const router = useRouter();
  const [c, setC] = useState<PayrollConfig>({ ...config });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const field = (k: keyof PayrollConfig, label: string, step = "1") => (
    <label className="text-xs">
      {label}
      <input
        type="number"
        step={step}
        min={0}
        className="input mt-1 py-2 text-sm"
        value={c[k]}
        onChange={(e) => { setC({ ...c, [k]: Number(e.target.value) }); setMsg(null); }}
      />
    </label>
  );
  async function save() {
    setBusy(true);
    const { error } = await createClient().rpc("set_payroll_settings", { p: c });
    setBusy(false);
    if (error) return setMsg(vnError(error.message));
    setMsg("Đã lưu cài đặt.");
    router.refresh();
  }
  return (
    <div className="card space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {field("standard_days", "Ngày công chuẩn / tháng", "0.5")}
        {field("hours_per_day", "Số giờ / ngày công", "0.5")}
        {field("overtime_rate", "Hệ số làm thêm giờ (1,5 = 150%)", "0.1")}
        <label className="text-xs">
          Phụ cấp ăn / ngày công
          <MoneyInput value={c.meal_per_day} onChange={(v) => { setC({ ...c, meal_per_day: v }); setMsg(null); }} className="mt-1 block w-full py-2.5" ariaLabel="Phụ cấp ăn" />
        </label>
        {field("bhxh_employee_pct", "% BHXH trừ lương nhân viên", "0.1")}
        {field("bhxh_employer_pct", "% BHXH Moana đóng", "0.1")}
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-primary" disabled={busy} onClick={save}>Lưu cài đặt</button>
        {msg && <span className="text-sm">{msg}</span>}
      </div>
      <p className="text-xs text-ink/60">
        Mức BHXH 2026 theo luật: nhân viên đóng 10,5% (8% BHXH + 1,5% BHYT + 1% BHTN), doanh nghiệp đóng 21,5% (17,5% BHXH + 3% BHYT + 1%
        BHTN), tính trên lương đóng bảo hiểm. Bảng lương các tháng luôn tính theo cài đặt hiện tại; tháng đã ghi sổ chi thì bấm “Cập nhật lại vào sổ chi” nếu muốn đổi số.
      </p>
    </div>
  );
}

function Box({ label, value, hint, strong }: { label: string; value: number; hint?: string; strong?: boolean }) {
  return (
    <div className="card p-3">
      <p className="text-xs text-ink/60">{label}</p>
      <p className={`mt-1 text-lg font-bold ${strong ? "text-navy" : ""}`}>{formatVnd(value)}</p>
      {hint && <p className="text-[11px] text-ink/50">{hint}</p>}
    </div>
  );
}
