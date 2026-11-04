"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";

export default function CapacityEditor({ branchId, branchName, current }: { branchId: string; branchName: string; current: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(String(current));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const { error: e } = await createClient().rpc("set_branch_capacity", { p_branch: branchId, p_cap: Number(val) });
    setBusy(false);
    if (e) return setError(vnError(e.message));
    setOpen(false);
    router.refresh();
  }

  if (!open)
    return (
      <button className="text-xs text-navy underline" onClick={() => setOpen(true)}>
        Sửa số khách / ca
      </button>
    );
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      {branchName}: tối đa
      <input className="input w-16 px-2 py-1 text-sm" inputMode="numeric" value={val} onChange={(e) => setVal(e.target.value.replace(/\D/g, ""))} />
      khách cùng lúc
      <button className="btn-primary px-3 py-1" disabled={busy} onClick={save}>Lưu</button>
      <button className="btn-ghost px-2 py-1" onClick={() => setOpen(false)}>Huỷ</button>
      {error && <span className="text-[#8A2323]">{error}</span>}
    </span>
  );
}
