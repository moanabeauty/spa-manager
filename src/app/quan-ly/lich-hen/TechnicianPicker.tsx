"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";
import { isBusy, techLabel, type Busy, type Technician } from "@/lib/staff";

/** Chọn / đổi kỹ thuật viên cho 1 dịch vụ trong lịch hẹn */
export default function TechnicianPicker({
  serviceRowId,
  current,
  start,
  end,
  locked,
  technicians,
  busy,
  branches,
}: {
  serviceRowId: string;
  current: string | null;
  start: string;
  end: string;
  locked: boolean;
  technicians: Technician[];
  busy: Busy[];
  branches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentTech = technicians.find((t) => t.id === current);

  if (locked) {
    return (
      <p className="mt-0.5 text-xs text-ink/60">
        KTV: {currentTech ? techLabel(currentTech, branches) : current ? "(tài khoản đã khoá)" : "—"}
      </p>
    );
  }

  async function change(v: string) {
    const prev = value;
    setValue(v);
    setError(null);
    setSaving(true);
    const { error } = await createClient()
      .from("appointment_services")
      .update({ technician_id: v || null })
      .eq("id", serviceRowId);
    setSaving(false);
    if (error) {
      setValue(prev);
      return setError(vnError(error.message));
    }
    router.refresh();
  }

  return (
    <div className="mt-1">
      <label className="flex items-center gap-2 text-xs text-ink/60">
        KTV
        <select
          className={`flex-1 rounded-lg border px-2 py-1.5 text-sm ${value ? "border-beige-dark bg-white" : "border-[#E0A526] bg-[#FFE8BA]/40"}`}
          value={value}
          disabled={saving}
          onChange={(e) => change(e.target.value)}
        >
          <option value="">— Chưa xếp KTV —</option>
          {current && !currentTech && <option value={current}>(tài khoản đã khoá)</option>}
          {technicians.map((t) => (
            <option key={t.id} value={t.id}>
              {techLabel(t, branches)}
              {t.id !== current && isBusy(busy, t.id, start, end, serviceRowId) ? " (bận)" : ""}
            </option>
          ))}
        </select>
        {saving && <span>…</span>}
      </label>
      {error && <p className="mt-1 text-xs text-[#8A2323]">{error}</p>}
    </div>
  );
}
