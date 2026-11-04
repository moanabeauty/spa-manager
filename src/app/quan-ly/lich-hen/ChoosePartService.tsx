"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";

/** Phần gói "các loại" (vd Peel 1.900k): KTV / lễ tân chọn loại cụ thể khách làm */
export default function ChoosePartService({ rowId, options }: { rowId: string; options: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(serviceId: string) {
    if (!serviceId) return;
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("choose_package_service", { p_row: rowId, p_service: serviceId });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    router.refresh();
  }

  return (
    <div className="mt-1">
      <select className="w-full rounded-lg border border-[#E0A526] bg-[#FFE8BA]/40 px-2 py-1.5 text-xs" value="" disabled={busy} onChange={(e) => choose(e.target.value)}>
        <option value="">⚠ Chọn loại cụ thể khách làm…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
      {error && <p className="text-xs text-[#8A2323]">{error}</p>}
    </div>
  );
}
