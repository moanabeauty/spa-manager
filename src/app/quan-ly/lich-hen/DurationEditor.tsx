"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatDuration, vnError } from "@/lib/format";

const QUICK = [30, 45, 60, 75, 90, 120];

/** Chủ / quản lý đổi thời gian làm của 1 dịch vụ trong lịch (các dịch vụ sau tự dời) */
export default function DurationEditor({ serviceRowId, minutes }: { serviceRowId: string; minutes: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(String(minutes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(m: number) {
    setBusy(true);
    setError(null);
    const { error: e } = await createClient().rpc("set_appointment_service_minutes", { p_id: serviceRowId, p_minutes: m });
    setBusy(false);
    if (e) return setError(vnError(e.message));
    setOpen(false);
    router.refresh();
  }

  if (!open)
    return (
      <button type="button" className="text-xs text-navy underline" onClick={() => setOpen(true)}>
        ⏱ {formatDuration(minutes)} · đổi
      </button>
    );
  return (
    <div className="mt-1 rounded-lg bg-cream p-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            disabled={busy}
            onClick={() => save(q)}
            className={`rounded-full px-2.5 py-1 font-semibold ${q === minutes ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}
          >
            {q}p
          </button>
        ))}
        <input className="w-16 rounded-lg border border-beige-dark px-2 py-1 text-sm" inputMode="numeric" value={val} onChange={(e) => setVal(e.target.value.replace(/\D/g, ""))} />
        <button type="button" className="btn-primary px-3 py-1 text-xs" disabled={busy || !val} onClick={() => save(Number(val))}>Lưu</button>
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setOpen(false)}>Huỷ</button>
      </div>
      <p className="mt-1 text-ink/60">Các dịch vụ làm sau trong lịch này tự dời giờ theo.</p>
      {error && <p className="mt-1 text-[#8A2323]">{error}</p>}
    </div>
  );
}
