"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { todayVn, vnDateTime, vnError } from "@/lib/format";
import { LAST_START_HOUR, MAX_DAYS_AHEAD, OPEN_HOUR, SLOT_MINUTES } from "@/lib/config";

export const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let m = OPEN_HOUR * 60; m <= LAST_START_HOUR * 60 + 30; m += SLOT_MINUTES) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
})();

export default function RegisterForm({ promotionId, branches }: { promotionId: string; branches: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const at = date && time ? vnDateTime(date, time).toISOString() : null;
    const { error } = await createClient().rpc("register_promotion", {
      p_promotion_id: promotionId,
      p_branch_id: branchId,
      p_preferred_at: at,
      p_note: note,
    });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    setDone(true);
    router.refresh();
  }

  if (done) {
    return (
      <p className="rounded-xl bg-[#D6EDD8] px-3 py-2 text-sm text-[#22612A]">
        ✓ Đã gửi đăng ký. Moana sẽ gọi cho bạn để xác nhận và hẹn lịch.
      </p>
    );
  }
  if (!open) {
    return (
      <button className="btn-primary w-full" onClick={() => setOpen(true)}>
        Đăng ký ưu đãi
      </button>
    );
  }
  return (
    <div className="space-y-3 rounded-xl bg-cream p-3">
      {branches.length > 1 && (
        <label className="block">
          <span className="label">Chi nhánh</span>
          <select className="input py-2" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>
      )}
      <div>
        <span className="label">Ngày giờ bạn muốn đến (không bắt buộc)</span>
        <div className="flex gap-2">
          <input
            type="date"
            className="input flex-1 py-2"
            min={todayVn()}
            max={todayVn(MAX_DAYS_AHEAD)}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <select className="input w-28 py-2" value={time} onChange={(e) => setTime(e.target.value)}>
            <option value="">Giờ</option>
            {TIME_SLOTS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
      <label className="block">
        <span className="label">Ghi chú</span>
        <input className="input py-2" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="VD: gọi sau 18h" />
      </label>
      {error && <p className="text-sm text-[#8A2323]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Đóng</button>
        <button className="btn-primary" onClick={submit} disabled={busy || !branchId || (!!date !== !!time)}>
          {busy ? "Đang gửi…" : "Gửi đăng ký"}
        </button>
      </div>
      {!!date !== !!time && <p className="text-xs text-ink/60">Chọn cả ngày và giờ, hoặc bỏ trống cả hai.</p>}
    </div>
  );
}
