"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";
import { isBusy, techLabel, type Busy, type Technician } from "@/lib/staff";

/**
 * Xác nhận lịch "Chờ xác nhận" (lễ tân / quản lý / chủ).
 * Lịch còn dịch vụ / buổi tư vấn chưa có KTV -> bắt buộc chọn KTV ngay lúc xác nhận.
 */
export default function ConfirmAppointment({
  id,
  needTech,
  consult,
  start,
  end,
  technicians,
  busy,
  branches,
}: {
  id: string;
  needTech: boolean;
  consult: boolean;
  start: string;
  end: string;
  technicians: Technician[];
  busy: Busy[];
  branches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [tech, setTech] = useState("");
  const [saving, setSaving] = useState<"ok" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (needTech && !tech) return setError(consult ? "Chọn KTV tư vấn cho khách." : "Chọn KTV làm liệu trình cho khách.");
    setSaving("ok");
    setError(null);
    const { error: e } = await createClient().rpc("confirm_appointment", { p_appt: id, p_technician_id: tech || null });
    setSaving(null);
    if (e) return setError(vnError(e.message));
    router.refresh();
  }

  async function cancel() {
    if (!window.confirm("Huỷ lịch hẹn này?")) return;
    setSaving("cancel");
    setError(null);
    const { error: e } = await createClient().from("appointments").update({ status: "cancelled" }).eq("id", id);
    setSaving(null);
    if (e) return setError(vnError(e.message));
    router.refresh();
  }

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-[#E0A526] bg-[#FFF3D6]/50 p-3">
      <p className="text-sm font-semibold text-[#5C4100]">Chờ xác nhận</p>
      {needTech && (
        <label className="block text-xs text-ink/70">
          {consult ? "KTV tư vấn cho khách" : "KTV làm liệu trình"}
          <select className="input mt-1 py-2 text-sm" value={tech} onChange={(e) => setTech(e.target.value)} disabled={saving !== null}>
            <option value="">— Chọn KTV —</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {techLabel(t, branches)}
                {isBusy(busy, t.id, start, end) ? " (bận)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p className="text-xs text-[#8A2323]">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn-ghost py-2 text-[#8A2323]" disabled={saving !== null} onClick={cancel}>
          {saving === "cancel" ? "…" : "Huỷ lịch"}
        </button>
        <button className="btn-primary py-2" disabled={saving !== null} onClick={confirm}>
          {saving === "ok" ? "Đang xác nhận…" : "Xác nhận lịch"}
        </button>
      </div>
    </div>
  );
}
