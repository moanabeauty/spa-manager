"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ROLE_LABEL, vnError } from "@/lib/format";

/** Người kiêm nhiều vai trò (VD: KTV + kho) chuyển qua lại giữa các giao diện */
export default function RoleSwitcher({ roles, active }: { roles: string[]; active: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (roles.length < 2) return null;

  async function pick(r: string) {
    if (r === active || busy) return;
    setBusy(true);
    setErr(null);
    const { error } = await createClient().rpc("set_active_role", { p_role: r });
    setBusy(false);
    if (error) return setErr(vnError(error.message));
    router.push("/quan-ly");
    router.refresh();
  }

  return (
    <div className="card flex flex-wrap items-center gap-2 p-3">
      <span className="text-xs font-semibold text-ink/60">Đang làm việc với vai trò:</span>
      {roles.map((r) => (
        <button
          key={r}
          disabled={busy}
          onClick={() => pick(r)}
          className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
            r === active ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"
          }`}
        >
          {ROLE_LABEL[r] ?? r}
        </button>
      ))}
      {err && <p className="w-full text-xs text-[#8A2323]">{err}</p>}
    </div>
  );
}
