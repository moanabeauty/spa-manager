"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatTime, todayVn, vnDayOf, vnError } from "@/lib/format";
import { weekdayShort } from "@/lib/ktv";

export type OpenBooking = {
  appointment_id: string;
  start_at: string;
  end_at: string | null;
  customer_name: string;
  services: string;
  is_consultation: boolean;
  source: string;
  note: string | null;
};

const SOURCE: Record<string, string> = { online: "Khách tự đặt", phone: "Lễ tân đặt", staff: "Nhân viên đặt", walk_in: "Vãng lai" };

/** Lịch chưa có KTV nào nhận ở chi nhánh: KTV bấm "Xác nhận – nhận khách" thì khách thuộc về KTV đó */
export default function OpenBookings({ rows }: { rows: OpenBooking[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; msg: string } | null>(null);
  const today = todayVn();
  if (rows.length === 0) return null;

  async function take(id: string) {
    setBusy(id);
    setError(null);
    const { error: e } = await createClient().rpc("confirm_appointment", { p_appt: id, p_technician_id: null });
    setBusy(null);
    if (e) {
      setError({ id, msg: vnError(e.message) });
      router.refresh();
      return;
    }
    router.push(`/quan-ly/ktv/lich/${id}`);
  }

  return (
    <section className="space-y-2.5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[17px] font-bold">Lịch chờ nhận</h2>
        <span className="text-[13px] text-[#646464]">{rows.length} lịch chưa có KTV</span>
      </div>
      <ul className="space-y-2.5">
        {rows.map((r) => {
          const day = vnDayOf(r.start_at);
          return (
            <li key={r.appointment_id} className="rounded-[14px] border-2 border-dashed border-[#A0845E] bg-white p-3.5">
              <div className="flex gap-3">
                <span className="w-[52px] shrink-0 text-navy">
                  <b className="block text-[15px]">{formatTime(r.start_at)}</b>
                  <span className="text-[11px] text-[#646464]">{day === today ? "Hôm nay" : weekdayShort(day)}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{r.customer_name}</span>
                  <span className="block text-[13px] text-[#646464]">
                    {r.is_consultation ? "Chưa chọn liệu trình · hẹn tư vấn" : r.services}
                  </span>
                  <span className="block text-xs text-[#646464]">{SOURCE[r.source] ?? r.source}</span>
                  {r.note && <span className="mt-1 block rounded-lg bg-[#EEE5D6] px-2 py-1 text-xs">Ghi chú: {r.note}</span>}
                </span>
              </div>
              {error?.id === r.appointment_id && <p className="mt-2 text-xs text-[#B3261E]">{error.msg}</p>}
              <button
                className="mt-3 min-h-11 w-full rounded-xl bg-navy text-sm font-semibold text-white disabled:opacity-50"
                disabled={busy !== null}
                onClick={() => take(r.appointment_id)}
              >
                {busy === r.appointment_id ? "Đang nhận…" : "Xác nhận – nhận khách này"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
