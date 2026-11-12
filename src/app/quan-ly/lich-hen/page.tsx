import { activeBranches } from "@/lib/refData";
import Link from "next/link";
import { fillPhones } from "@/lib/phones";
import { redirect } from "next/navigation";
import { getCurrentUser, isStaffRole } from "@/lib/supabase/server";
import { STATUS_LABEL, STATUS_STYLE, formatDate, formatTime, formatVnd, todayVn, vnDateTime } from "@/lib/format";
import StatusActions from "./StatusActions";
import ConfirmAppointment from "./ConfirmAppointment";
import ConsultTechPicker from "./ConsultTechPicker";
import TechnicianPicker from "./TechnicianPicker";
import CapacityEditor from "./CapacityEditor";
import DurationEditor from "./DurationEditor";
import { canCheckout, fetchBusy, fetchTechnicians } from "@/lib/staff";
import {
  DEFAULT_CAPACITY,
  WEEKDAYS,
  addDays,
  assignLanes,
  daySlots,
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
import StatTile, { Delta } from "@/components/StatTile";

export const metadata = { title: "Lịch hẹn spa – Moana Beauty" };

type Row = {
  id: string;
  customer_id: string;
  start_at: string;
  end_at: string | null;
  status: string;
  source: string;
  note: string | null;
  ktv_confirmed_at: string | null;
  ktv_confirmed_auto: boolean;
  is_consultation: boolean;
  consult_technician_id: string | null;
  customers: { id: string; full_name: string; phone: string | null; note: string | null } | null;
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
  confirmed: "bg-[#E9EAF3] border-navy text-navy",
  in_progress: "bg-[#F3ECE1] border-[#A0845E] text-[#5E4B30]",
  completed: "bg-[#E3F3E5] border-[#3E9B4F] text-[#1D5224]",
  cancelled: "bg-[#F1F1F1] border-[#999] text-[#777] line-through",
  no_show: "bg-[#FCE4E4] border-[#C94A4A] text-[#8A2323] line-through",
};

const LEVEL_STYLE = {
  empty: "bg-cream/60",
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
  if (profile?.role === "marketing") redirect("/quan-ly/marketing"); // Marketing không xem khách hàng
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
  // KTV dùng app riêng: không xem lịch của KTV khác
  if (profile?.role === "technician") redirect("/quan-ly/ktv/dat-lich");
  const sp = await searchParams;
  const today = todayVn();
  const date = sp.ngay && /^\d{4}-\d{2}-\d{2}$/.test(sp.ngay) ? sp.ngay : today;
  const ym = sp.thang && /^\d{4}-\d{2}$/.test(sp.thang) ? sp.thang : monthOf(date);
  // đến giờ hẹn mà KTV chưa xác nhận -> tự nhận (chạy cùng lúc với lấy chi nhánh)
  const [, { data: branchData }] = await Promise.all([
    supabase.rpc("ktv_auto_accept"),
    activeBranches(),
  ]);
  const branches = (branchData ?? []) as { id: string; name: string; max_per_slot: number | null }[];
  const branchId = sp.cn ?? profile?.branch_id ?? branches[0]?.id ?? "";
  const branch = branches.find((b) => b.id === branchId);
  const cap = branch?.max_per_slot ?? DEFAULT_CAPACITY;
  const filter = sp.tt ?? "active";

  // ---- dữ liệu cả tháng (ô lịch) ----
  const grid = monthGrid(ym);
  const gridFrom = grid[0][0].date;
  const gridTo = addDays(grid[grid.length - 1][6].date, 1);
  const monthQ = supabase
    .from("appointments")
    .select("id, start_at, end_at, status")
    .eq("branch_id", branchId)
    .gte("start_at", vnDateTime(gridFrom, "00:00").toISOString())
    .lt("start_at", vnDateTime(gridTo, "00:00").toISOString())
    .not("status", "in", "(cancelled,no_show)");

  // ---- dữ liệu ngày đang chọn ----
  const from = vnDateTime(date, "00:00").toISOString();
  const to = vnDateTime(addDays(date, 1), "00:00").toISOString();
  let q = supabase
    .from("appointments")
    .select(
      "id, customer_id, start_at, end_at, status, source, note, ktv_confirmed_at, ktv_confirmed_auto, is_consultation, consult_technician_id, customers(id, full_name, note), appointment_services(id, start_at, end_at, price, technician_id, services(name))",
    )
    .eq("branch_id", branchId)
    .gte("start_at", from)
    .lt("start_at", to)
    .order("start_at");
  if (filter === "active") q = q.not("status", "in", "(cancelled,no_show)");
  // lịch cả tháng + lịch trong ngày + KTV + giờ bận: lấy cùng lúc
  const [{ data: monthData }, { data, error }, technicians, busy] = await Promise.all([
    monthQ,
    q,
    fetchTechnicians(supabase),
    fetchBusy(supabase, from, to),
  ]);
  const monthRows = (monthData ?? []) as { id: string; start_at: string; end_at: string | null; status: string }[];
  const byDay = new Map<string, typeof monthRows>();
  for (const r of monthRows) {
    const d = vnDayOf(r.start_at);
    const list = byDay.get(d);
    if (list) list.push(r);
    else byDay.set(d, [r]);
  }
  const rows = (data ?? []) as unknown as Row[];
  await fillPhones(supabase, rows.map((r) => r.customers));
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
  const height = (dayEndMin - startMin) * PPM;
  const hours: number[] = [];
  for (let m = startMin; m <= dayEndMin; m += 60) hours.push(m);
  const halfHours: number[] = [];
  for (let m = startMin; m < dayEndMin; m += 30) halfHours.push(m);
  const nowMin = date === today ? (Date.now() - dayZero) / 60000 : null;
  const dayPeak = peakLoad(intervals, vnTime(date, "00:00"), vnTime(addDays(date, 1), "00:00"));
  const dayFull = fullSlots(intervals, date, cap);
  const manager = profile?.role === "owner" || profile?.role === "manager";

  // ---- timeline chia cột theo KTV: mỗi dịch vụ là 1 thẻ nằm ở cột KTV làm dịch vụ đó ----
  type Card = { key: string; r: Row; s: number; e: number; title: string; col: string };
  const cards: Card[] = [];
  for (const r of rows) {
    if (r.appointment_services.length === 0) {
      const s0 = new Date(r.start_at).getTime();
      cards.push({ key: r.id, r, s: s0, e: r.end_at ? new Date(r.end_at).getTime() : s0 + 3600000, title: "Hẹn tư vấn", col: r.consult_technician_id ?? "none" });
    } else {
      for (const x of r.appointment_services)
        cards.push({ key: x.id, r, s: new Date(x.start_at).getTime(), e: new Date(x.end_at).getTime(), title: x.services?.name ?? "Dịch vụ", col: x.technician_id ?? "none" });
    }
  }
  const techName = new Map(technicians.map((t) => [t.id, t.full_name ?? "KTV"]));
  const colIds: string[] = technicians.filter((t) => t.role === "technician" && t.branch_id === branchId).map((t) => t.id);
  for (const c of cards) if (c.col !== "none" && !colIds.includes(c.col)) colIds.push(c.col);
  if (cards.some((c) => c.col === "none") || colIds.length === 0) colIds.push("none");
  const columns = colIds.map((id) => {
    const mine = cards.filter((c) => c.col === id);
    const placed = assignLanes(mine);
    return {
      id,
      name: id === "none" ? "Chưa xếp KTV" : techName.get(id) ?? "KTV khác",
      placed,
      lanes: Math.max(1, ...placed.map((p) => p.lane + 1)),
      count: new Set(mine.filter((c) => !["cancelled", "no_show"].includes(c.r.status)).map((c) => c.r.id)).size,
    };
  });
  const COL_MIN = 150;

  // ---- chỉ số trên cùng ----
  const prevDay = addDays(date, -1);
  const prevKnown = prevDay >= gridFrom && date < gridTo;
  const prevCount = (byDay.get(prevDay) ?? []).length;
  const slotsTotal = daySlots().length;
  const freeSlots = slotsTotal - dayFull;
  const expected = active.reduce((a, r) => a + r.appointment_services.reduce((b, x) => b + Number(x.price ?? 0), 0), 0);
  const initialsOf = (n: string) =>
    n === "Chưa xếp KTV" ? "?" : n.trim().split(/\s+/).slice(-1)[0]?.[0]?.toUpperCase() ?? "K";

  return (
    <div className="page-wide space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brown">Lịch hẹn spa</p>
          <h1 className="mt-1 capitalize text-navy">{formatDate(vnDateTime(date, "12:00").toISOString())}</h1>
          <p className="mt-1 text-sm text-ink/60">
            Tối đa <b>{cap} khách</b> cùng lúc mỗi chi nhánh{manager && " (chủ / quản lý vẫn xếp thêm được)"}
          </p>
        </div>
        <Link href={`/quan-ly/tao-lich?cn=${branchId}&ngay=${date}`} className="btn-primary px-6 py-3 shadow-[0_8px_20px_-8px_rgba(43,45,100,0.6)]">
          <span className="text-lg leading-none">+</span> Tạo lịch
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-full bg-surface p-1 ring-1 ring-beige-dark/70">
          {branches.map((b) => (
            <Link
              key={b.id}
              href={link({ cn: b.id })}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${b.id === branchId ? "bg-navy text-white shadow" : "text-navy/70 hover:text-navy"}`}
            >
              {b.name}
            </Link>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1 rounded-full bg-surface p-1 ring-1 ring-beige-dark/70">
          <Link href={link({ ngay: addDays(date, -1), thang: null })} className="rounded-full px-3 py-1.5 text-navy hover:bg-cream" aria-label="Ngày trước">‹</Link>
          <Link href={link({ ngay: today, thang: null })} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${date === today ? "bg-gold-soft text-navy" : "text-navy/70 hover:bg-cream"}`}>Hôm nay</Link>
          <Link href={link({ ngay: addDays(date, 1), thang: null })} className="rounded-full px-3 py-1.5 text-navy hover:bg-cream" aria-label="Ngày sau">›</Link>
        </div>
      </div>

      {/* ===== Chỉ số trong ngày ===== */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatTile
          label={date === today ? "Khách hôm nay" : "Khách trong ngày"}
          icon="users"
          value={active.length}
          foot={prevKnown ? <Delta now={active.length} prev={prevCount} label="so với hôm trước" /> : <span className="text-xs text-ink/55">Đông nhất {dayPeak}/{cap} cùng lúc</span>}
        />
        <StatTile
          label="Khung giờ còn trống"
          icon="clock"
          value={<>{freeSlots}<span className="text-base font-semibold text-ink/40">/{slotsTotal}</span></>}
          tone={freeSlots === 0 ? "alert" : dayFull > 0 ? "gold" : "default"}
          foot={<span className="text-xs text-ink/55">Suất 30 phút, 9:00 – 19:30{dayFull > 0 ? ` · ${dayFull} suất đã kín` : ""}</span>}
        />
        <StatTile
          label="Doanh thu dự kiến"
          icon="money"
          value={<span className="text-[0.8em]">{formatVnd(expected)}</span>}
          foot={<span className="text-xs text-ink/55">Theo giá dịch vụ đã đặt</span>}
        />
        <StatTile
          label="Chờ xác nhận"
          icon="alert"
          value={pendingCount}
          tone={pendingCount ? "gold" : "default"}
          foot={<span className="text-xs text-ink/55">{pendingCount ? "Cần KTV nhận / chọn KTV" : "Đã xác nhận hết"}</span>}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
        {/* ===== Lịch trong ngày: cột theo KTV ===== */}
        <div className="card min-w-0 p-3 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-navy">Lịch theo kỹ thuật viên</h2>
            <p className="text-xs text-ink/55">
              {active.length} khách · đông nhất {dayPeak}/{cap} cùng lúc
              {dayFull > 0 && <span className="text-[#8A2323]"> · {dayFull} suất đã kín</span>}
            </p>
          </div>
          {error && <p className="text-sm text-[#8A2323]">Không tải được lịch: {error.message}</p>}

          <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
            <div style={{ minWidth: 60 + columns.length * COL_MIN }}>
              {/* tên KTV trên đầu cột */}
              <div className="sticky top-0 z-30 flex border-b border-beige-dark/60 bg-surface pb-2">
                <div className="w-[60px] shrink-0" />
                {columns.map((c) => (
                  <div key={c.id} className="flex min-w-0 flex-1 items-center gap-2 px-2" style={{ minWidth: COL_MIN }}>
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold ${c.id === "none" ? "bg-[#ECECEC] text-[#666]" : "bg-linear-to-br from-gold to-brown text-white"}`}>
                      {initialsOf(c.name)}
                    </span>
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate text-sm font-semibold">{c.name}</span>
                      <span className="block text-[11px] text-ink/50">{c.count ? `${c.count} khách` : "Trống lịch"}</span>
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex pt-2">
                {/* trục giờ bên trái + số khách / suất */}
                <div className="relative w-[60px] shrink-0" style={{ height }}>
                  {hours.map((m) => (
                    <span key={m} className="absolute -translate-y-1/2 text-[11px] font-semibold text-ink/55" style={{ top: (m - startMin) * PPM }}>
                      {String(Math.floor(m / 60)).padStart(2, "0")}:00
                    </span>
                  ))}
                  {halfHours.map((m) => {
                    const s0 = dayZero + m * 60000;
                    const n = intervals.filter((x) => x.s < s0 + 30 * 60000 && x.e > s0).length;
                    return n > 0 ? (
                      <span
                        key={m}
                        className={`absolute right-1.5 text-[10px] font-bold ${n >= cap ? "text-[#8A2323]" : "text-ink/35"}`}
                        style={{ top: (m - startMin) * PPM + 15 * PPM - 6 }}
                        title={`${n}/${cap} khách cùng lúc`}
                      >
                        {n}/{cap}
                      </span>
                    ) : null;
                  })}
                </div>

                {/* vùng lịch */}
                <div className="relative flex-1 overflow-hidden rounded-2xl border border-beige-dark/50 bg-cream/40" style={{ height }}>
                  {/* hàng 30 phút: bấm ô trống để tạo lịch, tô đỏ nhạt khi đã kín */}
                  {halfHours.map((m) => {
                    const s0 = dayZero + m * 60000;
                    const n = intervals.filter((x) => x.s < s0 + 30 * 60000 && x.e > s0).length;
                    const isFull = n >= cap;
                    const hhmm = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
                    const bookable = s0 + 30 * 60000 > Date.now() && (!isFull || manager);
                    const cls = `absolute inset-x-0 block border-t ${m % 60 === 0 ? "border-beige-dark/70" : "border-dashed border-beige-dark/35"} ${isFull ? "bg-[#FCE4E4]/70" : ""} ${bookable ? "hover:bg-gold/10" : ""}`;
                    const pos = { top: (m - startMin) * PPM, height: 30 * PPM };
                    return bookable ? (
                      <a key={m} href={`/quan-ly/tao-lich?cn=${branchId}&ngay=${date}&gio=${hhmm}`} title={`Tạo lịch lúc ${hhmm}`} className={cls} style={pos} />
                    ) : (
                      <div key={m} className={cls} style={pos} title={isFull ? `${hhmm}: đã đủ ${cap} khách` : undefined} />
                    );
                  })}

                  {/* các cột KTV */}
                  <div className="pointer-events-none absolute inset-0 flex">
                    {columns.map((c, ci) => (
                      <div key={c.id} className={`relative min-w-0 flex-1 ${ci > 0 ? "border-l border-beige-dark/40" : ""}`} style={{ minWidth: COL_MIN }}>
                        {c.placed.map(({ item, lane }) => {
                          const r = item.r;
                          const top = ((item.s - dayZero) / 60000 - startMin) * PPM;
                          const h = Math.max(((item.e - item.s) / 60000) * PPM - 3, 26);
                          const skin = skinOfAppt.get(r.id);
                          return (
                            <a
                              key={item.key}
                              href={`#lh-${r.id}`}
                              className={`pointer-events-auto absolute z-10 overflow-hidden rounded-xl border-l-[3px] px-2 py-1.5 text-[11px] leading-tight shadow-sm transition hover:z-20 hover:shadow-md ${BLOCK_STYLE[r.status] ?? BLOCK_STYLE.confirmed}`}
                              style={{ top: top + 1.5, height: h, left: `calc(${(lane * 100) / c.lanes}% + 3px)`, width: `calc(${100 / c.lanes}% - 6px)` }}
                              title={`${formatTime(new Date(item.s).toISOString())}–${formatTime(new Date(item.e).toISOString())} · ${r.customers?.full_name ?? ""} · ${item.title}`}
                            >
                              <span className="flex items-center gap-1 truncate font-semibold opacity-80">
                                {formatTime(new Date(item.s).toISOString())} – {formatTime(new Date(item.e).toISOString())}
                                {skin && <SkinDot color={skin.overall} size="h-2 w-2" />}
                              </span>
                              <span className="block truncate text-[12px] font-bold">{r.customers?.full_name ?? "—"}</span>
                              {h > 48 && <span className="block truncate opacity-80">{item.title}</span>}
                              {h > 68 && <span className="block truncate opacity-60">{STATUS_LABEL[r.status]}</span>}
                            </a>
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  {nowMin !== null && nowMin >= startMin && nowMin <= dayEndMin && (
                    <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-[#C94A4A]" style={{ top: (nowMin - startMin) * PPM }}>
                      <span className="absolute -left-1 -top-1.5 h-3 w-3 rounded-full bg-[#C94A4A]" />
                    </div>
                  )}
                  {rows.length === 0 && (
                    <p className="pointer-events-none absolute inset-x-0 top-6 text-center text-sm text-ink/50">Chưa có lịch hẹn trong ngày này.</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-ink/60">
            {["pending", "confirmed", "in_progress", "completed"].map((st) => (
              <span key={st} className={`rounded-md border-l-[3px] px-1.5 py-0.5 ${BLOCK_STYLE[st]}`}>{STATUS_LABEL[st]}</span>
            ))}
            <span>Bấm vào ô trống để tạo lịch giờ đó</span>
            <Link href={link({ tt: filter === "active" ? "all" : "active" })} className="ml-auto text-xs font-semibold text-brown hover:underline">
              {filter === "active" ? "Hiện cả lịch đã huỷ" : "Ẩn lịch đã huỷ"}
            </Link>
          </div>
        </div>

        {/* ===== Lịch tháng ===== */}
        <aside className="space-y-4">
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <Link href={link({ thang: shiftMonth(ym, -1) })} className="flex h-8 w-8 items-center justify-center rounded-full text-navy hover:bg-cream" aria-label="Tháng trước">‹</Link>
              <div className="text-center">
                <p className="font-display text-lg font-bold text-navy">{monthLabel(ym)}</p>
                {ym !== monthOf(today) && (
                  <Link href={link({ ngay: today, thang: null })} className="text-xs text-brown underline">Về hôm nay</Link>
                )}
              </div>
              <Link href={link({ thang: shiftMonth(ym, 1) })} className="flex h-8 w-8 items-center justify-center rounded-full text-navy hover:bg-cream" aria-label="Tháng sau">›</Link>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[10.5px] font-semibold text-ink/45">
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
                return (
                  <Link
                    key={g.date}
                    href={link({ ngay: g.date, thang: null })}
                    title={list.length ? `${list.length} khách${full ? ` · ${full} suất kín` : ""}${pend ? ` · ${pend} chờ xác nhận` : ""}` : undefined}
                    className={`relative flex aspect-square flex-col items-center justify-center rounded-xl text-xs transition ${
                      selected ? "bg-navy font-bold text-white shadow" : `${LEVEL_STYLE[level]} hover:ring-1 hover:ring-gold`
                    } ${g.inMonth ? "" : "opacity-35"}`}
                  >
                    <span className={isToday && !selected ? "font-bold text-brown underline decoration-gold decoration-2 underline-offset-2" : ""}>{Number(g.date.slice(8))}</span>
                    {list.length > 0 && <span className={`text-[9.5px] leading-none ${selected ? "text-white/75" : "text-ink/50"}`}>{list.length}</span>}
                    {pend > 0 && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#E0A526]" />}
                  </Link>
                );
              })}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[10.5px] text-ink/55">
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-[#E9EAF3]" /> Còn chỗ</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-[#F3ECE1]" /> Có giờ đã kín</span>
              <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-[#FCE4E4]" /> Kín cả ngày</span>
              <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-[#E0A526]" /> Chờ xác nhận</span>
            </div>
          </div>
          {profile?.role === "owner" && branch && (
            <div className="card p-4">
              <CapacityEditor branchId={branch.id} branchName={branch.name} current={cap} />
            </div>
          )}
        </aside>
      </div>

      <h2 className="pt-2 text-navy">Chi tiết từng lịch hẹn</h2>
      {/* ===== Chi tiết từng lịch ===== */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
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
                    <p className="text-xs text-ink/50">{SOURCE_LABEL[r.source] ?? r.source}{r.is_consultation ? " · hẹn tư vấn" : ""}</p>
                    {!["cancelled", "no_show", "completed"].includes(r.status) && (
                      <p className={`text-xs ${r.status !== "pending" && r.ktv_confirmed_at ? "text-[#22612A]" : "text-[#7A5600]"}`}>
                        {r.status === "pending"
                          ? "⏳ Chờ xác nhận – KTV bấm nhận hoặc lễ tân / quản lý chọn KTV"
                          : r.ktv_confirmed_at
                            ? r.ktv_confirmed_auto
                              ? "✓ Hệ thống tự nhận lịch (đến giờ hẹn)"
                              : "✓ Đã xác nhận, đã có KTV"
                            : "⏳ KTV chưa nhận lịch"}
                      </p>
                    )}
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
                {items.length === 0 && (
                  <li className="space-y-1">
                    <p className="text-ink/60">Chưa chọn liệu trình – hẹn tư vấn, KTV chọn liệu trình khi khách đến.</p>
                    {canAssign && r.status !== "pending" && (
                      <ConsultTechPicker
                        id={r.id}
                        current={r.consult_technician_id}
                        locked={["cancelled", "no_show", "completed"].includes(r.status)}
                        technicians={technicians}
                        branches={branches}
                      />
                    )}
                  </li>
                )}
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
                  {r.status === "pending" ? (
                    <ConfirmAppointment
                      id={r.id}
                      needTech={items.some((s) => !s.technician_id) || (items.length === 0 && !r.consult_technician_id)}
                      consult={items.length === 0}
                      start={r.start_at}
                      end={r.end_at ?? new Date(new Date(r.start_at).getTime() + 3600000).toISOString()}
                      technicians={technicians}
                      busy={busy}
                      branches={branches}
                    />
                  ) : (
                    <StatusActions id={r.id} status={r.status} />
                  )}
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
