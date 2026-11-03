"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { todayVn, vnError } from "@/lib/format";

/** Chủ / quản lý gia hạn ưu đãi đã hết hạn dùng (bắt buộc lý do) */
export default function ExtendRegForm({ id, expired }: { id: string; expired: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [until, setUntil] = useState(todayVn(7));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("extend_promotion_registration", { p_id: id, p_until: until, p_reason: reason });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button className={expired ? "btn-primary py-1.5" : "btn-ghost py-1.5"} onClick={() => setOpen(true)}>
        Gia hạn
      </button>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-2 text-xs">
      <span className="text-ink/60">Dùng đến</span>
      <input type="date" min={todayVn()} className="rounded-lg border border-beige-dark px-2 py-1.5 text-sm" value={until} onChange={(e) => setUntil(e.target.value)} />
      <input
        className="min-w-0 flex-1 rounded-lg border border-beige-dark px-2 py-1.5 text-sm"
        placeholder="Lý do gia hạn (bắt buộc)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button className="btn-ghost py-1.5" onClick={() => setOpen(false)} disabled={busy}>Đóng</button>
      <button className="btn-primary py-1.5" onClick={save} disabled={busy || !until || !reason.trim()}>
        {busy ? "Đang lưu…" : "Duyệt gia hạn"}
      </button>
      {error && <p className="w-full text-right text-[#8A2323]">{error}</p>}
    </div>
  );
}
