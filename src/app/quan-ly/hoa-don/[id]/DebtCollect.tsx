"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatVnd, vnError } from "@/lib/format";
import MoneyInput from "@/components/MoneyInput";

/** Thu tiền khách còn nợ (hoặc tiền COD đơn vị ship trả về) */
export default function DebtCollect({ invoiceId, owed }: { invoiceId: string; owed: number }) {
  const router = useRouter();
  const [amount, setAmount] = useState(owed);
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("collect_debt", { p_invoice: invoiceId, p_method: method, p_amount: amount, p_note: note });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    setNote("");
    router.refresh();
  }

  return (
    <div className="card space-y-2 border-l-4 border-l-[#E0A526] p-4 text-sm print:hidden">
      <p className="font-semibold text-navy">Thu nợ · khách còn nợ {formatVnd(owed)}</p>
      <div className="flex flex-wrap items-center gap-2">
        <MoneyInput value={amount} onChange={(v) => setAmount(Math.min(v, owed))} className="w-36" ariaLabel="Số tiền thu nợ" />
        <select className="rounded-lg border border-beige-dark px-2 py-2" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="cash">Tiền mặt</option>
          <option value="bank_transfer">Chuyển khoản</option>
          <option value="pos">Quẹt thẻ POS</option>
        </select>
        <input className="min-w-0 flex-1 rounded-lg border border-beige-dark px-2 py-2" placeholder="Ghi chú (VD: GHTK trả COD)"
          value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <p className="text-xs text-[#8A2323]">{error}</p>}
      <div className="flex justify-end">
        <button className="btn-primary py-2" disabled={busy || amount <= 0} onClick={save}>
          {busy ? "Đang lưu…" : `Thu ${formatVnd(amount)}`}
        </button>
      </div>
    </div>
  );
}
