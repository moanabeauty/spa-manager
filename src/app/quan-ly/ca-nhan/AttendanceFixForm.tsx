"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { todayVn, vnError } from "@/lib/format";

/** Xin sửa công khi quên chấm vào / ra (quản lý duyệt) */
export default function AttendanceFixForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayVn());
  const [tin, setTin] = useState("");
  const [tout, setTout] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().rpc("request_attendance_fix", { p_date: date, p_in: tin, p_out: tout, p_reason: reason });
    setBusy(false);
    if (error) return setMsg(vnError(error.message));
    setOpen(false);
    setTin("");
    setTout("");
    setReason("");
    setMsg("Đã gửi quản lý duyệt.");
    router.refresh();
  }

  if (!open) {
    return (
      <button className="flex min-h-12 w-full items-center justify-between border-b border-[#EFECE6] text-left text-sm" onClick={() => setOpen(true)}>
        <span>
          Quên chấm công
          {msg && <span className="block text-xs text-[#1F5E3A]">{msg}</span>}
        </span>
        <span className="text-[#646464]">›</span>
      </button>
    );
  }
  return (
    <div className="space-y-2 border-b border-[#EFECE6] py-3">
      <p className="text-sm font-semibold">Xin sửa công (quên chấm vào / ra)</p>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs text-[#646464]">
          Ngày
          <input type="date" className="input px-2 py-2 text-sm" value={date} max={todayVn()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-xs text-[#646464]">
          Giờ vào
          <input type="time" className="input px-2 py-2 text-sm" value={tin} onChange={(e) => setTin(e.target.value)} />
        </label>
        <label className="text-xs text-[#646464]">
          Giờ ra
          <input type="time" className="input px-2 py-2 text-sm" value={tout} onChange={(e) => setTout(e.target.value)} />
        </label>
      </div>
      <input className="input py-2 text-sm" placeholder="Lý do (vd quên chấm ra, máy hết pin…)" value={reason} onChange={(e) => setReason(e.target.value)} />
      {msg && <p className="text-xs text-[#B3261E]">{msg}</p>}
      <div className="flex gap-2">
        <button className="btn-ghost flex-1" onClick={() => setOpen(false)}>Huỷ</button>
        <button className="btn-primary flex-1" disabled={busy} onClick={send}>Gửi quản lý duyệt</button>
      </div>
    </div>
  );
}
