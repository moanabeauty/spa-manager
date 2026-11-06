"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatTime, vnError } from "@/lib/format";
import { getPosition } from "@/lib/geo";
import { EARLY_START, OT_START, nowVnHHMM } from "@/lib/ktv";

export type TodayAtt = {
  check_in: string;
  check_out: string | null;
  in_distance_m: number | null;
  out_distance_m: number | null;
  approval_status: string | null;
  in_status: string | null;
  ot_status: string | null;
} | null;

/** Thẻ chấm công ở màn Hôm nay: vào trước 8:30 / ra sau 18:30 thì chuyển sang form ghi lý do */
export default function AttendanceCard({ today, radius }: { today: TodayAtt; radius: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "vao" | "ra") {
    setError(null);
    const now = nowVnHHMM();
    if (kind === "vao" && now < EARLY_START) return router.push("/quan-ly/ngoai-gio?kieu=vao");
    if (kind === "ra" && now > OT_START) return router.push("/quan-ly/ngoai-gio?kieu=ra");
    if (kind === "ra" && today?.check_out && !confirm(`Bạn đã chấm ra lúc ${formatTime(today.check_out)}. Chấm ra lại bằng giờ hiện tại?`)) return;
    setBusy(true);
    const pos = await getPosition();
    const { error: e } = await createClient().rpc(kind === "vao" ? "check_in_v2" : "check_out_v2", {
      p_lat: pos?.lat ?? null,
      p_lng: pos?.lng ?? null,
    });
    setBusy(false);
    if (e) return setError(vnError(e.message));
    router.refresh();
  }

  const dist = today?.check_out ? today.out_distance_m : today?.in_distance_m;
  const inRange = dist !== null && dist !== undefined && dist <= radius;

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] text-[#646464]">Chấm công</p>
          <p className="text-base font-semibold">
            {!today ? "Chưa chấm vào" : today.check_out ? `Đã ra lúc ${formatTime(today.check_out)}` : `Đã vào lúc ${formatTime(today.check_in)}`}
          </p>
          {today && dist !== null && dist !== undefined && (
            <p className={`text-xs ${inRange ? "text-[#2E7D4F]" : "text-[#B3261E]"}`}>
              {inRange ? `Trong phạm vi chi nhánh (${dist}m)` : `Cách chi nhánh ${dist}m · chờ quản lý duyệt`}
            </p>
          )}
          {today && (dist === null || dist === undefined) && today.approval_status === "pending" && (
            <p className="text-xs text-[#B3261E]">Không lấy được vị trí · chờ quản lý duyệt</p>
          )}
          {today?.in_status === "pending" && <p className="text-xs text-[#7A5600]">Chấm vào sớm: chờ quản lý duyệt</p>}
          {today?.ot_status === "pending" && <p className="text-xs text-[#7A5600]">Tăng ca: chờ quản lý duyệt</p>}
        </div>
        <button
          className="min-h-12 shrink-0 rounded-xl bg-brown px-5 text-[15px] font-semibold text-black disabled:opacity-50"
          disabled={busy}
          onClick={() => run(today ? "ra" : "vao")}
        >
          {busy ? "Đang lấy vị trí…" : !today ? "Chấm vào" : today.check_out ? "Chấm ra lại" : "Chấm ra"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-[#B3261E]">{error}</p>}
    </div>
  );
}
