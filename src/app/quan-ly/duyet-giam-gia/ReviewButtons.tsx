"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";
import MoneyInput from "@/components/MoneyInput";

export default function ReviewButtons({ id, amount }: { id: string; amount: number }) {
  const router = useRouter();
  const [value, setValue] = useState(amount);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function review(approve: boolean) {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("review_discount", {
      p_id: id,
      p_approve: approve,
      p_amount: approve ? value : null,
      p_note: note,
    });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    router.refresh();
  }

  return (
    <div className="mt-3 space-y-2 border-t border-beige pt-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-ink/60">Duyệt số tiền</span>
        <MoneyInput value={value} onChange={(n) => setValue(Math.min(n, amount))} className="w-32" ariaLabel="Số tiền duyệt" />
        <input
          className="min-w-0 flex-1 rounded-lg border border-beige-dark px-2 py-1.5 text-sm"
          placeholder="Ghi chú (không bắt buộc)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {error && <p className="text-xs text-[#8A2323]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className="btn-ghost py-2 text-[#8A2323]" disabled={busy} onClick={() => review(false)}>
          Từ chối
        </button>
        <button className="btn-primary py-2" disabled={busy || value <= 0} onClick={() => review(true)}>
          Duyệt
        </button>
      </div>
    </div>
  );
}
