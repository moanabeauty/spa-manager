"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatVnd, vnError } from "@/lib/format";
import MoneyInput from "@/components/MoneyInput";

type Quote = {
  paid: number;
  used_value: number;
  balance: number | null;
  bonus: number | null;
  used_sessions: number;
  refund: number;
  max_refund: number;
};

/** Quản lý / chủ spa huỷ thẻ nạp sẵn hoặc gói combo đang dùng dở, hệ thống tính tiền trả lại khách */
export default function RefundButton({ kind, id, label }: { kind: "card" | "package"; id: string; label: string }) {
  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("cash");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    const { data, error } = await createClient().rpc("refund_quote", { p_kind: kind, p_id: id });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    const q = (Array.isArray(data) ? data[0] : data) as Quote;
    const n = (v: number | null) => (v === null ? null : Number(v));
    const qq = {
      ...q,
      paid: Number(q.paid),
      used_value: Number(q.used_value),
      balance: n(q.balance),
      bonus: n(q.bonus),
      refund: Number(q.refund),
      max_refund: Number(q.max_refund),
    };
    setQuote(qq);
    setAmount(qq.refund);
  }

  async function run() {
    if (!window.confirm(`Huỷ ${label} và hoàn ${formatVnd(amount)} cho khách?`)) return;
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("refund_customer_asset", {
      p_kind: kind,
      p_id: id,
      p_amount: amount,
      p_method: method,
      p_reason: reason,
    });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    setQuote(null);
    router.refresh();
  }

  if (!quote) {
    return (
      <span>
        <button className="text-xs font-semibold text-[#8A2323] underline" disabled={busy} onClick={open}>
          {busy ? "…" : "Huỷ & hoàn tiền"}
        </button>
        {error && <span className="ml-2 text-xs text-[#8A2323]">{error}</span>}
      </span>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-[#8A2323]/40 bg-[#F6D5D5]/30 p-3 text-sm">
      <p className="font-semibold text-[#8A2323]">Huỷ {label}</p>
      {kind === "card" ? (
        <ul className="text-xs text-ink/80">
          <li>Mệnh giá đã nạp: {formatVnd(quote.paid)} (tặng thêm {formatVnd(quote.bonus ?? 0)}, không hoàn)</li>
          <li>Đã dùng {quote.used_sessions} dịch vụ, tính theo giá niêm yết: {formatVnd(quote.used_value)}</li>
          <li>Số dư thẻ hiện tại: {formatVnd(quote.balance ?? 0)}</li>
          <li>
            Trả lại = mệnh giá − giá niêm yết đã dùng = <b>{formatVnd(quote.refund)}</b>
          </li>
        </ul>
      ) : (
        <ul className="text-xs text-ink/80">
          <li>Giá gói khách đã trả: {formatVnd(quote.paid)}</li>
          <li>Đã dùng {quote.used_sessions} buổi, tính theo giá lẻ: {formatVnd(quote.used_value)}</li>
          <li>
            Trả lại = giá gói − buổi đã dùng = <b>{formatVnd(quote.refund)}</b>
          </li>
        </ul>
      )}
      <p className="text-xs text-ink/60">Tiền hoàn sẽ trừ vào doanh số của người đã bán {kind === "card" ? "thẻ" : "gói"} này trong tháng hoàn.</p>
      <label className="flex items-center gap-2 text-xs">
        <span className="w-24">Số tiền hoàn</span>
        <MoneyInput value={amount} onChange={(n) => setAmount(Math.min(n, quote.max_refund))} className="flex-1" ariaLabel="Số tiền hoàn" />
      </label>
      {amount !== quote.refund && <p className="text-xs text-ink/60">Đã sửa khác số hệ thống tính ({formatVnd(quote.refund)}).</p>}
      <label className="flex items-center gap-2 text-xs">
        <span className="w-24">Hoàn bằng</span>
        <select className="flex-1 rounded-lg border border-beige-dark bg-white px-2 py-1.5" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="cash">Tiền mặt</option>
          <option value="bank_transfer">Chuyển khoản</option>
          <option value="pos">POS</option>
        </select>
      </label>
      <input className="input py-2 text-sm" placeholder="Lý do khách huỷ (bắt buộc)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <p className="text-xs text-ink/60">Sau khi huỷ, {kind === "card" ? "thẻ bị khoá và số dư về 0" : "gói bị khoá, không trừ buổi được nữa"}. Không hoàn tác được.</p>
      {error && <p className="text-xs text-[#8A2323]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className="btn-ghost py-1.5" onClick={() => setQuote(null)}>Thôi</button>
        <button className="btn-primary bg-[#8A2323] py-1.5 hover:bg-[#6d1b1b]" disabled={busy || !reason.trim()} onClick={run}>
          {busy ? "…" : `Huỷ & hoàn ${formatVnd(amount)}`}
        </button>
      </div>
    </div>
  );
}
