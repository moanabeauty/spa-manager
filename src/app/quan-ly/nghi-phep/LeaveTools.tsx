"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { todayVn, vnError } from "@/lib/format";
import { shortLabel } from "@/lib/reports";

export type Leave = {
  id: string; staff_id: string; leave_date: string; kind: "paid" | "unpaid" | "unexcused"; half_day: boolean;
  reason: string | null; status: string; review_note: string | null; created_at: string;
};

const KIND: Record<string, string> = { paid: "Nghỉ phép có lương", unpaid: "Nghỉ phép không lương", unexcused: "Nghỉ không phép" };
const STATUS: Record<string, { t: string; c: string }> = {
  pending: { t: "Chờ duyệt", c: "bg-[#FFE8BA] text-[#7A5600]" },
  approved: { t: "Đã duyệt", c: "bg-[#D6EDD8] text-[#22612A]" },
  rejected: { t: "Từ chối", c: "bg-[#F6D5D5] text-[#8A2323]" },
};

export default function LeaveTools({ me, manage, month, leaves, pending, staff }: {
  me: string; manage: boolean; month: string; leaves: Leave[]; pending: Leave[];
  staff: { id: string; full_name: string | null; role: string }[];
}) {
  const router = useRouter();
  const today = todayVn();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [kind, setKind] = useState<"paid" | "unpaid">("unpaid");
  const [half, setHalf] = useState(false);
  const [reason, setReason] = useState("");
  const [absStaff, setAbsStaff] = useState("");
  const [absDate, setAbsDate] = useState(today);
  const [absReason, setAbsReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const name = (id: string) => staff.find((s) => s.id === id)?.full_name ?? (id === me ? "Tôi" : "?");
  const day = (d: string) => new Intl.DateTimeFormat("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(`${d}T12:00:00+07:00`));

  async function call(fn: string, args: Record<string, unknown>, ok?: string) {
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().rpc(fn, args);
    setBusy(false);
    if (error) {
      setMsg({ ok: false, t: vnError(error.message) });
      return false;
    }
    if (ok) setMsg({ ok: true, t: ok });
    router.refresh();
    return true;
  }

  async function submit() {
    if (!reason.trim()) return setMsg({ ok: false, t: "Ghi lý do nghỉ" });
    if (await call("request_leave", { p_from: from, p_to: half ? from : to, p_kind: kind, p_reason: reason, p_half_day: half }, "Đã gửi đơn, chờ quản lý duyệt.")) {
      setReason("");
    }
  }

  const mine = leaves.filter((l) => l.staff_id === me);
  const others = manage ? leaves.filter((l) => l.staff_id !== me) : [];

  return (
    <div className="space-y-4">
      {msg && <p className={`card p-3 text-sm ${msg.ok ? "text-[#22612A]" : "text-[#8A2323]"}`}>{msg.t}</p>}

      {manage && pending.length > 0 && (
        <div className="card border-l-4 border-l-[#E0A526] p-0">
          <p className="px-4 pt-3 text-sm font-semibold text-navy">Đơn chờ duyệt ({pending.length})</p>
          <ul className="divide-y divide-beige text-sm">
            {pending.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span>
                  <span className="font-medium">{name(l.staff_id)}</span> · {day(l.leave_date)}{l.half_day ? " (nửa ngày)" : ""}
                  <span className="block text-xs text-ink/60">{KIND[l.kind]} · {l.reason}</span>
                </span>
                <span className="flex gap-2">
                  <button className="btn-primary py-1.5 text-xs" disabled={busy} onClick={() => call("review_leave", { p_id: l.id, p_approve: true })}>Duyệt</button>
                  <button className="btn-ghost py-1.5 text-xs text-[#8A2323]" disabled={busy} onClick={() => call("review_leave", { p_id: l.id, p_approve: false })}>Từ chối</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card space-y-3 p-4">
        <p className="text-sm font-semibold text-navy">Đăng ký nghỉ</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs">
            Từ ngày
            <input type="date" className="input mt-1 py-2 text-sm" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} />
          </label>
          <label className="text-xs">
            Đến ngày
            <input type="date" className="input mt-1 py-2 text-sm" value={half ? from : to} min={from} disabled={half} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="text-xs">
            Loại
            <select className="input mt-1 py-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as "paid" | "unpaid")}>
              <option value="unpaid">Nghỉ phép không lương</option>
              <option value="paid">Nghỉ phép có lương (phép năm)</option>
            </select>
          </label>
          <label className="flex items-end gap-2 pb-3 text-sm">
            <input type="checkbox" checked={half} onChange={(e) => setHalf(e.target.checked)} /> Nghỉ nửa ngày
          </label>
          <label className="text-xs sm:col-span-2">
            Lý do
            <input className="input mt-1 py-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Việc gia đình, ốm…" />
          </label>
        </div>
        <button className="btn-primary" disabled={busy} onClick={submit}>Gửi đơn nghỉ</button>
      </div>

      <List title="Đơn nghỉ của tôi" rows={mine} name={name} day={day}
        action={(l) => l.status === "pending" && (
          <button className="text-xs text-ink/60 underline" disabled={busy} onClick={() => call("cancel_leave", { p_id: l.id })}>Huỷ đơn</button>
        )} />

      {manage && (
        <>
          <div className="card space-y-3 p-4">
            <p className="text-sm font-semibold text-navy">Ghi nghỉ không phép</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="text-xs">
                Nhân viên
                <select className="input mt-1 py-2 text-sm" value={absStaff} onChange={(e) => setAbsStaff(e.target.value)}>
                  <option value="">– Chọn –</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </label>
              <label className="text-xs">
                Ngày
                <input type="date" className="input mt-1 py-2 text-sm" value={absDate} onChange={(e) => setAbsDate(e.target.value)} />
              </label>
              <label className="text-xs">
                Ghi chú
                <input className="input mt-1 py-2 text-sm" value={absReason} onChange={(e) => setAbsReason(e.target.value)} placeholder="Không báo trước…" />
              </label>
            </div>
            <button
              className="btn-outline"
              disabled={busy}
              onClick={() => {
                if (!absStaff) return setMsg({ ok: false, t: "Chọn nhân viên" });
                if (!confirm(`Ghi ${name(absStaff)} nghỉ không phép ngày ${shortLabel(absDate)}? Ngày này bị trừ thêm 1 ngày lương.`)) return;
                call("record_absence", { p_staff: absStaff, p_date: absDate, p_reason: absReason }, "Đã ghi nghỉ không phép.");
              }}
            >
              Ghi nghỉ không phép
            </button>
          </div>
          <List title={`Nghỉ của nhân viên tháng ${shortLabel(month)}`} rows={others} name={name} day={day}
            action={(l) => l.kind === "unexcused" && l.status === "approved" && (
              <button className="text-xs text-ink/60 underline" disabled={busy}
                onClick={() => confirm("Bỏ ghi nghỉ không phép ngày này?") && call("delete_absence", { p_id: l.id })}>Bỏ</button>
            )} />
        </>
      )}

      <p className="text-xs text-ink/60">
        Nghỉ có phép không lương: ngày đó không tính lương. Nghỉ phép có lương: được tính đủ giờ ngày đó. <b>Nghỉ không phép</b> (quản lý
        ghi): không có lương ngày đó và bị trừ thêm 1 ngày lương.
      </p>
    </div>
  );
}

function List({ title, rows, name, day, action }: {
  title: string; rows: Leave[]; name: (id: string) => string; day: (d: string) => string; action: (l: Leave) => React.ReactNode;
}) {
  return (
    <div className="card p-0">
      <p className="px-4 pt-3 text-sm font-semibold text-navy">{title}</p>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink/60">Chưa có.</p>
      ) : (
        <ul className="divide-y divide-beige text-sm">
          {rows.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 px-4 py-2">
              <span className="min-w-0">
                <span className="font-medium">{name(l.staff_id)}</span> · {day(l.leave_date)}{l.half_day ? " (nửa ngày)" : ""}
                <span className={`block text-xs ${l.kind === "unexcused" ? "text-[#8A2323]" : "text-ink/60"}`}>
                  {KIND[l.kind]}{l.reason ? ` · ${l.reason}` : ""}{l.review_note ? ` · ${l.review_note}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS[l.status]?.c ?? ""}`}>{STATUS[l.status]?.t ?? l.status}</span>
                {action(l)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
