"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatTime, nowVnHHMM, vnError } from "@/lib/format";
import { getPosition } from "@/lib/geo";
import { EARLY_START } from "@/lib/ktv";

type Att = { check_in: string; check_out: string | null; approval_status?: string; approval_reason?: string | null } | null;

/** Nhân viên bấm check-in khi đến, check-out khi về (giờ lấy theo máy chủ) */

export default function CheckInBar({ today, otStart = "18:30" }: { today: Att; otStart?: string }) {
  const router = useRouter();
  const [att, setAtt] = useState<Att>(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: "check_in" | "check_out") {
    // vào trước 8:30 / ra sau giờ tăng ca: bắt buộc ghi lý do ở form riêng
    if (fn === "check_in" && nowVnHHMM() < EARLY_START) return router.push("/quan-ly/ngoai-gio?kieu=vao");
    if (fn === "check_out" && nowVnHHMM() > otStart) return router.push("/quan-ly/ngoai-gio?kieu=ra");
    if (fn === "check_out" && att?.check_out && !confirm(`Bạn đã check-out lúc ${formatTime(att.check_out)}. Check-out lại bằng giờ hiện tại?`)) return;
    setBusy(true);
    setError(null);
    const pos = await getPosition();
    const { data, error } = await createClient().rpc(fn === "check_in" ? "check_in_v2" : "check_out_v2", { p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null });
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
          {att.approval_status === "pending" && (
            <span className="block text-xs text-[#7A5600]">⏳ Chờ chủ spa duyệt: {att.approval_reason}</span>
          )}
          {att.approval_status === "rejected" && <span className="block text-xs text-[#8A2323]">Chủ spa không duyệt ngày công này</span>}
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
      <a href="/quan-ly/nghi-phep" className="w-full text-xs text-navy underline sm:w-auto">Đăng ký nghỉ phép</a>
      {busy && <span className="w-full text-xs text-ink/60">Đang lấy vị trí… (cho phép trình duyệt dùng vị trí nếu được hỏi)</span>}
      {error && <span className="w-full text-xs text-[#8A2323]">{error}</span>}
    </div>
  );
}
