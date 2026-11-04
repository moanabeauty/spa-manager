import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatTime, todayVn, vnDateTime } from "@/lib/format";
import { SKIN_COLORS, SkinDot, SkinRecordCard, shortDay, type SkinColor, type SkinRecord } from "@/lib/skin";
import SkinRecordForm from "./SkinRecordForm";

export const metadata = { title: "Phiếu theo dõi da – Moana Beauty" };

type Sp = { lich?: string; kh?: string; id?: string; mau?: string; cn?: string; back?: string };
const STAFF = ["owner", "manager", "receptionist", "technician"];

export default async function SkinPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { supabase, user, profile } = await getCurrentUser();
  const sp = await searchParams;
  if (!profile || !STAFF.includes(profile.role)) {
    return <p className="card text-sm">Trang này dành cho lễ tân, KTV, quản lý và chủ spa.</p>;
  }
  const manager = profile.role === "owner" || profile.role === "manager";

  // ---------- Form tạo / sửa ----------
  if (sp.lich || sp.kh || sp.id) {
    let existing: SkinRecord | null = null;
    type Appt = { id: string; start_at: string; branch_id: string; customer_id: string; appointment_services: { services: { name: string } | null }[] };
    let appt: Appt | null = null;
    if (sp.id) {
      const { data } = await supabase.from("skin_records").select("*").eq("id", sp.id).maybeSingle<SkinRecord>();
      existing = data ?? null;
    } else if (sp.lich) {
      const { data } = await supabase.from("skin_records").select("*").eq("appointment_id", sp.lich).maybeSingle<SkinRecord>();
      existing = data ?? null;
    }
    const apptId = existing?.appointment_id ?? sp.lich ?? null;
    if (apptId) {
      const { data } = await supabase
        .from("appointments")
        .select("id, start_at, branch_id, customer_id, appointment_services(services(name))")
        .eq("id", apptId)
        .maybeSingle();
      appt = (data as unknown as Appt | null) ?? null;
    }
    const customerId = existing?.customer_id ?? appt?.customer_id ?? sp.kh ?? "";
    const [{ data: cust }, { data: crm }, { data: prev }] = await Promise.all([
      supabase.from("customers").select("id, full_name, code").eq("id", customerId).maybeSingle(),
      supabase.from("customer_crm").select("skin_type, skin_concerns, health_note").eq("customer_id", customerId).maybeSingle(),
      supabase
        .from("skin_records")
        .select("*")
        .eq("customer_id", customerId)
        .neq("id", existing?.id ?? "00000000-0000-0000-0000-000000000000")
        .order("record_date", { ascending: false })
        .limit(3),
    ]);
    if (!cust) return <p className="card text-sm">Không tìm thấy khách hàng.</p>;
    const canEdit = !existing || manager || existing.created_by === user?.id;
    const back =
      sp.back && sp.back.startsWith("/quan-ly") ? sp.back : appt ? `/quan-ly/lich-hen?ngay=${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(appt.start_at))}&cn=${appt.branch_id}` : `/quan-ly/khach-hang?id=${cust.id}`;

    return (
      <div className="space-y-4">
        <div>
          <Link href={back} className="text-sm text-navy underline">‹ Quay lại</Link>
          <h1 className="mt-1 text-2xl font-bold text-navy">{existing ? "Phiếu theo dõi da" : "Phiếu theo dõi da mới"}</h1>
          <p className="text-sm text-ink/70">
            <Link href={`/quan-ly/khach-hang?id=${cust.id}`} className="font-semibold text-navy underline">{cust.full_name}</Link>
            {cust.code && ` · ${cust.code}`}
            {appt && ` · ${formatTime(appt.start_at)} ${shortDay(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(appt.start_at)))}`}
          </p>
          {appt && appt.appointment_services.length > 0 && (
            <p className="text-sm text-ink/60">Dịch vụ: {appt.appointment_services.map((s) => s.services?.name).filter(Boolean).join(", ")}</p>
          )}
        </div>

        {(crm?.skin_type || crm?.skin_concerns || crm?.health_note) && (
          <div className="card text-sm">
            {crm?.skin_type && <p><b>Loại da:</b> {crm.skin_type}</p>}
            {crm?.skin_concerns && <p><b>Tình trạng da:</b> {crm.skin_concerns}</p>}
            {crm?.health_note && <p className="mt-1 rounded-lg bg-[#FCE4E4] px-2 py-1 text-[#8A2323]"><b>Lưu ý sức khoẻ / dị ứng:</b> {crm.health_note}</p>}
          </div>
        )}

        {(prev ?? []).length > 0 && (
          <details className="card" open={!existing}>
            <summary className="cursor-pointer font-semibold text-navy">Các buổi trước ({(prev ?? []).length} gần nhất)</summary>
            <div className="mt-3 space-y-2">
              {((prev ?? []) as SkinRecord[]).map((r) => <SkinRecordCard key={r.id} r={r} showInternal />)}
            </div>
          </details>
        )}

        {canEdit ? (
          <SkinRecordForm
            customerId={cust.id}
            appointmentId={appt?.id ?? null}
            branchId={appt?.branch_id ?? profile.branch_id}
            existing={existing}
            backHref={back}
            canDelete={manager}
          />
        ) : (
          existing && (
            <>
              <SkinRecordCard r={existing} showInternal />
              <p className="text-xs text-ink/60">Chỉ người lập phiếu, quản lý hoặc chủ spa sửa được phiếu này.</p>
            </>
          )
        )}
      </div>
    );
  }

  // ---------- Danh sách ----------
  const today = todayVn();
  const { data: branches } = await supabase.from("branches").select("id, name").eq("is_active", true).order("name");
  const branchId = sp.cn ?? profile.branch_id ?? branches?.[0]?.id ?? "";
  const color = SKIN_COLORS.some((c) => c.key === sp.mau) ? (sp.mau as SkinColor) : null;

  const from = vnDateTime(today, "00:00").toISOString();
  const to = new Date(vnDateTime(today, "00:00").getTime() + 86400000).toISOString();
  const [{ data: todayAppts }, recentRes] = await Promise.all([
    supabase
      .from("appointments")
      .select("id, start_at, status, customers(id, full_name), skin_records(id, overall), appointment_services(services(name))")
      .eq("branch_id", branchId)
      .in("status", ["in_progress", "completed"])
      .gte("start_at", from)
      .lt("start_at", to)
      .order("start_at"),
    (() => {
      let q = supabase
        .from("skin_records")
        .select("*, customers(full_name), author:profiles!skin_records_created_by_fkey(full_name)")
        .eq("branch_id", branchId)
        .order("record_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(60);
      if (color) q = q.eq("overall", color);
      return q;
    })(),
  ]);
  type TA = { id: string; start_at: string; status: string; customers: { id: string; full_name: string } | null; skin_records: { id: string; overall: SkinColor }[] | { id: string; overall: SkinColor } | null; appointment_services: { services: { name: string } | null }[] };
  const ta = (todayAppts ?? []) as unknown as TA[];
  const recOf = (a: TA) => (Array.isArray(a.skin_records) ? a.skin_records[0] : a.skin_records) ?? null;
  const missing = ta.filter((a) => !recOf(a));
  type RR = SkinRecord & { customers: { full_name: string } | null; author: { full_name: string | null } | null };
  const recent = (recentRes.data ?? []) as unknown as RR[];
  const link = (p: { cn?: string; mau?: string | null }) => {
    const u = new URLSearchParams({ cn: p.cn ?? branchId });
    const m = p.mau === undefined ? color : p.mau;
    if (m) u.set("mau", m);
    return `/quan-ly/phieu-da?${u}`;
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Phiếu theo dõi da</h1>
        <p className="text-sm text-ink/70">KTV ghi sau mỗi buổi: màu da (xanh / vàng / đỏ), nhu cầu khách, đề xuất buổi sau.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(branches ?? []).map((b) => (
          <Link key={b.id} href={link({ cn: b.id })} className={`rounded-full px-4 py-2 text-sm font-semibold ${b.id === branchId ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}>
            {b.name}
          </Link>
        ))}
      </div>

      <div className="card">
        <h2 className="mb-2 font-semibold text-navy">Hôm nay chưa có phiếu da ({missing.length})</h2>
        {missing.length === 0 && <p className="text-sm text-ink/60">Mọi khách đã làm hôm nay đều có phiếu da.</p>}
        <ul className="divide-y divide-beige text-sm">
          {missing.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                <b>{formatTime(a.start_at)}</b> {a.customers?.full_name}
                <span className="block text-xs text-ink/60">{a.appointment_services.map((s) => s.services?.name).filter(Boolean).join(", ")}</span>
              </span>
              <Link href={`/quan-ly/phieu-da?lich=${a.id}&back=${encodeURIComponent(link({}))}`} className="btn-primary shrink-0 py-2">Ghi phiếu</Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link href={link({ mau: null })} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${!color ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}>Tất cả</Link>
        {SKIN_COLORS.map((c) => (
          <Link key={c.key} href={link({ mau: c.key })} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${color === c.key ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}>
            <SkinDot color={c.key} size="h-2.5 w-2.5" /> {c.short}
          </Link>
        ))}
      </div>

      {recent.length === 0 && <p className="card text-sm text-ink/60">Chưa có phiếu da nào.</p>}
      <div className="space-y-2">
        {recent.map((r) => (
          <SkinRecordCard
            key={r.id}
            r={r}
            showInternal
            heading={
              <>
                {shortDay(r.record_date)}
                {r.author?.full_name && ` · ${r.author.full_name}`}
              </>
            }
            footer={
              <div className="mt-2 flex items-center justify-between border-t border-black/5 pt-2">
                <Link href={`/quan-ly/khach-hang?id=${r.customer_id}`} className="font-semibold text-navy underline">
                  {r.customers?.full_name}
                </Link>
                <Link href={`/quan-ly/phieu-da?id=${r.id}&back=${encodeURIComponent(link({}))}`} className="text-xs text-navy underline">Mở phiếu</Link>
              </div>
            }
          />
        ))}
      </div>
    </div>
  );
}
