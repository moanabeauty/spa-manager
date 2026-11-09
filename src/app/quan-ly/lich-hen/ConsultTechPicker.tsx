"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";
import { techLabel, type Technician } from "@/lib/staff";

/** KTV tư vấn của lịch "Chưa chọn liệu trình – Hẹn tư vấn" (đổi được khi lịch còn mở) */
export default function ConsultTechPicker({
  id,
  current,
  locked,
  technicians,
  branches,
}: {
  id: string;
  current: string | null;
  locked: boolean;
  technicians: Technician[];
  branches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cur = technicians.find((t) => t.id === current);

  if (locked) {
    return <p className="text-xs text-ink/60">KTV tư vấn: {cur ? techLabel(cur, branches) : current ? "(tài khoản đã khoá)" : "—"}</p>;
  }

  async function change(v: string) {
    if (!v) return;
    const prev = value;
    setValue(v);
    setSaving(true);
    setError(null);
    const { error: e } = await createClient().from("appointments").update({ consult_technician_id: v }).eq("id", id);
    setSaving(false);
    if (e) {
      setValue(prev);
      return setError(vnError(e.message));
    }
    router.refresh();
  }

  return (
    <div>
      <label className="flex items-center gap-2 text-xs text-ink/60">
        KTV tư vấn
        <select className="flex-1 rounded-lg border border-beige-dark bg-white px-2 py-1.5 text-sm" value={value} disabled={saving} onChange={(e) => change(e.target.value)}>
          {!value && <option value="">— Chưa có KTV —</option>}
          {current && !cur && <option value={current}>(tài khoản đã khoá)</option>}
          {technicians.map((t) => (
            <option key={t.id} value={t.id}>{techLabel(t, branches)}</option>
          ))}
        </select>
        {saving && <span>…</span>}
      </label>
      {error && <p className="mt-1 text-xs text-[#8A2323]">{error}</p>}
    </div>
  );
}
