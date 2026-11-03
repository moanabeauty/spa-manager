"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";
import { CASH_METHOD_LABEL } from "@/lib/reports";
import MoneyInput from "@/components/MoneyInput";

export type Category = { id: string; kind: "income" | "expense"; name: string; sort_order: number; is_active: boolean };

export default function CashbookForm({ categories, branches, defaultDate, defaultBranch }: {
  categories: Category[]; branches: { id: string; name: string }[]; defaultDate: string; defaultBranch: string;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [date, setDate] = useState(defaultDate);
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("cash");
  const [branch, setBranch] = useState(defaultBranch);
  const [desc, setDesc] = useState("");
  const [newCat, setNewCat] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const list = categories.filter((c) => c.kind === kind && c.is_active);

  async function save() {
    setMsg(null);
    if (!categoryId) return setMsg({ ok: false, text: "Chọn danh mục" });
    if (amount <= 0) return setMsg({ ok: false, text: "Nhập số tiền" });
    setBusy(true);
    const { error } = await createClient().from("cashbook_entries").insert({
      entry_date: date, kind, category_id: categoryId, amount, method, branch_id: branch || null, description: desc.trim() || null,
    });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: vnError(error.message) });
    setAmount(0);
    setDesc("");
    setMsg({ ok: true, text: "Đã ghi." });
    router.refresh();
  }

  async function addCategory() {
    const name = newCat.trim();
    if (!name) return;
    setBusy(true);
    const { data, error } = await createClient()
      .from("cashbook_categories")
      .insert({ kind, name, sort_order: 50 })
      .select("id")
      .single();
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message.includes("duplicate") ? "Danh mục đã có" : vnError(error.message) });
    setNewCat("");
    setCategoryId(data.id);
    router.refresh();
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-navy">Nhập khoản thu / chi</p>
        <div className="flex rounded-full bg-cream p-1 text-sm">
          {(["expense", "income"] as const).map((k) => (
            <button
              key={k}
              onClick={() => { setKind(k); setCategoryId(""); setMsg(null); }}
              className={`rounded-full px-4 py-1 font-semibold ${kind === k ? (k === "income" ? "bg-[#22612A] text-white" : "bg-[#8A2323] text-white") : "text-ink/60"}`}
            >
              {k === "income" ? "Thu" : "Chi"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs">
          Danh mục
          <select className="input mt-1 py-2 text-sm" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">– Chọn –</option>
            {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-xs">
          Số tiền
          <MoneyInput value={amount} onChange={setAmount} className="mt-1 block w-full py-2.5" ariaLabel="Số tiền" />
        </label>
        <label className="text-xs">
          Ngày
          <input type="date" className="input mt-1 py-2 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-xs">
          Hình thức
          <select className="input mt-1 py-2 text-sm" value={method} onChange={(e) => setMethod(e.target.value)}>
            {Object.entries(CASH_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-xs">
          Chi nhánh
          <select className="input mt-1 py-2 text-sm" value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">Chung (cả 2 chi nhánh)</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="text-xs">
          Diễn giải
          <input className="input mt-1 py-2 text-sm" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Tiền nhà tháng 11, hoá đơn điện…" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={busy} onClick={save}>Ghi {kind === "income" ? "khoản thu" : "khoản chi"}</button>
        {msg && <span className={`text-sm ${msg.ok ? "text-[#22612A]" : "text-[#8A2323]"}`}>{msg.text}</span>}
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-ink/60">Thêm danh mục {kind === "income" ? "thu" : "chi"} mới</summary>
        <div className="mt-2 flex gap-2">
          <input className="input py-2 text-sm" value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Tên danh mục" />
          <button className="btn-outline shrink-0 py-2" disabled={busy} onClick={addCategory}>Thêm</button>
        </div>
      </details>
    </div>
  );
}

export function DeleteEntryButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <button
      className="text-xs text-ink/50 underline"
      onClick={async () => {
        if (!confirm("Xoá khoản này?")) return;
        const { error } = await createClient().from("cashbook_entries").delete().eq("id", id);
        if (error) return alert(vnError(error.message));
        router.refresh();
      }}
    >
      Xoá
    </button>
  );
}
