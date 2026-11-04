"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";
import MoneyInput from "@/components/MoneyInput";

type Cat = { id: string; kind: "income" | "expense"; name: string };

export default function VoucherForm({ branches, categories, defaultBranch }: { branches: { id: string; name: string }[]; categories: Cat[]; defaultBranch: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [branch, setBranch] = useState(defaultBranch);
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("cash");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const list = categories.filter((c) => c.kind === kind);

  async function save() {
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().rpc("create_cash_voucher", {
      p_branch: branch, p_kind: kind, p_category: categoryId || null, p_amount: amount, p_method: method, p_description: desc,
    });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: vnError(error.message) });
    setAmount(0);
    setDesc("");
    setMsg({ ok: true, text: "Đã tạo phiếu." });
    router.refresh();
  }

  return (
    <div className="card space-y-3 p-4 text-sm">
      <div className="flex gap-1 rounded-full bg-cream p-1">
        {(
          [
            ["expense", "Phiếu chi"],
            ["income", "Phiếu thu"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => { setKind(k); setCategoryId(""); }}
            className={`flex-1 rounded-full px-3 py-1.5 font-semibold ${kind === k ? "bg-navy text-white" : "text-navy"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <select className="input py-2" value={branch} onChange={(e) => setBranch(e.target.value)}>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className="input py-2" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">— Khoản mục —</option>
          {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <MoneyInput value={amount} onChange={setAmount} className="w-full py-2.5" ariaLabel="Số tiền" />
        <select className="input py-2" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="cash">Tiền mặt</option>
          <option value="bank_transfer">Chuyển khoản</option>
          <option value="pos">Quẹt thẻ POS</option>
        </select>
      </div>
      <input className="input py-2" placeholder="Nội dung (VD: ship đơn HD261104-00012, mua khăn…)" value={desc} onChange={(e) => setDesc(e.target.value)} />
      <div className="flex items-center justify-end gap-2">
        {msg && <span className={msg.ok ? "text-[#22612A]" : "text-[#8A2323]"}>{msg.text}</span>}
        <button className="btn-primary py-2" disabled={busy || !categoryId || amount <= 0 || !desc.trim()} onClick={save}>
          {busy ? "Đang lưu…" : kind === "expense" ? "Tạo phiếu chi" : "Tạo phiếu thu"}
        </button>
      </div>
    </div>
  );
}

export function VoucherReview({ id }: { id: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function review(approve: boolean) {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("review_cash_voucher", { p_id: id, p_approve: approve, p_note: note });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    router.refresh();
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-beige pt-2">
      <input className="min-w-0 flex-1 rounded-lg border border-beige-dark px-2 py-1.5" placeholder="Ghi chú (không bắt buộc)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn-ghost py-1.5 text-[#8A2323]" disabled={busy} onClick={() => review(false)}>Từ chối</button>
      <button className="btn-primary py-1.5" disabled={busy} onClick={() => review(true)}>Duyệt</button>
      {error && <p className="w-full text-xs text-[#8A2323]">{error}</p>}
    </div>
  );
}
