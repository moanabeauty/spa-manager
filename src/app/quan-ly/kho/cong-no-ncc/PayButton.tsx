"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatVnd, vnError } from "@/lib/format";
import MoneyInput from "@/components/MoneyInput";

/** Ghi 1 lần trả tiền nhà cung cấp cho phiếu nhập */
export default function PayButton({ receiptId, owe }: { receiptId: string; owe: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(owe);
  const [method, setMethod] = useState("bank_transfer");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open)
    return (
      <button className="btn-outline mt-2 w-full py-2" onClick={() => setOpen(true)}>
        Trả tiền
      </button>
    );

  async function pay() {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("pay_supplier", { p_receipt_id: receiptId, p_amount: amount, p_method: method, p_note: note });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="mt-2 space-y-2 rounded-xl bg-cream p-3 text-sm">
      <label className="flex items-center justify-between gap-2">
        Số tiền trả
        <MoneyInput value={amount} onChange={setAmount} className="w-32" ariaLabel="Số tiền trả" />
      </label>
      <p className="text-xs text-ink/55">Còn nợ phiếu này {formatVnd(owe)}</p>
      <select className="w-full rounded-lg border border-beige-dark bg-white px-3 py-2" value={method} onChange={(e) => setMethod(e.target.value)}>
        <option value="bank_transfer">Chuyển khoản</option>
        <option value="cash">Tiền mặt</option>
        <option value="other">Khác</option>
      </select>
      <input className="w-full rounded-lg border border-beige-dark bg-white px-3 py-2" placeholder="Ghi chú (không bắt buộc)" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <p className="text-[#8A2323]">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-ghost flex-1" onClick={() => setOpen(false)}>Huỷ</button>
        <button className="btn-primary flex-1" disabled={busy || amount <= 0 || amount > owe} onClick={pay}>
          {busy ? "Đang lưu…" : "Lưu"}
        </button>
      </div>
    </div>
  );
}
