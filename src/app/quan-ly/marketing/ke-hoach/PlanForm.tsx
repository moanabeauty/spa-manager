"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { todayVn, vnDateTime, vnError } from "@/lib/format";
import { vnDayOf } from "@/lib/calendar";
import { PLAN_KIND, type MkPerson, type MkPlan } from "@/lib/marketing";

const hhmm = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

export default function PlanForm({ plan, people, me, isOwner, defaultDate, places }: {
  plan: MkPlan | null; people: MkPerson[]; me: string; isOwner: boolean; defaultDate: string; places: string[];
}) {
  const router = useRouter();
  const [kind, setKind] = useState(plan?.kind ?? "video");
  const [title, setTitle] = useState(plan?.title ?? "");
  const [date, setDate] = useState(plan ? vnDayOf(plan.start_at) : defaultDate || todayVn());
  const [start, setStart] = useState(plan ? hhmm(plan.start_at) : "09:00");
  const [end, setEnd] = useState(plan?.end_at ? hhmm(plan.end_at) : "");
  const [location, setLocation] = useState(plan?.location ?? "");
  const [pic, setPic] = useState(plan ? plan.pic_id ?? "" : me);
  const [note, setNote] = useState(plan?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const canDelete = !!plan && (isOwner || plan.created_by === me);

  async function save(status?: string, ok = "Đã lưu.") {
    if (!title.trim()) return setMsg({ ok: false, t: "Vui lòng nhập tên buổi quay / chụp / họp." });
    if (!date || !start) return setMsg({ ok: false, t: "Chọn ngày và giờ bắt đầu." });
    if (end && end < start) return setMsg({ ok: false, t: "Giờ kết thúc phải sau giờ bắt đầu." });
    setBusy(true);
    setMsg(null);
    const row: Record<string, unknown> = {
      kind,
      title: title.trim(),
      start_at: vnDateTime(date, start).toISOString(),
      end_at: end ? vnDateTime(date, end).toISOString() : null,
      location: location.trim() || null,
      pic_id: pic || null,
      note: note.trim() || null,
    };
    if (status) row.status = status;
    const supabase = createClient();
    if (plan) {
      const { error } = await supabase.from("marketing_plans").update(row).eq("id", plan.id);
      setBusy(false);
      if (error) return setMsg({ ok: false, t: vnError(error.message) });
      setMsg({ ok: true, t: ok });
      router.refresh();
    } else {
      const { data, error } = await supabase.from("marketing_plans").insert(row).select("id").single();
      setBusy(false);
      if (error || !data) return setMsg({ ok: false, t: vnError(error?.message) });
      router.push(`/quan-ly/marketing/ke-hoach/${data.id}`);
    }
  }

  async function remove() {
    if (!plan || !confirm("Xoá hẳn kế hoạch này (cả phần trao đổi)?")) return;
    setBusy(true);
    const { error } = await createClient().from("marketing_plans").delete().eq("id", plan.id);
    setBusy(false);
    if (error) return setMsg({ ok: false, t: vnError(error.message) });
    router.push("/quan-ly/marketing/ke-hoach");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-4">
        <div>
          <label className="label">Loại</label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(PLAN_KIND).map(([k, v]) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${kind === k ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}
              >
                {v.icon} {v.t}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Tên buổi *</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === "meeting" ? "VD: Họp content tháng 12" : "VD: Quay video quy trình Glow MN"}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Ngày</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Bắt đầu</label>
            <input type="time" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className="label">Kết thúc</label>
            <input type="time" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Địa điểm</label>
            <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Chi nhánh, studio, online…" list="mk-places" />
            <datalist id="mk-places">
              {places.map((p) => (
                <option key={p} value={p} />
              ))}
              <option value="Online (Google Meet / Zalo)" />
            </datalist>
          </div>
          <div>
            <label className="label">Người phụ trách</label>
            <select className="input" value={pic} onChange={(e) => setPic(e.target.value)}>
              <option value="">— Chưa giao —</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name ?? "(chưa có tên)"}{p.id === me ? " (tôi)" : ""}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label">{kind === "meeting" ? "Nội dung họp" : "Kịch bản / chuẩn bị"}</label>
          <textarea
            className="input min-h-[140px]"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              kind === "meeting"
                ? "Chủ đề cần bàn, bài cần chốt, ai tham gia…"
                : "Cảnh quay, KTV / mẫu tham gia, đạo cụ, sản phẩm cần chuẩn bị, link kịch bản…"
            }
          />
        </div>
      </div>

      {msg && <p className={`card p-3 text-sm ${msg.ok ? "text-[#22612A]" : "text-[#8A2323]"}`}>{msg.t}</p>}

      <div className="card flex flex-wrap items-center gap-2 p-3">
        {!plan ? (
          <button className="btn-primary" disabled={busy} onClick={() => save()}>Tạo kế hoạch</button>
        ) : (
          <>
            <button className="btn-primary" disabled={busy} onClick={() => save()}>Lưu thay đổi</button>
            {plan.status !== "done" && (
              <button className="btn-outline" disabled={busy} onClick={() => save("done", "Đã đánh dấu xong.")}>✓ Đã xong</button>
            )}
            {plan.status === "planned" ? (
              <button className="btn-ghost" disabled={busy} onClick={() => save("cancelled", "Đã huỷ buổi.")}>Huỷ buổi</button>
            ) : (
              <button className="btn-ghost" disabled={busy} onClick={() => save("planned", "Đã chuyển về Sắp tới.")}>Chuyển về Sắp tới</button>
            )}
            {canDelete && (
              <button className="btn-ghost ml-auto text-[#B3261E]" disabled={busy} onClick={remove}>Xoá</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
