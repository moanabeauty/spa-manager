"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { todayVn, vnError } from "@/lib/format";

/** Nút xử lý 1 nhắc chăm sóc: Xong (ghi kết quả, hẹn gọi lại) / Bỏ qua (bắt buộc lý do) */
export default function ReminderActions({ id }: { id: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "done" | "skipped">(null);
  const [result, setResult] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!mode) return;
    setError(null);
    if (mode === "skipped" && !result.trim()) return setError("Vui lòng ghi lý do bỏ qua.");
    setBusy(true);
    const { error } = await createClient().rpc("complete_care_reminder", {
      p_id: id,
      p_status: mode,
      p_result: result.trim() || null,
      p_next_days: next ? Number(next) : null,
    });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    setMode(null);
    router.refresh();
  }

  if (!mode) {
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="btn-primary px-4 py-1.5" onClick={() => setMode("done")}>Đã liên hệ</button>
        <button className="btn-ghost py-1.5" onClick={() => setMode("skipped")}>Bỏ qua</button>
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-2 rounded-xl bg-cream p-3">
      <textarea
        className="input py-2 text-sm"
        rows={2}
        autoFocus
        placeholder={mode === "done" ? "Kết quả: khách hẹn thứ 7 đến, da ổn, không kích ứng…" : "Lý do bỏ qua"}
        value={result}
        onChange={(e) => setResult(e.target.value)}
      />
      {mode === "done" && (
        <label className="flex items-center gap-2 text-sm">
          Nhắc gọi lại sau
          <select className="rounded-lg border border-beige-dark bg-white px-2 py-1" value={next} onChange={(e) => setNext(e.target.value)}>
            <option value="">— không —</option>
            <option value="1">1 ngày</option>
            <option value="3">3 ngày</option>
            <option value="7">1 tuần</option>
            <option value="14">2 tuần</option>
            <option value="30">1 tháng</option>
          </select>
        </label>
      )}
      {error && <p className="text-xs text-[#8A2323]">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary px-4 py-1.5" disabled={busy} onClick={submit}>{busy ? "Đang lưu…" : "Lưu"}</button>
        <button className="btn-ghost py-1.5" disabled={busy} onClick={() => setMode(null)}>Huỷ</button>
      </div>
    </div>
  );
}

/** Thêm nhắc chăm sóc thủ công, hoặc ghi lại 1 lần đã liên hệ khách */
export function AddReminderForm({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<null | "remind" | "log">(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState(todayVn(7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!title.trim()) return setError("Vui lòng nhập nội dung.");
    setBusy(true);
    const { error } = await createClient().rpc("add_care_reminder", {
      p_customer: customerId,
      p_due: open === "log" ? todayVn() : due,
      p_title: title.trim(),
      p_note: note.trim() || null,
      p_done: open === "log",
    });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    setOpen(null);
    setTitle("");
    setNote("");
    router.refresh();
  }

  if (!open) {
    return (
      <div className="mt-3 flex flex-wrap gap-2 border-t border-beige pt-3">
        <button className="btn-outline py-1.5" onClick={() => setOpen("remind")}>+ Hẹn nhắc chăm sóc</button>
        <button className="btn-ghost py-1.5" onClick={() => setOpen("log")}>Ghi lại cuộc gọi / tin nhắn</button>
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-2 border-t border-beige pt-3">
      <input
        className="input py-2 text-sm"
        autoFocus
        placeholder={open === "log" ? "vd: Gọi tư vấn gói Peel" : "vd: Gọi mời làm lại peel"}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="input py-2 text-sm"
        rows={2}
        placeholder={open === "log" ? "Kết quả trao đổi" : "Ghi chú (không bắt buộc)"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {open === "remind" && (
        <label className="flex items-center gap-2 text-sm">
          Ngày nhắc
          <input type="date" className="rounded-lg border border-beige-dark bg-white px-2 py-1" min={todayVn()} value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
      )}
      {error && <p className="text-xs text-[#8A2323]">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary px-4 py-1.5" disabled={busy} onClick={save}>{busy ? "Đang lưu…" : "Lưu"}</button>
        <button className="btn-ghost py-1.5" disabled={busy} onClick={() => setOpen(null)}>Huỷ</button>
      </div>
    </div>
  );
}
