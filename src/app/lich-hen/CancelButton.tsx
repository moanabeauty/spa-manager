"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";

export default function CancelButton({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    const { error } = await createClient().from("appointments").update({ status: "cancelled" }).eq("id", id);
    setBusy(false);
    if (error) return setError(vnError(error.message));
    router.refresh();
  }

  if (!confirming) {
    return (
      <button className="btn-ghost text-[#8A2323]" onClick={() => setConfirming(true)}>
        Huỷ lịch
      </button>
    );
  }
  return (
    <div className="inline-flex flex-wrap items-center justify-end gap-2 text-sm">
      <span>Bạn chắc chắn muốn huỷ?</span>
      <button className="btn-ghost" onClick={() => setConfirming(false)} disabled={busy}>Không</button>
      <button className="inline-flex rounded-full bg-[#8A2323] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={cancel} disabled={busy}>
        {busy ? "Đang huỷ…" : "Huỷ lịch"}
      </button>
      {error && <p className="w-full text-right text-xs text-[#8A2323]">{error}</p>}
    </div>
  );
}
