"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";
import { NEED_TAGS, SKIN_COLORS, SKIN_CRITERIA, SkinDot, type SkinColor, type SkinRecord } from "@/lib/skin";

const RECALL_CHOICES = [7, 14, 21, 28, 30, 45, 60, 90];

export default function SkinRecordForm({
  customerId,
  appointmentId,
  branchId,
  existing,
  backHref,
  canDelete,
}: {
  customerId: string;
  appointmentId: string | null;
  branchId: string | null;
  existing: SkinRecord | null;
  backHref: string;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [overall, setOverall] = useState<SkinColor | "">(existing?.overall ?? "");
  const [criteria, setCriteria] = useState<Record<string, SkinColor>>(existing?.criteria ?? {});
  const [tags, setTags] = useState<string[]>(existing?.need_tags ?? []);
  const [needs, setNeeds] = useState(existing?.customer_needs ?? "");
  const [reaction, setReaction] = useState(existing?.reaction ?? "");
  const [recommendation, setRecommendation] = useState(existing?.recommendation ?? "");
  const [homecare, setHomecare] = useState(existing?.homecare ?? "");
  const [nextDays, setNextDays] = useState<string>(existing?.next_visit_days ? String(existing.next_visit_days) : "");
  const [internal, setInternal] = useState(existing?.internal_note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setCrit(key: string, c: SkinColor) {
    setCriteria((prev) => {
      const next = { ...prev };
      if (next[key] === c) delete next[key];
      else next[key] = c;
      return next;
    });
  }
  function toggleTag(t: string) {
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  async function save() {
    setError(null);
    if (!overall) return setError("Vui lòng chọn màu tổng thể của da (Xanh / Vàng / Đỏ).");
    if (overall === "red" && !reaction.trim() && !recommendation.trim())
      return setError("Phiếu đỏ: vui lòng ghi phản ứng da hoặc hướng xử lý để lễ tân gọi hỏi thăm.");
    const days = nextDays ? Number(nextDays) : null;
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) return setError("Số ngày hẹn quay lại từ 1 đến 365.");
    setSaving(true);
    const supabase = createClient();
    const payload = {
      overall,
      criteria,
      need_tags: tags,
      customer_needs: needs,
      reaction,
      recommendation,
      homecare,
      next_visit_days: days,
      internal_note: internal,
    };
    let res;
    if (existing) {
      res = await supabase.from("skin_records").update(payload).eq("id", existing.id);
    } else {
      const { data: auth } = await supabase.auth.getUser();
      res = await supabase.from("skin_records").insert({
        ...payload,
        customer_id: customerId,
        appointment_id: appointmentId,
        branch_id: branchId,
        created_by: auth.user?.id,
        technician_id: auth.user?.id,
      });
    }
    setSaving(false);
    if (res.error) {
      if (res.error.message.includes("skin_records_appointment_id_key")) return setError("Lịch hẹn này đã có phiếu da. Tải lại trang để sửa phiếu.");
      return setError(vnError(res.error.message));
    }
    router.push(backHref);
    router.refresh();
  }

  async function remove() {
    if (!existing || !window.confirm("Xoá phiếu theo dõi da này?")) return;
    setSaving(true);
    const { error: e } = await createClient().from("skin_records").delete().eq("id", existing.id);
    setSaving(false);
    if (e) return setError(vnError(e.message));
    router.push(backHref);
    router.refresh();
  }

  return (
    <div className="space-y-4 pb-24">
      {/* Màu tổng thể */}
      <section className="card">
        <h2 className="mb-1 font-semibold text-navy">1. Tình trạng da tổng thể sau buổi</h2>
        <p className="mb-3 text-xs text-ink/60">Phiếu đỏ sẽ tự tạo nhắc lễ tân gọi hỏi thăm khách vào ngày hôm sau.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {SKIN_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setOverall(c.key)}
              className={`flex items-center gap-3 rounded-xl border-2 p-3 text-left transition ${
                overall === c.key ? `${c.soft} ${c.text} border-current` : "border-beige-dark bg-white hover:border-navy"
              }`}
            >
              <SkinDot color={c.key} size="h-6 w-6" />
              <span className="text-sm font-semibold">{c.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Từng mục */}
      <section className="card">
        <h2 className="mb-1 font-semibold text-navy">2. Đánh giá từng vấn đề <span className="font-normal text-ink/50">(bấm màu, bấm lại để bỏ)</span></h2>
        <ul className="divide-y divide-beige">
          {SKIN_CRITERIA.map((x) => (
            <li key={x.key} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm">{x.label}</span>
              <span className="flex gap-1.5">
                {SKIN_COLORS.map((c) => {
                  const on = criteria[x.key] === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setCrit(x.key, c.key)}
                      aria-label={`${x.label}: ${c.short}`}
                      className={`flex h-9 min-w-14 items-center justify-center gap-1 rounded-full border px-2 text-xs font-semibold transition ${
                        on ? `${c.soft} ${c.text} border-current` : "border-beige-dark bg-white text-ink/40"
                      }`}
                    >
                      <SkinDot color={on ? c.key : null} size="h-2.5 w-2.5" />
                      {c.short}
                    </button>
                  );
                })}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Nhu cầu */}
      <section className="card">
        <h2 className="mb-3 font-semibold text-navy">3. Nhu cầu của khách</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {NEED_TAGS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggleTag(t)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${tags.includes(t) ? "bg-navy text-white" : "bg-cream text-navy ring-1 ring-beige-dark"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <textarea
          className="input min-h-20"
          placeholder="Khách mong muốn gì, lo lắng điều gì, sự kiện sắp tới (cưới, du lịch…), ngân sách…"
          value={needs}
          maxLength={1000}
          onChange={(e) => setNeeds(e.target.value)}
        />
      </section>

      {/* Sau buổi */}
      <section className="card space-y-3">
        <h2 className="font-semibold text-navy">4. Sau buổi làm</h2>
        <div>
          <label className="label">Phản ứng da (đỏ, rát, bong, kích ứng…) – chỉ nhân viên thấy</label>
          <textarea className="input min-h-16" value={reaction} maxLength={1000} onChange={(e) => setReaction(e.target.value)} />
        </div>
        <div>
          <label className="label">Đề xuất buổi sau / liệu trình phù hợp</label>
          <textarea className="input min-h-16" value={recommendation} maxLength={1000} onChange={(e) => setRecommendation(e.target.value)} />
        </div>
        <div>
          <label className="label">Hướng dẫn chăm sóc tại nhà</label>
          <textarea
            className="input min-h-16"
            placeholder="Kiêng nắng, dùng kem chống nắng, sản phẩm dưỡng…"
            value={homecare}
            maxLength={1000}
            onChange={(e) => setHomecare(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Hẹn quay lại sau (ngày) – tự tạo nhắc mời khách quay lại</label>
          <div className="flex flex-wrap gap-2">
            {RECALL_CHOICES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setNextDays(nextDays === String(d) ? "" : String(d))}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${nextDays === String(d) ? "bg-navy text-white" : "bg-cream text-navy ring-1 ring-beige-dark"}`}
              >
                {d} ngày
              </button>
            ))}
            <input
              className="input w-28 py-1.5 text-sm"
              inputMode="numeric"
              placeholder="Số khác"
              value={nextDays}
              onChange={(e) => setNextDays(e.target.value.replace(/\D/g, ""))}
            />
          </div>
        </div>
        <div>
          <label className="label">Ghi chú nội bộ (khách không thấy)</label>
          <textarea className="input min-h-16" value={internal} maxLength={1000} onChange={(e) => setInternal(e.target.value)} />
        </div>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-beige-dark bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <div className="flex-1 text-sm">
            {error ? <p className="text-xs font-medium text-[#8A2323]">{error}</p> : <span className="text-ink/60">Khách thấy màu, đề xuất và hướng dẫn tại nhà trong tài khoản của họ.</span>}
          </div>
          {existing && canDelete && (
            <button className="btn-ghost text-[#8A2323]" disabled={saving} onClick={remove}>Xoá</button>
          )}
          <button className="btn-primary px-6 py-3" disabled={saving} onClick={save}>
            {saving ? "Đang lưu…" : existing ? "Lưu thay đổi" : "Lưu phiếu da"}
          </button>
        </div>
      </div>
    </div>
  );
}
