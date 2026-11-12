"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";
import { OPEN_LEVELS } from "@/lib/inventory";

const LEVELS = [{ pct: 100, label: "Nguyên chai" }, ...OPEN_LEVELS];

/** Chủ spa xác nhận "thực tồn vẫn còn": chọn mức còn của chai thực tế → thành chai đang mở, KTV hoàn thành được buổi */
export default function StockConfirmReview({ id }: { id: string }) {
  const router = useRouter();
  const [pct, setPct] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(approve: boolean) {
    if (approve && pct == null) return setError("Chọn mức còn của chai.");
    setBusy(true);
    setError(null);
    const { error: e } = await createClient().rpc("review_stock_confirm", {
      p_id: id,
      p_approve: approve,
      p_pct: approve ? pct : null,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (e) return setError(vnError(e.message));
    router.refresh();
  }

  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-xs text-ink/70">Chai thực tế còn:</p>
      <div className="flex flex-wrap gap-1.5">
        {LEVELS.map((l) => (
          <button
            key={l.pct}
            type="button"
            onClick={() => setPct(l.pct)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${pct === l.pct ? "bg-navy text-white ring-navy" : "bg-white text-navy ring-beige-dark"}`}
          >
            {l.label}
          </button>
        ))}
      </div>
      <input className="w-full rounded-lg border border-beige-dark px-3 py-1.5 text-sm" placeholder="Ghi chú cho KTV (không bắt buộc)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex gap-2">
        <button className="btn-primary flex-1 py-1.5" disabled={busy} onClick={() => go(true)}>Xác nhận còn hàng</button>
        <button className="btn-outline flex-1 py-1.5" disabled={busy} onClick={() => go(false)}>Không xác nhận</button>
      </div>
      {error && <p className="text-xs text-[#8A2323]">{error}</p>}
    </div>
  );
}
