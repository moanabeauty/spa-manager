import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatShortDate, formatTime, todayVn, vnDateTime } from "@/lib/format";
import { addDays } from "@/lib/calendar";
import { AutoRefresh, ReviewButtons } from "./Actions";

export const metadata = { title: "Theo dõi KTV – Moana Beauty" };

type Live = {
  id: string;
  start_at: string;
  end_at: string;
  work_started_at: string | null;
  work_done_at: string | null;
  steps_done: number;
  service_id: string;
  services: { name: string; name_en: string | null } | null;
  technician: { full_name: string | null } | null;
  appointments: { id: string; branch_id: string; customers: { full_name: string } | null } | null;
};

/** Quản lý: theo dõi KTV đang làm liệu trình (thời gian thực) + duyệt đổi sản phẩm, chấm vào sớm, sửa công */
export default async function KtvMonitorPage() {
  const { supabase, profile } = await getCurrentUser();
  if (!profile || !["owner", "manager"].includes(profile.role)) {
    return <div className="card text-sm">Trang dành cho chủ spa và quản lý.</div>;
  }
  await supabase.rpc("ktv_auto_accept");
  const today = todayVn();
  const from = vnDateTime(today, "00:00").toISOString();
  const to = vnDateTime(addDays(today, 1), "00:00").toISOString();
  const soon = vnDateTime(addDays(today, 2), "00:00").toISOString();

  const [liveR, changeR, earlyR, fixR, unconfR, branchR] = await Promise.all([
    supabase
      .from("appointment_services")
      .select(
        "id, start_at, end_at, work_started_at, work_done_at, steps_done, service_id, services(name, name_en), technician:profiles!appointment_services_technician_id_fkey(full_name), appointments!inner(id, branch_id, customers(full_name))",
      )
      .eq("is_active", true)
      .not("technician_id", "is", null)
      .gte("start_at", from)
      .lt("start_at", to)
      .order("start_at"),
    supabase
      .from("procedure_change_requests")
      .select(
        "id, step_no, from_product, to_product, reason, created_at, requester:profiles!procedure_change_requests_requested_by_fkey(full_name), appointment_services(services(name_en, name), appointments(customers(full_name)))",
      )
      .eq("status", "pending")
      .order("created_at"),
    supabase
      .from("staff_attendance")
      .select("staff_id, work_date, check_in, in_reason_kind, in_note, staff:profiles!staff_attendance_staff_id_fkey(full_name), appt:appointments!staff_attendance_in_appointment_id_fkey(start_at, customers(full_name))")
      .eq("in_status", "pending")
      .order("work_date"),
    supabase
      .from("attendance_fix_requests")
      .select("id, work_date, check_in, check_out, reason, staff:profiles!attendance_fix_requests_staff_id_fkey(full_name)")
      .eq("status", "pending")
      .order("work_date"),
    supabase
      .from("appointments")
      .select("id, start_at, branch_id, customers(full_name), appointment_services(technician:profiles!appointment_services_technician_id_fkey(full_name))")
      .is("ktv_confirmed_at", null)
      .in("status", ["pending", "confirmed"])
      .gte("start_at", new Date().toISOString())
      .lt("start_at", soon)
      .order("start_at"),
    supabase.from("branches").select("id, name"),
  ]);
  const live = (liveR.data ?? []) as unknown as Live[];
  const ids = [...new Set(live.map((l) => l.service_id))];
  const { data: stepRows } = ids.length
    ? await supabase.from("service_procedure_steps").select("service_id").in("service_id", ids)
    : { data: [] };
  const totals = new Map<string, number>();
  ((stepRows ?? []) as { service_id: string }[]).forEach((r) => totals.set(r.service_id, (totals.get(r.service_id) ?? 0) + 1));
  const bname = new Map(((branchR.data ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name.replace(/^Moana\s*/i, "")]));

  const working = live.filter((l) => l.work_started_at && !l.work_done_at);
  const doneToday = live.filter((l) => l.work_done_at);
  const notStarted = live.filter((l) => !l.work_started_at);
  const changes = (changeR.data ?? []) as unknown as {
    id: string; step_no: number; from_product: string | null; to_product: string; reason: string; created_at: string;
    requester: { full_name: string | null } | null;
    appointment_services: { services: { name_en: string | null; name: string } | null; appointments: { customers: { full_name: string } | null } | null } | null;
  }[];
  const early = (earlyR.data ?? []) as unknown as {
    staff_id: string; work_date: string; check_in: string; in_reason_kind: string | null; in_note: string | null;
    staff: { full_name: string | null } | null; appt: { start_at: string; customers: { full_name: string } | null } | null;
  }[];
  const fixes = (fixR.data ?? []) as unknown as { id: string; work_date: string; check_in: string | null; check_out: string | null; reason: string; staff: { full_name: string | null } | null }[];
  const unconf = ((unconfR.data ?? []) as unknown as {
    id: string; start_at: string; branch_id: string; customers: { full_name: string } | null;
    appointment_services: { technician: { full_name: string | null } | null }[];
  }[]).filter((a) => a.appointment_services.some((s) => s.technician));
  const mins = (a: string, b?: string | null) => Math.round(((b ? new Date(b).getTime() : Date.now()) - new Date(a).getTime()) / 60000);

  return (
    <div className="space-y-4">
      <AutoRefresh seconds={15} />
      <div>
        <h1 className="text-2xl font-bold text-navy">Theo dõi KTV</h1>
        <p className="text-sm text-ink/70">Tiến độ liệu trình hôm nay (tự cập nhật 15 giây) và các yêu cầu KTV chờ duyệt.</p>
      </div>

      <section className="card space-y-2 p-4">
        <h2 className="font-semibold text-navy">Đang làm ({working.length})</h2>
        {working.length === 0 && <p className="text-sm text-ink/60">Không có KTV nào đang làm liệu trình.</p>}
        {working.map((l) => {
          const total = totals.get(l.service_id) ?? 0;
          const planned = mins(l.start_at, l.end_at);
          const spent = mins(l.work_started_at!);
          const over = spent > planned;
          return (
            <div key={l.id} className={`rounded-xl border px-3 py-2 text-sm ${over ? "border-[#E8A5A5] bg-[#FCE4E4]" : "border-beige-dark bg-cream"}`}>
              <div className="flex justify-between gap-2">
                <b>{l.technician?.full_name ?? "KTV"} · {l.appointments?.customers?.full_name}</b>
                <span className={`shrink-0 font-semibold ${over ? "text-[#8A2323]" : "text-navy"}`}>{spent}/{planned} phút</span>
              </div>
              <p className="text-xs text-ink/70">
                {l.services?.name_en || l.services?.name} · bắt đầu {formatTime(l.work_started_at!)} · {bname.get(l.appointments?.branch_id ?? "") ?? ""}
              </p>
              {total > 0 && (
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-white">
                    <div className="h-1.5 rounded-full bg-brown" style={{ width: `${Math.round((Math.min(l.steps_done, total) / total) * 100)}%` }} />
                  </div>
                  <span className="text-xs text-ink/70">Bước {Math.min(l.steps_done + 1, total)}/{total}</span>
                </div>
              )}
            </div>
          );
        })}
        {(notStarted.length > 0 || doneToday.length > 0) && (
          <p className="pt-1 text-xs text-ink/60">
            Hôm nay: {doneToday.length} liệu trình đã xong
            {doneToday.length ? ` (TB ${Math.round(doneToday.reduce((a, l) => a + mins(l.work_started_at!, l.work_done_at), 0) / doneToday.length)} phút)` : ""} ·{" "}
            {notStarted.length} chưa bắt đầu
          </p>
        )}
      </section>

      <section className="card space-y-2 p-4">
        <h2 className="font-semibold text-navy">Đổi sản phẩm chờ duyệt ({changes.length})</h2>
        {changes.length === 0 && <p className="text-sm text-[#22612A]">✓ Không có yêu cầu.</p>}
        {changes.map((c) => (
          <div key={c.id} className="rounded-xl bg-[#FFF4DB] px-3 py-2 text-sm">
            <p>
              <b>{c.requester?.full_name ?? "KTV"}</b> · {c.appointment_services?.appointments?.customers?.full_name} ·{" "}
              {c.appointment_services?.services?.name_en || c.appointment_services?.services?.name} · bước {c.step_no}
            </p>
            <p className="text-xs">
              Đổi {c.from_product ? <s>{c.from_product}</s> : "sản phẩm"} sang <b>{c.to_product}</b> · lý do: {c.reason} · {formatTime(c.created_at)}
            </p>
            <ReviewButtons fn="review_procedure_change" args={{ p_id: c.id }} withNote />
          </div>
        ))}
      </section>

      <section className="card space-y-2 p-4">
        <h2 className="font-semibold text-navy">Chấm vào sớm chờ duyệt ({early.length})</h2>
        {early.length === 0 && <p className="text-sm text-[#22612A]">✓ Không có yêu cầu.</p>}
        {early.map((e) => (
          <div key={`${e.staff_id}-${e.work_date}`} className="rounded-xl bg-[#FFF4DB] px-3 py-2 text-sm">
            <p>
              <b>{e.staff?.full_name}</b> · {formatShortDate(e.work_date)} · vào {formatTime(e.check_in)}
            </p>
            <p className="text-xs">
              {e.in_reason_kind}
              {e.appt ? ` · ${e.appt.customers?.full_name} (${formatTime(e.appt.start_at)})` : ""}
              {e.in_note ? ` · ${e.in_note}` : ""}
            </p>
            <ReviewButtons fn="review_early_checkin" args={{ p_staff: e.staff_id, p_date: e.work_date }} />
          </div>
        ))}
        <p className="text-xs text-ink/50">
          Tăng ca (chấm ra sau 18:30) duyệt ở <Link href="/quan-ly/cham-cong" className="underline">Chấm công & tăng ca</Link>.
        </p>
      </section>

      <section className="card space-y-2 p-4">
        <h2 className="font-semibold text-navy">Xin sửa công – quên chấm công ({fixes.length})</h2>
        {fixes.length === 0 && <p className="text-sm text-[#22612A]">✓ Không có yêu cầu.</p>}
        {fixes.map((f) => (
          <div key={f.id} className="rounded-xl bg-[#FFF4DB] px-3 py-2 text-sm">
            <p>
              <b>{f.staff?.full_name}</b> · {formatShortDate(f.work_date)} · vào {f.check_in?.slice(0, 5) ?? "—"} · ra {f.check_out?.slice(0, 5) ?? "—"}
            </p>
            <p className="text-xs">{f.reason}</p>
            <ReviewButtons fn="review_attendance_fix" args={{ p_id: f.id }} />
          </div>
        ))}
      </section>

      <section className="card space-y-2 p-4">
        <h2 className="font-semibold text-navy">Lịch KTV chưa xác nhận ({unconf.length})</h2>
        <p className="text-xs text-ink/60">Đến giờ hẹn mà KTV chưa bấm xác nhận thì hệ thống tự nhận lịch.</p>
        {unconf.map((a) => (
          <div key={a.id} className="flex justify-between gap-2 text-sm">
            <span>
              {formatShortDate(a.start_at)} {formatTime(a.start_at)} · {a.customers?.full_name}
            </span>
            <span className="text-ink/60">{a.appointment_services.map((s) => s.technician?.full_name).filter(Boolean).join(", ")}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
