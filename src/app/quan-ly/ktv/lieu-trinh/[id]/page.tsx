import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import type { ServiceGuide } from "@/components/ServiceGuideSections";
import { loadCustomerPhotos, photosRequired } from "@/lib/photos";
import ProcedureRunner, { type Change, type Item, type Sibling, type Step, type Usage } from "./ProcedureRunner";
import { volumeUnit } from "@/lib/inventory";

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
  // các liệu trình khác trong cùng lịch (của KTV này) → hiện thanh chuyển nhanh, không phải ra ngoài
  let sibQ = supabase
    .from("appointment_services")
    .select("id, start_at, work_started_at, work_done_at, services(name, name_en)")
    .eq("appointment_id", row.appointment_id)
    .eq("is_active", true)
    .order("start_at");
  if (profile.role === "technician") sibQ = sibQ.eq("technician_id", profile.id);
  const [{ data: steps }, { data: changes }, { data: guide }, photoSessions, needPhotos, { data: used }, { data: itemRows }, { data: sibRows }] = await Promise.all([
    supabase
      .from("service_procedure_steps")
      .select("step_no, title, products, instructions, note")
      .eq("service_id", row.services?.id ?? "")
      .order("step_no"),
    supabase
      .from("procedure_change_requests")
      .select(
        "id, step_no, from_product, to_product, reason, status, review_note, kind, item_id, new_qty, step_title, parent_id, product_label, to_product_id, requested_by, prod:products!procedure_change_requests_to_product_id_fkey(capacity, unit)",
      )
      .neq("status", "cancelled")
      .eq("appointment_service_id", id)
      .order("created_at"),
    supabase
      .from("service_guides")
      .select("indication, indication_ext, consult_guide")
      .eq("service_id", row.services?.id ?? "")
      .maybeSingle(),
    loadCustomerPhotos(supabase, row.appointments?.customer_id ?? "", row.appointment_id),
    photosRequired(supabase, row.services?.id ? [row.services.id] : []),
    supabase.from("treatment_usages").select("qty, product_id, products(name, capacity, unit)").eq("appointment_service_id", id),
    supabase
      .from("service_step_items")
      .select("id, step_no, sort, product_name, product_id, qty, products(capacity, unit)")
      .eq("service_id", row.services?.id ?? "")
      .order("step_no")
      .order("sort"),
    sibQ,
  ]);
  type SibRow = { id: string; work_started_at: string | null; work_done_at: string | null; services: { name: string; name_en: string | null } | null };
  const siblings: Sibling[] = ((sibRows ?? []) as unknown as SibRow[]).map((r) => ({
    id: r.id,
    label: r.services?.name_en || r.services?.name || "Liệu trình",
    state: r.work_done_at ? "done" : r.work_started_at ? "doing" : "todo",
  }));
  type ItemRow = { id: string; step_no: number; sort: number; product_name: string; product_id: string | null; qty: number | null; products: { capacity: string | null; unit: string } | null };
  const items: Item[] = ((itemRows ?? []) as unknown as ItemRow[]).map((i) => ({
    id: i.id,
    step_no: i.step_no,
    name: i.product_name,
    product_id: i.product_id,
    qty: i.qty == null ? null : Number(i.qty),
    unit: i.products ? volumeUnit(i.products.capacity, i.products.unit) : "",
  }));
  type ChangeRow = Omit<Change, "unit"> & { prod: { capacity: string | null; unit: string } | null };
  const changeList: Change[] = ((changes ?? []) as unknown as ChangeRow[]).map(({ prod, ...c }) => ({
    ...c,
    new_qty: c.new_qty == null ? null : Number(c.new_qty),
    unit: prod ? volumeUnit(prod.capacity, prod.unit) : "",
  }));
  // gộp lượng đã trừ theo sản phẩm
  const usageMap = new Map<string, Usage>();
  ((used ?? []) as unknown as { qty: number; product_id: string; products: { name: string; capacity: string | null; unit: string } | null }[]).forEach((u) => {
    const cur = usageMap.get(u.product_id);
    if (cur) cur.qty += Number(u.qty);
    else
      usageMap.set(u.product_id, {
        label: [u.products?.name, u.products?.capacity].filter(Boolean).join(" · "),
        unit: volumeUnit(u.products?.capacity, u.products?.unit),
        qty: Number(u.qty),
      });
  });
  const planned = Math.round((new Date(row.end_at).getTime() - new Date(row.start_at).getTime()) / 60000);

  return (
    <ProcedureRunner
      key={row.id}
      siblings={siblings}
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
      changes={changeList}
      items={items}
      myId={profile.id}
      guide={(guide ?? null) as ServiceGuide | null}
      closed={["cancelled", "no_show"].includes(row.appointments?.status ?? "")}
      appointmentId={row.appointment_id}
      photos={photoSessions[0]?.photos ?? []}
      photosRequired={needPhotos}
      photoSkipReason={row.appointments?.photo_skip_reason ?? null}
      usages={[...usageMap.values()]}
      photosEditable={profile.role === "owner" || profile.role === "manager" || (row.technician_id === profile.id && row.appointments?.status !== "completed")}
    />
  );
}
