"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";

type Action = { to: string; label: string; style: "primary" | "outline" | "danger" };

const ACTIONS: Record<string, Action[]> = {
  // "Chờ xác nhận" dùng ConfirmAppointment (bắt buộc chọn KTV)
  confirmed: [
    { to: "in_progress", label: "Khách đã đến", style: "primary" },
    { to: "no_show", label: "Không đến", style: "danger" },
    { to: "cancelled", label: "Huỷ", style: "danger" },
  ],
  in_progress: [{ to: "completed", label: "Hoàn thành", style: "primary" }],
  cancelled: [{ to: "pending", label: "Mở lại", style: "outline" }],
  no_show: [{ to: "confirmed", label: "Mở lại", style: "outline" }],
  completed: [],
};

const STYLE = {
  primary: "btn-primary py-2",
  outline: "btn-outline py-2",
  danger: "btn-ghost py-2 text-[#8A2323]",
};

export default function StatusActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actions = ACTIONS[status] ?? [];
  if (actions.length === 0) return null;

  async function run(to: string) {
    if ((to === "cancelled" || to === "no_show") && !window.confirm("Xác nhận đổi trạng thái lịch hẹn này?")) return;
    setBusy(to);
    setError(null);
    const { error } = await createClient().from("appointments").update({ status: to }).eq("id", id);
    setBusy(null);
    if (error) return setError(vnError(error.message));
    router.refresh();
  }

  return (
    <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-beige pt-3">
      {error && <p className="mr-auto text-xs text-[#8A2323]">{error}</p>}
      {actions.map((a) => (
        <button key={a.to} className={STYLE[a.style]} disabled={busy !== null} onClick={() => run(a.to)}>
          {busy === a.to ? "…" : a.label}
        </button>
      ))}
    </div>
  );
}
