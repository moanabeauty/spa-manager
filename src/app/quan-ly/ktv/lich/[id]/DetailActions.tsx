"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";
import ServicePicker, { type Pick, type PickService } from "../../ServicePicker";

/** Thanh nút cuối màn chi tiết lịch: Quy trình liệu trình + Xác nhận lịch (hoặc chọn liệu trình cho lịch tư vấn) */
export default function DetailActions({
  appointmentId,
  confirmed,
  autoTime,
  procedureHref,
  consult,
  customerId,
  branchId,
  services,
  closed,
}: {
  appointmentId: string;
  confirmed: boolean;
  autoTime: string;
  procedureHref: string | null;
  consult: boolean;
  customerId: string;
  branchId: string;
  services: PickService[];
  closed: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState<Pick | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    const { error: e } = await createClient().rpc("ktv_confirm", { p_appt: appointmentId });
    setBusy(false);
    if (e) return setError(vnError(e.message));
    router.refresh();
  }

  async function savePick() {
    if (!pick) return setError("Vui lòng chọn liệu trình.");
    setBusy(true);
    setError(null);
    const { data, error: e } = await createClient().rpc("ktv_pick_service", {
      p_appt: appointmentId,
      p_service_id: pick.serviceId,
      p_package_item_id: pick.itemId,
    });
    setBusy(false);
    if (e) return setError(vnError(e.message));
    router.push(`/quan-ly/ktv/lieu-trinh/${data as string}`);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#E6DDCC] bg-white px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
      <div className="mx-auto max-w-3xl space-y-2">
        {picking && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Chọn liệu trình cho khách</p>
            <ServicePicker customerId={customerId} branchId={branchId} services={services} value={pick} onChange={setPick} />
          </div>
        )}
        {!confirmed && !closed && <p className="text-center text-xs text-[#646464]">Nếu chưa xác nhận, hệ thống tự nhận lịch lúc {autoTime}</p>}
        {error && <p className="text-center text-xs text-[#B3261E]">{error}</p>}
        <div className="flex gap-2.5">
          {consult && !closed ? (
            picking ? (
              <>
                <button className="min-h-[52px] flex-1 rounded-[14px] border-[1.5px] border-navy text-[15px] font-semibold text-navy" onClick={() => setPicking(false)}>
                  Huỷ
                </button>
                <button className="min-h-[52px] flex-1 rounded-[14px] bg-navy text-[15px] font-semibold text-white disabled:opacity-50" disabled={busy || !pick} onClick={savePick}>
                  {pick ? `Làm ${pick.label}` : "Chọn liệu trình"}
                </button>
              </>
            ) : (
              <button className="min-h-[52px] flex-1 rounded-[14px] border-[1.5px] border-navy text-[15px] font-semibold text-navy" onClick={() => setPicking(true)}>
                Chọn liệu trình
              </button>
            )
          ) : procedureHref ? (
            <Link href={procedureHref} className="flex min-h-[52px] flex-1 items-center justify-center rounded-[14px] border-[1.5px] border-navy text-[15px] font-semibold text-navy">
              Quy trình liệu trình
            </Link>
          ) : null}
          {!picking && !closed && (
            confirmed ? (
              <span className="flex min-h-[52px] flex-1 items-center justify-center rounded-[14px] bg-[#E4F2E9] text-[15px] font-semibold text-[#1F5E3A]">✓ Đã nhận lịch</span>
            ) : (
              <button className="min-h-[52px] flex-1 rounded-[14px] bg-navy text-[15px] font-semibold text-white disabled:opacity-50" disabled={busy} onClick={confirm}>
                Xác nhận lịch
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
