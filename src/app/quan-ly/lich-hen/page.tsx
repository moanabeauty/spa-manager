import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, isStaffRole } from "@/lib/supabase/server";
import { STATUS_LABEL, STATUS_STYLE, formatDate, formatTime, formatVnd, todayVn, vnDateTime } from "@/lib/format";
import StatusActions from "./StatusActions";
import TechnicianPicker from "./TechnicianPicker";
import CapacityEditor from "./CapacityEditor";
import DurationEditor from "./DurationEditor";
import { canCheckout, fetchBusy, fetchTechnicians } from "@/lib/staff";
import {
  DEFAULT_CAPACITY,
  WEEKDAYS,
  addDays,
  assignLanes,
  fullSlots,
  loadLevel,
  monthGrid,
  monthLabel,
  monthOf,
  peakLoad,
  shiftMonth,
  toIntervals,
  vnDayOf,
  vnTime,
} from "@/lib/calendar";
import { SkinBadge, SkinDot, type SkinColor } from "@/lib/skin";

export const metadata = { title: "Lịch hẹn spa – Moana Beauty" };

type Row = {
  id: string;
  customer_id: string;
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

// màu khối trên timeline theo trạng thái
const BLOCK_STYLE: Record<string, string> = {
  pending: "bg-[#FFF3D6] border-[#E0A526] text-[#5C4100]",
  confirmed: "bg-[#E6EBF8] border-navy text-navy",
  in_progress: "bg-[#EEE6FA] border-[#6B45A8] text-[#3A2163]",
  completed: "bg-[#E3F3E5] border-[#3E9B4F] text-[#1D5224]",
  cancelled: "bg-[#F1F1F1] border-[#999] text-[#777] line-through",
  no_show: "bg-[#FCE4E4] border-[#C94A4A] text-[#8A2323] line-through",
};

const LEVEL_STYLE = {
  empty: "bg-white",
  light: "bg-[#E9EAF3]",
  busy: "bg-[#F3ECE1]",
  full: "bg-[#FCE4E4]",
};

const PPM = 1.6; // px mỗi phút trên timeline (30 phút = 48px)

export default async function StaffAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ ngay?: string; thang?: string; cn?: string; tt?: string }>;
}) {
  const { supabase, user, profile } = await getCurrentUser();
  if (!user) redirect("/dang-nhap?next=/quan-ly/lich-hen");
  if (!isStaffRole(profile?.role)) {
    return (
      <div className="card">
        <h1 className="text-lg font-bold text-navy">Trang dành cho nhân viên</h1>
        <p className="mt-2 text-sm">Tài khoản của bạn chưa được cấp quyền nhân viên. Vui lòng nhờ chủ spa cấp quyền.</p>
      </div>
    );
  }

  if (profile?.role === "warehouse") redirect("/quan-ly/kho");

  const sp = await searchParams;
  const today = todayVn();
  const date = sp.ngay && /^\d{4}-\d{2}-\d{2}$/.test(sp.ngay) ? sp.ngay : today;
  const ym = sp.thang && /^\d{4}-\d{2}$/.test(sp.thang) ? sp.thang : monthOf(date);
  const { data: branchData } = await supabase.from("branches").select("id, name, max_per_slot").eq("is_active", true).order("name");
  const branches = (branchData ?? []) as { id: string; name: string; max_per_slot: number | null }[];
  const branchId = sp.cn ?? profile?.branch_id ?? branches[0]?.id ?? "";
  const branch = branches.find((b) => b.id === branchId);
  const cap = branch?.max_per_slot ?? DEFAULT_CAPACITY;
  const filter = sp.tt ?? "active";

  // ---- dữ liệu cả tháng (ô lịch) ----
  const grid = monthGrid(ym);
  const gridFrom = grid[0][0].date;
  const gridTo = addDays(grid[grid.length - 1][6].date, 1);
  const { data: monthData } = await supabase
    .from("appointments")
    .select("id, start_at, end_at, status")
    .eq("branch_id", branchId)
    .gte("start_at", vnDateTime(gridFrom, "00:00").toISOString())
    .lt("start_at", vnDateTime(gridTo, "00:00").toISOString())
    .not("status", "in", "(cancelled,no_show)");
  const monthRows = (monthData ?? []) as { id: string; start_at: string; end_at: string | null; status: string }[];
  const byDay = new Map<string, typeof monthRows>();
  for (const r of monthRows) {
    const d = vnDayOf(r.start_at);
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }

  // ---- dữ liệu ngày đang chọn ----
  const from = vnDateTime(date, "00:00").toISOString();
  const to = vnDateTime(addDays(date, 1), "00:00").toISOString();
  let q = supabase
    .from("appointments")
    .select(
      "id, customer_id, start_at, end_at, status, source, note, customers(full_name, phone, note), appointment_services(id, start_at, end_at, price, technician_id, services(name))",
    )
    .eq("branch_id", branchId)
    .gte("start_at", from)
    .lt("start_at", to)
    .order("start_at");
  if (filter === "active") q = q.not("status", "in", "(cancelled,no_show)");
  const [{ data, error }, technicians, busy] = await Promise.all([q, fetchTechnicians(supabase), fetchBusy(supabase, from, to)]);
  const rows = (data ?? []) as unknown as Row[];
  const canAssign = profile?.role !== "customer";
  const cashier = canCheckout(profile?.role);
  const ids = rows.map((r) => r.id);
  const customerIds = [...new Set(rows.map((r) => r.customer_id))];
  const [{ data: invs }, { data: skinData }] = await Promise.all([
    ids.length
      ? supabase.from("invoices").select("id, code, appointment_id").in("appointment_id", ids).neq("status", "cancelled")
      : Promise.resolve({ data: [] }),
    customerIds.length
      ? supabase
          .from("skin_records")
          .select("id, customer_id, appointment_id, record_date, overall, need_tags, customer_needs, recommendation")
          .in("customer_id", customerIds)
          .order("record_date", { ascending: false })
          .limit(300)
      : Promise.resolve({ data: [] }),
  ]);
  const invoiceOf = new Map(((invs ?? []) as { id: string; code: string; appointment_id: string }[]).map((i) => [i.appointment_id, i]));
  type Skin = { id: string; customer_id: string; appointment_id: string | null; record_date: string; overall: SkinColor; need_tags: string[]; customer_needs: string | null; recommendation: string | null };
  const skins = (skinData ?? []) as Skin[];
  const skinOfAppt = new Map(skins.filter((s) => s.appointment_id).map((s) => [s.appointment_id!, s]));
  const lastSkinBefore = (r: Row) => skins.find((s) => s.customer_id === r.customer_id && s.appointment_id !== r.id && s.record_date <= date);

  const link = (p: { ngay?: string; thang?: string | null; cn?: string; tt?: string }) => {
    const params = new URLSearchParams({ ngay: p.ngay ?? date, cn: p.cn ?? branchId, tt: p.tt ?? filter });
    const th = p.thang === undefined ? (sp.thang ?? null) : p.thang;
    if (th) params.set("thang", th);
    return `/quan-ly/lich-hen?${params.toString()}`;
  };
  const pendingCount = rows.filter((r) => r.status === "pending").length;

  // ---- timeline ----
  const active = rows.filter((r) => !["cancelled", "no_show"].includes(r.status));
  const intervals = toIntervals(active);
  const dayStartMin = 9 * 60;
  let dayEndMin = 21 * 60;
  for (const iv of intervals) {
    const endMin = Math.ceil((iv.e - vnTime(date, "00:00")) / 60000 / 60) * 60;
    if (endMin > dayEndMin) dayEndMin = Math.min(endMin, 24 * 60);
  }
  let startMin = dayStartMin;
  for (const iv of intervals) {
    const sMin = Math.floor((iv.s - vnTime(date, "00:00")) / 60000 / 60) * 60;
    if (sMin < startMin) startMin = Math.max(sMin, 0);
  }
  const dayZero = vnTime(date, "00:00");
  const blocks = assignLanes(
    rows.map((r) => {
      const s = new Date(r.start_at).getTime();
      return { row: r, s, e: r.end_at ? new Date(r.end_at).getTime() : s + 60 * 60000 };
    }),
  );
  const lanes = Math.max(cap, ...blocks.map((b) => b.lane + 1), 1);
  const height = (dayEndMin - startMin) * PPM;
  const hours: number[] = [];
  for (let m = startMin; m <= dayEndMin; m += 60) hours.push(m);
  const halfHours: number[] = [];
  for (let m = startMin; m < dayEndMin; m += 30) halfHours.push(m);
  const nowMin = date === today ? (Date.now() - dayZero) / 60000 : null;
  const dayPeak = peakLoad(intervals, vnTime(date, "00:00"), vnTime(addDays(date, 1), "00:00"));
  const dayFull = fullSlots(intervals, date, cap);
  const manager = profile?.role === "owner" || profile?.role === "manager";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-navy">Lịch hẹn spa</h1>
          <p className="text-sm text-ink/70">
            Tối đa <b>{cap} khách</b> cùng lúc mỗi ca{manager && " (chủ / quản lý vẫn xếp thêm được)"}
          </p>
        </div>
        <Link href="/quan-ly/tao-lich" className="btn-primary py-2">+ Tạo lịch</Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {branches.map((b) => (
          <Link
            key={b.id}
            href={link({ cn: b.id })}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${b.id === branchId ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}
          >
            {b.name}
          </Link>
        ))}
      </div>

      {/* ===== Lịch tháng ===== */}
      <div className="card p-3 sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <Link href={link({ thang: shiftMonth(ym, -1) })} className="btn-ghost px-3 py-1.5" aria-label="Tháng trước">‹</Link>
          <div className="text-center">
            <p className="font-bold text-navy">{monthLabel(ym)}</p>
            {ym !== monthOf(today) && (
              <Link href={link({ ngay: today, thang: null })} className="text-xs text-navy underline">Về hôm nay</Link>
            )}
          </div>
          <Link href={link({ thang: shiftMonth(ym, 1) })} className="btn-ghost px-3 py-1.5" aria-label="Tháng sau">›</Link>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-ink/50">
          {WEEKDAYS.map((w) => <div key={w} className={w === "CN" ? "text-[#8A2323]" : ""}>{w}</div>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {grid.flat().map((g) => {
            const list = byDay.get(g.date) ?? [];
            const iv = toIntervals(list);
            const full = list.length ? fullSlots(iv, g.date, cap) : 0;
            const level = loadLevel(full, list.length);
            const pend = list.filter((x) => x.status === "pending").length;
            const selected = g.date === date;
            const isToday = g.date === today;
            const past = g.date < today;
            return (
              <Link
                key={g.date}
                href={link({ ngay: g.date, thang: null })}
                className={`relative flex min-h-14 flex-col items-center justify-start rounded-lg border p-1 transition sm:min-h-20 sm:items-start sm:p-1.5 ${
                  selected ? "border-navy ring-2 ring-navy" : "border-beige-dark/60 hover:border-navy"
                } ${LEVEL_STYLE[level]} ${g.inMonth ? "" : "opacity-40"} ${past && !selected ? "opacity-70" : ""}`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                    isToday ? "bg-navy text-white" : "text-ink"
                  }`}
                >
                  {Number(g.date.slice(8))}
                </span>
                {list.length > 0 && (
                  <span className="mt-0.5 text-[10px] font-semibold leading-tight text-navy sm:text-xs">
                    {list.length}<span className="hidden sm:inline"> khách</span>
                  </span>
                )}
                {full > 0 && <span className="hidden text-[10px] leading-tight text-[#8A2323] sm:block">{full} suất kín</span>}
                {pend > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[#E0A526]" title={`${pend} chờ xác nhận`} />}
              </Link>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink/60">
          <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-[#E9EAF3] ring-1 ring-beige-dark" /> Còn chỗ</span>
          <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-[#F3ECE1] ring-1 ring-beige-dark" /> Có giờ đã kín</span>
          <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-[#FCE4E4] ring-1 ring-beige-dark" /> Kín cả ngày</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#E0A526]" /> Có lịch chờ xác nhận</span>
        </div>
      </div>

      {/* ===== Timeline trong ngày ===== */}
      <div className="card p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Link href={link({ ngay: addDays(date, -1), thang: null })} className="btn-ghost px-3 py-1.5">‹</Link>
          <div className="flex-1 text-center">
            <p className="font-bold capitalize text-navy">{formatDate(vnDateTime(date, "12:00").toISOString())}</p>
            <p className="text-xs text-ink/60">
              {active.length} khách · đông nhất {dayPeak}/{cap} cùng lúc
              {dayFull > 0 && <span className="text-[#8A2323]"> · {dayFull} suất đã kín</span>}
              {pendingCount > 0 && <> · <b className="text-[#7A5600]">{pendingCount} chờ xác nhận</b></>}
            </p>
          </div>
          <Link href={link({ ngay: addDays(date, 1), thang: null })} className="btn-ghost px-3 py-1.5">›</Link>
        </div>

        {error && <p className="text-sm text-[#8A2323]">Không tải được lịch: {error.message}</p>}

        <div className="flex">
          {/* trục giờ */}
          <div className="relative w-12 shrink-0" style={{ height }}>
            {hours.map((m) => (
              <span key={m} className="absolute -translate-y-1/2 text-[11px] font-semibold text-ink/60" style={{ top: (m - startMin) * PPM }}>
                {String(Math.floor(m / 60)).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {/* vùng lịch */}
          <div className="relative flex-1 overflow-hidden rounded-lg border border-beige-dark/60 bg-cream/40" style={{ height }}>
            {halfHours.map((m) => {
              const s = dayZero + m * 60000;
              const n = intervals.filter((x) => x.s < s + 30 * 60000 && x.e > s).length;
              const isFull = n >= cap;
              const hhmm = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
              const bookable = s + 30 * 60000 > Date.now() && (!isFull || manager);
              const cls = `absolute inset-x-0 block border-t ${m % 60 === 0 ? "border-beige-dark/70" : "border-dashed border-beige-dark/40"} ${isFull ? "bg-[#FCE4E4]/60" : ""} ${bookable ? "hover:bg-navy/5" : ""}`;
              const pos = { top: (m - startMin) * PPM, height: 30 * PPM };
              const label =
                n > 0 ? (
                  <span className={`absolute right-1 top-0.5 z-0 text-[10px] font-semibold ${isFull ? "text-[#8A2323]" : "text-ink/40"}`}>
                    {n}/{cap}
                  </span>
                ) : null;
              return bookable ? (
                <a key={m} href={`/quan-ly/tao-lich?cn=${branchId}&ngay=${date}&gio=${hhmm}`} title={`Tạo lịch lúc ${hhmm}`} className={cls} style={pos}>
                  {label}
                </a>
              ) : (
                <div key={m} className={cls} style={pos}>
                  {label}
                </div>
              );
            })}
            {nowMin !== null && nowMin >= startMin && nowMin <= dayEndMin && (
              <div className="absolute inset-x-0 z-20 border-t-2 border-[#C94A4A]" style={{ top: (nowMin - startMin) * PPM }}>
                <span className="absolute -left-1 -top-1.5 h-3 w-3 rounded-full bg-[#C94A4A]" />
              </div>
            )}
            {blocks.map(({ item, lane }) => {
              const r = item.row;
              const top = ((item.s - dayZero) / 60000 - startMin) * PPM;
              const h = Math.max(((item.e - item.s) / 60000) * PPM - 2, 22);
              const skin = skinOfAppt.get(r.id);
              const names = [...r.appointment_services]
                .sort((x, y) => x.start_at.localeCompare(y.start_at))
                .map((s) => s.services?.name)
                .filter(Boolean)
                .join(", ");
              return (
                <a
                  key={r.id}
                  href={`#lh-${r.id}`}
                  className={`absolute z-10 overflow-hidden rounded-md border-l-4 px-1.5 py-1 text-[11px] leading-tight shadow-sm hover:z-30 hover:shadow-md ${BLOCK_STYLE[r.status] ?? BLOCK_STYLE.confirmed}`}
                  style={{ top: top + 1, height: h, left: `calc(${(lane * 100) / lanes}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
                  title={`${formatTime(r.start_at)} ${r.customers?.full_name ?? ""} – ${names}`}
                >
                  <span className="flex items-center gap-1 font-bold">
                    {formatTime(r.start_at)}
                    {skin && <SkinDot color={skin.overall} size="h-2 w-2" />}
                  </span>
                  <span className="block truncate font-semibold">{r.customers?.full_name ?? "—"}</span>
                  {h > 50 && <span className="block truncate opacity-80">{names || "Chưa chọn dịch vụ"}</span>}
                  {h > 70 && <span className="block truncate opacity-70">{STATUS_LABEL[r.status]}</span>}
                </a>
              );
            })}
            {rows.length === 0 && (
              <p className="absolute inset-x-0 top-6 text-center text-sm text-ink/50">Chưa có lịch hẹn trong ngày này.</p>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink/60">
          {["pending", "confirmed", "in_progress", "completed"].map((s) => (
            <span key={s} className={`rounded px-1.5 py-0.5 ${BLOCK_STYLE[s]} border-l-4`}>{STATUS_LABEL[s]}</span>
          ))}
          <span>Bấm vào ô trống để tạo lịch giờ đó</span>
          <Link href={link({ tt: filter === "active" ? "all" : "active" })} className="ml-auto text-xs text-navy underline">
            {filter === "active" ? "Hiện cả lịch đã huỷ" : "Ẩn lịch đã huỷ"}
          </Link>
        </div>
        {profile?.role === "owner" && branch && (
          <div className="mt-2 border-t border-beige pt-2">
            <CapacityEditor branchId={branch.id} branchName={branch.name} current={cap} />
          </div>
        )}
      </div>

      {/* ===== Chi tiết từng lịch ===== */}
      <div className="space-y-3">
        {rows.map((r) => {
          const items = [...r.appointment_services].sort((x, y) => x.start_at.localeCompare(y.start_at));
          const total = items.reduce((a, s) => a + (s.price ?? 0), 0);
          const skin = skinOfAppt.get(r.id);
          const prevSkin = lastSkinBefore(r);
          const canSkin = ["in_progress", "completed"].includes(r.status);
          const backHere = encodeURIComponent(link({}) + `#lh-${r.id}`);
          return (
            <div id={`lh-${r.id}`} key={r.id} className={`card scroll-mt-24 ${r.status === "pending" ? "border-l-4 border-l-[#E0A526]" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-4">
                  <div className="text-center">
                    <p className="text-xl font-bold text-navy">{formatTime(r.start_at)}</p>
                    {r.end_at && <p className="text-xs text-ink/50">{formatTime(r.end_at)}</p>}
                  </div>
                  <div>
                    <Link href={`/quan-ly/khach-hang?id=${r.customer_id}`} className="font-semibold hover:underline">{r.customers?.full_name ?? "—"}</Link>
                    {r.customers?.phone && (
                      <a href={`tel:${r.customers.phone}`} className="block text-sm text-navy underline">{r.customers.phone}</a>
                    )}
                    <p className="text-xs text-ink/50">{SOURCE_LABEL[r.source] ?? r.source}</p>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[r.status] ?? ""}`}>
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
              </div>

              {prevSkin && !skin && (
                <p className="mt-3 flex items-start gap-2 rounded-lg bg-cream px-3 py-2 text-xs">
                  <SkinDot color={prevSkin.overall} />
                  <span>
                    <b>Buổi trước ({prevSkin.record_date.split("-").reverse().join("/")}):</b>{" "}
                    {[prevSkin.need_tags?.join(", "), prevSkin.customer_needs, prevSkin.recommendation && `Đề xuất: ${prevSkin.recommendation}`]
                      .filter(Boolean)
                      .join(" · ") || "không ghi chú"}
                  </span>
                </p>
              )}

              <ul className="mt-3 space-y-1 border-t border-beige pt-3 text-sm">
                {items.length === 0 && <li className="text-ink/60">Chưa chọn dịch vụ – quản lý tư vấn khi khách đến.</li>}
                {items.map((s) => (
                  <li key={s.id} className="py-1">
                    <div className="flex justify-between gap-3">
                      <span>
                        <span className="text-ink/50">{formatTime(s.start_at)}</span> {s.services?.name}
                      </span>
                      <span className="shrink-0 text-ink/60">{formatVnd(s.price)}</span>
                    </div>
                    {manager && !["cancelled", "no_show"].includes(r.status) ? (
                      <DurationEditor serviceRowId={s.id} minutes={Math.round((new Date(s.end_at).getTime() - new Date(s.start_at).getTime()) / 60000)} />
                    ) : (
                      <span className="text-xs text-ink/50">
                        {formatTime(s.start_at)} – {formatTime(s.end_at)}
                      </span>
                    )}
                    {canAssign && (
                      <TechnicianPicker
                        serviceRowId={s.id}
                        current={s.technician_id}
                        start={s.start_at}
                        end={s.end_at}
                        locked={r.status === "cancelled" || r.status === "no_show" || r.status === "completed"}
                        technicians={technicians}
                        busy={busy}
                        branches={branches}
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

              {canSkin && (
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-beige pt-3 text-sm">
                  {skin ? (
                    <>
                      <span className="flex items-center gap-2">
                        Phiếu da <SkinBadge color={skin.overall} />
                      </span>
                      <Link href={`/quan-ly/phieu-da?id=${skin.id}&back=${backHere}`} className="text-navy underline">Xem / sửa</Link>
                    </>
                  ) : (
                    <>
                      <span className="text-[#7A5600]">Chưa có phiếu theo dõi da</span>
                      <Link href={`/quan-ly/phieu-da?lich=${r.id}&back=${backHere}`} className="btn-outline py-1.5">Ghi phiếu da</Link>
                    </>
                  )}
                </div>
              )}

              {invoiceOf.get(r.id) ? (
                <p className="mt-3 flex items-center justify-between border-t border-beige pt-3 text-sm">
                  <span className="font-semibold text-[#22612A]">✓ Đã thanh toán</span>
                  <Link href={`/quan-ly/hoa-don/${invoiceOf.get(r.id)!.id}`} className="text-navy underline">{invoiceOf.get(r.id)!.code}</Link>
                </p>
              ) : (
                <>
                  <StatusActions id={r.id} status={r.status} />
                  {cashier && ["confirmed", "in_progress", "completed"].includes(r.status) && (
                    <div className="mt-2 flex justify-end">
                      <Link href={`/quan-ly/thu-tien?lich=${r.id}`} className="btn-primary bg-brown py-2 hover:bg-[#87704f]">
                        Thu tiền
                      </Link>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
