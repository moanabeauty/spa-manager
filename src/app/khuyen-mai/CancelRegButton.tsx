"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";

/** Huỷ đăng ký khuyến mãi. Nhân viên huỷ hộ khách phải ghi lý do. */
export default function CancelRegButton({ id, needReason = false }: { id: string; needReason?: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("cancel_promotion_registration", { p_id: id, p_reason: reason });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    router.refresh();
  }

  if (!confirming) {
    return (
      <button className="btn-ghost py-1.5 text-[#8A2323]" onClick={() => setConfirming(true)}>
        Huỷ đăng ký
      </button>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-2 text-sm">
      {needReason ? (
        <input
          className="min-w-0 flex-1 rounded-lg border border-beige-dark px-2 py-1.5 text-sm"
          placeholder="Lý do huỷ (bắt buộc)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      ) : (
        <span>Huỷ đăng ký ưu đãi này?</span>
      )}
      <button className="btn-ghost py-1.5" onClick={() => setConfirming(false)} disabled={busy}>Không</button>
      <button
        className="inline-flex rounded-full bg-[#8A2323] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        onClick={cancel}
        disabled={busy || (needReason && !reason.trim())}
      >
        {busy ? "Đang huỷ…" : "Huỷ"}
      </button>
      {error && <p className="w-full text-right text-xs text-[#8A2323]">{error}</p>}
    </div>
  );
}
