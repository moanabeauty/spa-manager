"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";

/** KTV / kho bấm khi chai đã dùng hết */
export default function FinishButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("finish_opened_item", { p_id: id, p_note: note });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    setOpen(false);
    router.refresh();
  }

  if (!open)
    return (
      <button className="btn-outline py-1 text-xs" onClick={() => setOpen(true)}>
        Hết chai
      </button>
    );
  return (
    <div className="mt-2 w-full space-y-1.5 rounded-lg bg-cream p-2 text-xs">
      <p>Xác nhận <b>{label}</b> đã dùng hết?</p>
      <input className="input py-1.5 text-sm" placeholder="Ghi chú (không bắt buộc): đổ vỡ, hỏng…" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex gap-2">
        <button className="btn-ghost flex-1 py-1.5" disabled={busy} onClick={() => setOpen(false)}>Huỷ</button>
        <button className="btn-primary flex-1 py-1.5" disabled={busy} onClick={finish}>{busy ? "Đang lưu…" : "Đã hết"}</button>
      </div>
      {error && <p className="text-[#8A2323]">{error}</p>}
    </div>
  );
}
