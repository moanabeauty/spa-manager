"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatTime, vnError } from "@/lib/format";
import { getPosition } from "@/lib/geo";
import { OFFHOURS_REASONS, minutesBetween, nowVnHHMM } from "@/lib/ktv";

type Cust = { id: string; name: string; detail: string; start_at: string; end_at: string | null };

export default function OffHoursForm({
  kind,
  shiftStart,
  shiftEnd,
  otStart,
  earlyStart,
  customers,
}: {
  kind: "vao" | "ra";
  shiftStart: string;
  shiftEnd: string;
  otStart: string;
  earlyStart: string;
  customers: Cust[];
}) {
  const router = useRouter();
  const [now, setNow] = useState(nowVnHHMM());
  const [reason, setReason] = useState<string>(OFFHOURS_REASONS[0]);
  const [appt, setAppt] = useState<string | null>(customers.length === 1 ? customers[0].id : null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(nowVnHHMM()), 15000);
    return () => clearInterval(t);
  }, []);

  const isIn = kind === "vao";
  const outside = isIn ? now < earlyStart : now > otStart;
  const otMin = !isIn ? Math.max(0, minutesBetween(otStart, now)) : 0;
  const back = "/quan-ly";

  async function submit() {
    setError(null);
    if (outside && reason === "Làm cho khách" && customers.length > 0 && !appt) return setError("Chọn khách bạn đã làm.");
    if (outside && reason === "Khác" && !note.trim()) return setError("Ghi rõ lý do vào ô ghi chú.");
    setBusy(true);
    const pos = await getPosition();
    const { error: e } = await createClient().rpc(isIn ? "check_in_v2" : "check_out_v2", {
      p_lat: pos?.lat ?? null,
      p_lng: pos?.lng ?? null,
      p_reason_kind: outside ? reason : null,
      p_appointment: outside ? appt : null,
      p_note: outside ? note.trim() || null : null,
    });
    setBusy(false);
    if (e) return setError(vnError(e.message));
    router.push(back);
    router.refresh();
  }

  const pill = (on: boolean) =>
    `min-h-11 rounded-full px-3.5 text-sm ${on ? "bg-navy font-semibold text-white" : "bg-white text-black ring-1 ring-beige-dark"}`;

  return (
    <div className="-mx-4 -mt-6 pb-32">
      <div className="space-y-1.5 bg-navy px-5 pb-5 pt-4 text-white">
        <Link href={back} className="flex min-h-8 items-center text-sm text-beige-dark">‹ Huỷ</Link>
        <h1 className="text-xl font-bold">{isIn ? "Chấm vào ngoài giờ" : "Chấm ra ngoài giờ"}</h1>
        <p className="text-[13px] text-[#C9CADB]">
          {outside
            ? isIn
              ? `Bạn chấm vào lúc ${now}, trước ${earlyStart}. Hãy ghi lý do để quản lý duyệt.`
              : `Bạn chấm ra lúc ${now}, sau ${otStart}. Hãy ghi lý do tăng ca để quản lý duyệt.`
            : `Bây giờ là ${now}, trong giờ làm. Bạn có thể chấm công bình thường.`}
        </p>
      </div>

      <div className="space-y-3.5 px-4 pt-4">
        <div className="grid grid-cols-2 gap-2.5 rounded-[14px] bg-white p-3.5">
          <div>
            <p className="text-xs text-[#646464]">{isIn ? "Vào ca chuẩn" : "Hết ca chuẩn"}</p>
            <p className="text-[17px] font-bold">{isIn ? shiftStart : shiftEnd}</p>
          </div>
          <div>
            <p className="text-xs text-[#646464]">{isIn ? "Chấm vào" : "Chấm ra"}</p>
            <p className={`text-[17px] font-bold ${outside ? "text-[#B3261E]" : ""}`}>{now}</p>
          </div>
          {!isIn && outside && (
            <p className="col-span-2 rounded-[10px] bg-beige px-2.5 py-2 text-xs text-[#5E4B30]">
              Tăng ca chờ duyệt: <b>{otMin >= 60 ? `${Math.floor(otMin / 60)} giờ ${otMin % 60} phút` : `${otMin} phút`}</b> (tính từ {otStart}). Nếu chưa được duyệt thì không tính tăng ca.
            </p>
          )}
        </div>

        {outside && (
          <>
            <div className="space-y-2">
              <p className="text-[13px] font-semibold">{isIn ? "Lý do đến sớm" : "Lý do ở lại ngoài giờ"}</p>
              <div className="flex flex-wrap gap-2">
                {OFFHOURS_REASONS.map((r) => (
                  <button key={r} className={pill(reason === r)} onClick={() => setReason(r)}>{r}</button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[13px] font-semibold">Thông tin khách hàng</p>
              {customers.length === 0 && <p className="text-xs text-[#646464]">Hôm nay bạn chưa nhận khách nào.</p>}
              {customers.map((c) => {
                const on = appt === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setAppt(on ? null : c.id)}
                    className={`flex w-full items-center justify-between rounded-[14px] bg-white px-3.5 py-3 text-left ${on ? "ring-2 ring-navy" : "ring-1 ring-beige-dark"}`}
                  >
                    <span>
                      <b className="block text-[15px]">{c.name}</b>
                      <span className="text-xs text-[#646464]">
                        {c.detail} · {formatTime(c.start_at)}{c.end_at ? ` – ${formatTime(c.end_at)}` : ""}
                      </span>
                    </span>
                    {on && <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-navy text-xs text-white">✓</span>}
                  </button>
                );
              })}
              {customers.length > 0 && <p className="text-xs text-[#646464]">Danh sách lấy từ các khách bạn đã nhận trong ngày.</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="gc" className="text-[13px] font-semibold">Ghi chú thêm</label>
              <textarea id="gc" className="input min-h-16 py-2.5 text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="vd: Khách đến muộn 30 phút, làm đủ liệu trình." />
            </div>
          </>
        )}
      </div>

      <div className="action-bar fixed inset-x-0 z-40 border-t border-[#E6DDCC] bg-white px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto max-w-3xl space-y-1.5">
          {error && <p className="text-center text-xs text-[#B3261E]">{error}</p>}
          <button className="min-h-[52px] w-full rounded-[14px] bg-navy text-base font-semibold text-white disabled:opacity-50" disabled={busy} onClick={submit}>
            {busy ? "Đang lấy vị trí…" : outside ? (isIn ? "Chấm vào & gửi quản lý duyệt" : "Chấm ra & gửi quản lý duyệt") : isIn ? "Chấm vào" : "Chấm ra"}
          </button>
        </div>
      </div>
    </div>
  );
}
