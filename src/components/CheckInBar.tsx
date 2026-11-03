"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatTime, vnError } from "@/lib/format";

type Att = { check_in: string; check_out: string | null } | null;

/** Nhân viên bấm check-in khi đến, check-out khi về (giờ lấy theo máy chủ) */
export default function CheckInBar({ today }: { today: Att }) {
  const router = useRouter();
  const [att, setAtt] = useState<Att>(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: "check_in" | "check_out") {
    if (fn === "check_out" && att?.check_out && !confirm(`Bạn đã check-out lúc ${formatTime(att.check_out)}. Check-out lại bằng giờ hiện tại?`)) return;
    setBusy(true);
    setError(null);
    const { data, error } = await createClient().rpc(fn);
    setBusy(false);
    if (error) return setError(vnError(error.message));
    setAtt(data as Att);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm ring-1 ring-beige-dark print:hidden">
      <span className="font-semibold text-navy">Chấm công hôm nay:</span>
      {!att && <span className="text-ink/60">chưa check-in</span>}
      {att && (
        <span>
          vào {formatTime(att.check_in)}
          {att.check_out ? ` · về ${formatTime(att.check_out)}` : ""}
        </span>
      )}
      <span className="flex-1" />
      {!att ? (
        <button className="btn-primary py-1.5" disabled={busy} onClick={() => run("check_in")}>Check-in</button>
      ) : (
        <button className={att.check_out ? "btn-ghost py-1.5 text-xs" : "btn-outline py-1.5"} disabled={busy} onClick={() => run("check_out")}>
          {att.check_out ? "Check-out lại" : "Check-out"}
        </button>
      )}
      {error && <span className="w-full text-xs text-[#8A2323]">{error}</span>}
    </div>
  );
}
