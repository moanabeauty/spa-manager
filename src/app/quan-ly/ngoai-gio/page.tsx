import { payrollSettings } from "@/lib/refData";
import { getCurrentUser } from "@/lib/supabase/server";
import { todayVn } from "@/lib/format";
import type { MyDayRow } from "@/lib/ktv";
import OffHoursForm from "./OffHoursForm";

export const metadata = { title: "Chấm công ngoài giờ – Moana Beauty" };

/** Chấm VÀO trước 8:30 hoặc chấm RA sau 18:30: bắt buộc ghi lý do gửi quản lý duyệt */
export default async function OffHoursPage({ searchParams }: { searchParams: Promise<{ kieu?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  if (!profile) return null;
  const sp = await searchParams;
  const kind = sp.kieu === "vao" ? "vao" : "ra";
  const [{ data: rows }, { data: cfg }] = await Promise.all([
    supabase.rpc("ktv_my_day", { p_date: todayVn() }),
    payrollSettings(),
  ]);
  const v = (cfg?.value ?? {}) as { shift_end?: string; shift_start?: string; ot_start?: string; early_start?: string };
  const customers = ((rows ?? []) as MyDayRow[]).map((r) => ({
    id: r.appointment_id,
    name: r.customer_name,
    detail: r.is_consultation ? "Tư vấn" : r.services,
    start_at: r.start_at,
    end_at: r.end_at,
  }));
  return (
    <OffHoursForm
      kind={kind}
      shiftStart={v.shift_start ?? "09:00"}
      shiftEnd={v.shift_end ?? "18:00"}
      otStart={v.ot_start ?? "18:30"}
      earlyStart={v.early_start ?? "08:30"}
      customers={customers}
    />
  );
}
