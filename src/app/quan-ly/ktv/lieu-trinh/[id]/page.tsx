import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import type { ServiceGuide } from "@/components/ServiceGuideSections";
import { loadCustomerPhotos, photosRequired } from "@/lib/photos";
import ProcedureRunner, { type Change, type Step } from "./ProcedureRunner";

export const metadata = { title: "Quy trình liệu trình – Moana Beauty" };

type Row = {
  id: string;
  appointment_id: string;
  technician_id: string | null;
  start_at: string;
  end_at: string;
  work_started_at: string | null;
  work_done_at: string | null;
  steps_done: number;
  step_log: { step: number; at: string }[];
  services: { id: string; name: string; name_en: string | null; duration_minutes: number } | null;
  appointments: { status: string; customer_id: string; photo_skip_reason: string | null; customers: { full_name: string } | null } | null;
};

/** Quy trình liệu trình: quy trình gốc từng bước kèm sản phẩm; Bắt đầu / Xong bước / Hoàn thành */
export default async function ProcedurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await getCurrentUser();
  if (profile?.role === "marketing") redirect("/quan-ly/marketing"); // Marketing không xem khách hàng
  if (!profile) return null;
  const { data } = await supabase
    .from("appointment_services")
    .select(
      "id, appointment_id, technician_id, start_at, end_at, work_started_at, work_done_at, steps_done, step_log, services(id, name, name_en, duration_minutes), appointments(status, customer_id, photo_skip_reason, customers(full_name))",
    )
    .eq("id", id)
    .maybeSingle();
  const row = data as unknown as Row | null;
  const allowed = row && (profile.role !== "technician" || row.technician_id === profile.id);
  if (!row || !allowed) {
    return (
      <div className="card text-sm">
        Không tìm thấy liệu trình của bạn. <Link href="/quan-ly" className="font-semibold text-navy underline">Về Hôm nay</Link>
      </div>
    );
  }
  const [{ data: steps }, { data: changes }, { data: guide }, photoSessions, needPhotos] = await Promise.all([
    supabase
      .from("service_procedure_steps")
      .select("step_no, title, products, instructions, note")
      .eq("service_id", row.services?.id ?? "")
      .order("step_no"),
    supabase
      .from("procedure_change_requests")
      .select("id, step_no, from_product, to_product, reason, status, review_note")
      .eq("appointment_service_id", id)
      .order("created_at"),
    supabase
      .from("service_guides")
      .select("indication, indication_ext, consult_guide")
      .eq("service_id", row.services?.id ?? "")
      .maybeSingle(),
    loadCustomerPhotos(supabase, row.appointments?.customer_id ?? "", row.appointment_id),
    photosRequired(supabase, row.services?.id ? [row.services.id] : []),
  ]);
  const planned = Math.round((new Date(row.end_at).getTime() - new Date(row.start_at).getTime()) / 60000);

  return (
    <ProcedureRunner
      apsId={row.id}
      backHref={`/quan-ly/ktv/lich/${row.appointment_id}`}
      customerName={row.appointments?.customers?.full_name ?? "Khách"}
      serviceName={row.services?.name_en || row.services?.name || "Liệu trình"}
      plannedMinutes={planned || row.services?.duration_minutes || 60}
      startedAt={row.work_started_at}
      doneAt={row.work_done_at}
      stepsDone={row.steps_done}
      stepLog={row.step_log ?? []}
      steps={(steps ?? []) as Step[]}
      changes={(changes ?? []) as Change[]}
      guide={(guide ?? null) as ServiceGuide | null}
      closed={["cancelled", "no_show"].includes(row.appointments?.status ?? "")}
      appointmentId={row.appointment_id}
      photos={photoSessions[0]?.photos ?? []}
      photosRequired={needPhotos}
      photoSkipReason={row.appointments?.photo_skip_reason ?? null}
      photosEditable={profile.role === "owner" || profile.role === "manager" || (row.technician_id === profile.id && row.appointments?.status !== "completed")}
    />
  );
}
