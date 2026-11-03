"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { todayVn, vnDateTime, vnError } from "@/lib/format";
import { TIMEZONE } from "@/lib/config";
import { TIME_SLOTS } from "@/app/khuyen-mai/RegisterForm";

function splitVn(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return { date, time };
}

/** Lễ tân gọi khách xong: xác nhận, có thể đổi chi nhánh / ngày giờ khách hẹn */
export default function ConfirmRegForm({
  id,
  preferredAt,
  branchId,
  branches,
}: {
  id: string;
  preferredAt: string | null;
  branchId: string | null;
  branches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const init = splitVn(preferredAt);
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.time);
  const [branch, setBranch] = useState(branchId ?? branches[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changed = date !== init.date || time !== init.time;
  async function confirm() {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("confirm_promotion_registration", {
      p_id: id,
      p_note: note,
      p_preferred_at: changed && date && time ? vnDateTime(date, time).toISOString() : null,
      p_branch_id: branch || null,
    });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    router.refresh();
  }

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {branches.length > 1 && (
          <select className="rounded-lg border border-beige-dark px-2 py-1.5 text-sm" value={branch} onChange={(e) => setBranch(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
        <span className="text-ink/60">Hẹn</span>
        <input type="date" min={todayVn()} className="rounded-lg border border-beige-dark px-2 py-1.5 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
        <select className="rounded-lg border border-beige-dark px-2 py-1.5 text-sm" value={time} onChange={(e) => setTime(e.target.value)}>
          <option value="">Giờ</option>
          {TIME_SLOTS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
          {time && !TIME_SLOTS.includes(time) && <option value={time}>{time}</option>}
        </select>
      </div>
      <input
        className="w-full rounded-lg border border-beige-dark px-2 py-1.5 text-sm"
        placeholder="Ghi chú sau khi gọi khách (không bắt buộc)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error && <p className="text-[#8A2323]">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink/50">Xác nhận xong, tạo lịch hẹn ở mục “Đã xác nhận”.</span>
        <button className="btn-primary py-1.5" disabled={busy || (changed && !!date !== !!time)} onClick={confirm}>
          {busy ? "Đang lưu…" : "✓ Đã gọi, xác nhận"}
        </button>
      </div>
    </div>
  );
}
