"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";

/** Chủ spa huỷ hoá đơn đã thu: hoàn tiền thẻ, trả buổi gói, thu hồi tiền nạp / gói đã bán */
export default function VoidButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button className="btn-ghost text-[#8A2323]" onClick={() => setOpen(true)}>
        Huỷ hoá đơn
      </button>
    );
  }
  async function run() {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("void_invoice", { p_invoice: id, p_reason: reason });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    setOpen(false);
    router.refresh();
  }
  return (
    <div className="card w-full max-w-md space-y-2 p-4 text-sm">
      <p className="font-semibold text-[#8A2323]">Huỷ hoá đơn này?</p>
      <p className="text-xs text-ink/70">
        Tiền đã trừ thẻ được hoàn lại, buổi gói được trả lại, lịch hẹn quay về “đang làm” để thu lại. Tiền mặt / chuyển khoản / POS
        bạn tự hoàn cho khách. Không huỷ được nếu gói bán trong hoá đơn đã dùng hoặc tiền nạp đã tiêu.
      </p>
      <input className="input py-2" placeholder="Lý do huỷ (bắt buộc)" value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <p className="text-xs text-[#8A2323]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={() => setOpen(false)}>Thôi</button>
        <button className="btn-primary bg-[#8A2323] hover:bg-[#6d1b1b]" disabled={busy || !reason.trim()} onClick={run}>
          {busy ? "…" : "Huỷ hoá đơn"}
        </button>
      </div>
    </div>
  );
}
