import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, isStaffRole } from "@/lib/supabase/server";
import { STATUS_LABEL, STATUS_STYLE, formatDate, formatTime, formatVnd, todayVn, vnDateTime } from "@/lib/format";
import StatusActions from "./StatusActions";
import TechnicianPicker from "./TechnicianPicker";
import { fetchBusy, fetchTechnicians } from "@/lib/staff";

export const metadata = { title: "Lịch hẹn spa – Moana Beauty" };

type Row = {
  id: string;
  start_at: string;
  end_at: string | null;
  status: string;
  source: string;
  note: string | null;
  customers: { full_name: string; phone: string | null; note: string | null } | null;
  appointment_services: {
    id: string;
    start_at: string;
    end_at: string;
    price: number | null;
    technician_id: string | null;
    services: { name: string } | null;
  }[];
};

const SOURCE_LABEL: Record<string, string> = { online: "Online", walk_in: "Khách vãng lai", phone: "Điện thoại", staff: "Nhân viên" };

function shiftDate(d: string, days: number) {
  const t = vnDateTime(d, "12:00").getTime() + days * 86400000;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(t));
}

export default async function StaffAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ ngay?: string; cn?: string; tt?: string }>;
}) {
  const { supabase, user, profile } = await getCurrentUser();
  if (!user) redirect("/dang-nhap?next=/quan-ly");
  if (!isStaffRole(profile?.role)) {
    return (
      <div className="card">
        <h1 className="text-lg font-bold text-navy">Trang dành cho nhân viên</h1>
        <p className="mt-2 text-sm">Tài khoản của bạn chưa được cấp quyền nhân viên. Vui lòng nhờ chủ spa cấp quyền.</p>
      </div>
    );
  }

  const sp = await searchParams;
  const date = sp.ngay && /^\d{4}-\d{2}-\d{2}$/.test(sp.ngay) ? sp.ngay : todayVn();
  const { data: branches } = await supabase.from("branches").select("id, name").eq("is_active", true).order("name");
  const branchId = sp.cn ?? profile?.branch_id ?? branches?.[0]?.id ?? "";
  const filter = sp.tt ?? "active";

  const from = vnDateTime(date, "00:00").toISOString();
  const to = vnDateTime(shiftDate(date, 1), "00:00").toISOString();
  let q = supabase
    .from("appointments")
    .select(
      "id, start_at, end_at, status, source, note, customers(full_name, phone, note), appointment_services(id, start_at, end_at, price, technician_id, services(name))",
    )
    .eq("branch_id", branchId)
    .gte("start_at", from)
    .lt("start_at", to)
    .order("start_at");
  if (filter === "active") q = q.not("status", "in", "(cancelled,no_show)");
  const [{ data, error }, technicians, busy] = await Promise.all([q, fetchTechnicians(supabase), fetchBusy(supabase, from, to)]);
  const rows = (data ?? []) as unknown as Row[];
  const canAssign = profile?.role !== "customer";

  const link = (p: { ngay?: string; cn?: string; tt?: string }) => {
    const params = new URLSearchParams({ ngay: p.ngay ?? date, cn: p.cn ?? branchId, tt: p.tt ?? filter });
    return `/quan-ly?${params.toString()}`;
  };
  const pendingCount = rows.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Lịch hẹn spa</h1>
        <p className="text-sm capitalize text-ink/70">{formatDate(vnDateTime(date, "12:00").toISOString())}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(branches ?? []).map((b) => (
          <Link
            key={b.id}
            href={link({ cn: b.id })}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${b.id === branchId ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}
          >
            {b.name}
          </Link>
        ))}
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <Link href={link({ ngay: shiftDate(date, -1) })} className="btn-ghost">‹ Hôm trước</Link>
        <form action="/quan-ly" className="flex items-center gap-2">
          <input type="hidden" name="cn" value={branchId} />
          <input type="hidden" name="tt" value={filter} />
          <input type="date" name="ngay" defaultValue={date} className="input w-auto py-2" />
          <button className="btn-outline py-2">Xem</button>
        </form>
        <Link href={link({ ngay: shiftDate(date, 1) })} className="btn-ghost">Hôm sau ›</Link>
        <Link href={link({ ngay: todayVn() })} className="btn-ghost">Hôm nay</Link>
        <Link href={link({ tt: filter === "active" ? "all" : "active" })} className="ml-auto text-sm text-navy underline">
          {filter === "active" ? "Hiện cả lịch đã huỷ" : "Ẩn lịch đã huỷ"}
        </Link>
      </div>

      {error && <p className="card text-sm text-[#8A2323]">Không tải được lịch: {error.message}</p>}

      <p className="text-sm text-ink/70">
        {rows.length} lịch hẹn{pendingCount > 0 && <> · <b className="text-[#7A5600]">{pendingCount} chờ xác nhận</b></>}
      </p>

      {rows.length === 0 && <p className="card text-sm text-ink/60">Không có lịch hẹn nào trong ngày này.</p>}

      <div className="space-y-3">
        {rows.map((r) => {
          const items = [...r.appointment_services].sort((x, y) => x.start_at.localeCompare(y.start_at));
          const total = items.reduce((a, s) => a + (s.price ?? 0), 0);
          return (
            <div key={r.id} className={`card ${r.status === "pending" ? "border-l-4 border-l-[#E0A526]" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-4">
                  <div className="text-center">
                    <p className="text-xl font-bold text-navy">{formatTime(r.start_at)}</p>
                    {r.end_at && <p className="text-xs text-ink/50">{formatTime(r.end_at)}</p>}
                  </div>
                  <div>
                    <p className="font-semibold">{r.customers?.full_name ?? "—"}</p>
                    {r.customers?.phone && (
                      <a href={`tel:${r.customers.phone}`} className="text-sm text-navy underline">{r.customers.phone}</a>
                    )}
                    <p className="text-xs text-ink/50">{SOURCE_LABEL[r.source] ?? r.source}</p>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[r.status] ?? ""}`}>
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
              </div>
              <ul className="mt-3 space-y-1 border-t border-beige pt-3 text-sm">
                {items.map((s) => (
                  <li key={s.id} className="py-1">
                    <div className="flex justify-between gap-3">
                      <span>
                        <span className="text-ink/50">{formatTime(s.start_at)}</span> {s.services?.name}
                      </span>
                      <span className="shrink-0 text-ink/60">{formatVnd(s.price)}</span>
                    </div>
                    {canAssign && (
                      <TechnicianPicker
                        serviceRowId={s.id}
                        current={s.technician_id}
                        start={s.start_at}
                        end={s.end_at}
                        locked={r.status === "cancelled" || r.status === "no_show" || r.status === "completed"}
                        technicians={technicians}
                        busy={busy}
                        branches={branches ?? []}
                      />
                    )}
                  </li>
                ))}
                {items.length > 1 && (
                  <li className="flex justify-between pt-1 font-semibold">
                    <span>Tạm tính</span>
                    <span>{formatVnd(total)}</span>
                  </li>
                )}
              </ul>
              {r.note && <p className="mt-2 rounded-lg bg-cream px-3 py-2 text-sm">Khách ghi chú: {r.note}</p>}
              {r.customers?.note && <p className="mt-2 rounded-lg bg-[#FFE8BA]/60 px-3 py-2 text-xs">Hồ sơ khách: {r.customers.note}</p>}
              <StatusActions id={r.id} status={r.status} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
