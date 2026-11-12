import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, isStaffRole } from "@/lib/supabase/server";
import { STATUS_LABEL, STATUS_STYLE, formatDate, formatTime, formatVnd, nowVnHHMM, todayVn, vnDateTime } from "@/lib/format";
import StatTile, { Delta, TileIconSvg } from "@/components/StatTile";
import { loadNavCounts } from "@/lib/navCounts";
import KtvHome from "./ktv/KtvHome";

export const metadata = { title: "Tổng quan – Moana Beauty" };

type Appt = {
  id: string; start_at: string; status: string; branch_id: string;
  customers: { full_name: string } | null;
  appointment_services: { services: { name: string } | null }[];
};

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  // đường dẫn cũ /quan-ly?ngay=…&cn=… (lịch hẹn) → trang Lịch hẹn mới
  if (sp.ngay || sp.cn || sp.tt) {
    const p = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
    redirect(`/quan-ly/lich-hen?${p.toString()}`);
  }
  const { supabase, profile } = await getCurrentUser();
  if (!isStaffRole(profile?.role)) return null; // layout đã báo
  const role = profile!.role;
  if (role === "technician") return <KtvHome profile={profile!} />;
  if (role === "marketing") redirect("/quan-ly/marketing");
  const M = role === "owner" || role === "manager";
  const O = role === "owner";
  const W = role === "warehouse";
  const today = todayVn();
  const from = vnDateTime(today, "00:00").toISOString();
  const to = vnDateTime(todayVn(1), "00:00").toISOString();
  const myBranch = M ? null : profile!.branch_id;

  const counts = await loadNavCounts(role, profile!.branch_id);
  // chủ / quản lý: mọi việc cần duyệt mở thẳng trang Việc chờ duyệt (đúng mục)
  const cd = (hash: string, own: string) => (M ? `/quan-ly/cho-duyet#${hash}` : own);
  const approvals = [
    { n: counts.discounts, label: O ? "Giảm giá / cho nợ chờ duyệt" : "Cho nợ chờ duyệt", href: cd("giam-gia", "/quan-ly/duyet-giam-gia") },
    { n: counts.vouchers, label: "Thu chi tiền mặt tại spa", href: cd("thu-chi", "/quan-ly/phieu-thu-chi") },
    { n: counts.stockRequests, label: "Phiếu xin xuất kho", href: cd("xin-xuat", "/quan-ly/kho/xin-xuat") },
    { n: counts.stockCounts, label: "Kiểm kho bị lệch", href: cd("kiem-kho", "/quan-ly/kho/kiem-kho") },
    { n: counts.receipts, label: "Phiếu nhập chờ duyệt giá", href: cd("nhap-hang", "/quan-ly/kho/nhap-hang") },
    { n: counts.promos, label: "Khách đăng ký khuyến mãi", href: "/quan-ly/khuyen-mai" },
    { n: counts.attendance, label: "Chấm công / tăng ca", href: cd("cham-cong", "/quan-ly/cham-cong") },
    { n: counts.leaves, label: "Đơn nghỉ phép", href: cd("nghi-phep", "/quan-ly/nghi-phep") },
    { n: counts.ktv, label: "KTV: đổi sản phẩm / chấm công", href: cd("ktv", "/quan-ly/theo-doi-ktv") },
    { n: O ? counts.marketing : 0, label: "Bài Marketing chờ duyệt", href: cd("marketing", "/quan-ly/marketing") },
  ].filter((a) => a.n > 0 && (M || a.href === "/quan-ly/khuyen-mai" || (W && a.href.startsWith("/quan-ly/kho"))));

  // hôm nay + hôm qua (để so sánh %)
  const yFrom = vnDateTime(todayVn(-1), "00:00").toISOString();
  let apptsAll: Appt[] = [];
  let money: { real: number; debt: number; debtIn: number; realY: number } | null = null;
  let lowStock = 0;
  let outStock = 0;
  if (!W) {
    let q = supabase
      .from("appointments")
      .select("id, start_at, status, branch_id, customers(full_name), appointment_services(services(name))")
      .gte("start_at", yFrom)
      .lt("start_at", to)
      .order("start_at");
    if (myBranch) q = q.eq("branch_id", myBranch);
    const { data } = await q;
    apptsAll = (data ?? []) as unknown as Appt[];
  }
  if (M) {
    const [{ data: pays }, { data: inv }, { data: dIn }] = await Promise.all([
      supabase.from("payments").select("amount, method, invoices!inner(status, paid_at)").neq("method", "service_card")
        .eq("invoices.status", "paid").gte("invoices.paid_at", yFrom).lt("invoices.paid_at", to),
      supabase.from("invoices").select("debt_amount").eq("status", "paid").gt("debt_amount", 0).gte("paid_at", from).lt("paid_at", to),
      supabase.from("debt_payments").select("amount, created_at").gte("created_at", yFrom).lt("created_at", to),
    ]);
    type Pay = { amount: number; invoices: { paid_at: string } | { paid_at: string }[] | null };
    const paidAt = (p: Pay) => (Array.isArray(p.invoices) ? p.invoices[0]?.paid_at : p.invoices?.paid_at) ?? "";
    const isToday = (iso: string) => iso >= from;
    const P = (pays ?? []) as unknown as Pay[];
    const D = (dIn ?? []) as { amount: number; created_at: string }[];
    const sumP = (today: boolean) => P.filter((p) => isToday(new Date(paidAt(p)).toISOString()) === today).reduce((a, x) => a + Number(x.amount ?? 0), 0);
    const sumD = (today: boolean) => D.filter((d) => isToday(new Date(d.created_at).toISOString()) === today).reduce((a, x) => a + Number(x.amount ?? 0), 0);
    money = {
      real: sumP(true) + sumD(true),
      realY: sumP(false) + sumD(false),
      debt: ((inv ?? []) as { debt_amount: number }[]).reduce((a, x) => a + Number(x.debt_amount ?? 0), 0),
      debtIn: sumD(true),
    };
  }
  if (W || M) {
    let lq = supabase.from("stock_levels").select("product_id, quantity, branch_id");
    if (W && profile!.branch_id) lq = lq.eq("branch_id", profile!.branch_id);
    const [{ data: lv }, { data: ps }] = await Promise.all([lq, supabase.from("products").select("id, min_stock").eq("is_active", true)]);
    const min = new Map(((ps ?? []) as { id: string; min_stock: number }[]).map((p) => [p.id, p.min_stock]));
    const rowsLv = ((lv ?? []) as { product_id: string; quantity: number }[]).filter((r) => min.has(r.product_id));
    lowStock = rowsLv.filter((r) => Number(r.quantity) <= (min.get(r.product_id) ?? 0)).length;
    outStock = rowsLv.filter((r) => Number(r.quantity) <= 0).length;
  }

  const fromMs = new Date(from).getTime();
  const appts = apptsAll.filter((a) => new Date(a.start_at).getTime() >= fromMs);
  const apptsY = apptsAll.filter((a) => new Date(a.start_at).getTime() < fromMs);
  const live = (list: Appt[]) => list.filter((a) => !["cancelled", "no_show"].includes(a.status)).length;
  const done = (list: Appt[]) => list.filter((a) => a.status === "completed").length;
  const byStatus = (s: string) => appts.filter((a) => a.status === s).length;
  const now = Date.now();
  const upcoming = appts.filter((a) => ["pending", "confirmed", "in_progress"].includes(a.status) && new Date(a.start_at).getTime() > now - 3600000).slice(0, 7);

  const bookHref = W ? "/quan-ly/ktv/dat-lich" : "/quan-ly/tao-lich";
  const actions = W
    ? [
        { href: "/quan-ly/kho/nhap-hang", label: "Nhập hàng", icon: "inbox" as const },
        { href: "/quan-ly/kho/kiem-kho", label: "Kiểm kho", icon: "check" as const },
        { href: "/quan-ly/kho/chuyen-kho", label: "Chuyển kho", icon: "layers" as const },
        { href: "/quan-ly/phieu-thu-chi", label: "Thu chi tiền mặt", icon: "money" as const },
      ]
    : [
        { href: "/quan-ly/thu-tien", label: "Thu tiền / bán hàng", icon: "money" as const },
        { href: "/quan-ly/lich-hen", label: "Xem lịch hẹn", icon: "calendar" as const },
        { href: "/quan-ly/phieu-thu-chi", label: "Thu chi tiền mặt", icon: "inbox" as const },
        { href: "/quan-ly/kho/xin-xuat", label: "Xin xuất hàng", icon: "box" as const },
      ];
  const hour = Number(nowVnHHMM().slice(0, 2));
  const hello = hour < 11 ? "Chào buổi sáng" : hour < 14 ? "Chào buổi trưa" : hour < 18 ? "Chào buổi chiều" : "Chào buổi tối";
  const firstName = (profile!.full_name ?? "bạn").trim().split(/\s+/).pop();

  return (
    <div className="page-wide space-y-6">
      {/* lời chào */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brown">
            {formatDate(vnDateTime(today, "12:00").toISOString())}
          </p>
          <h1 className="mt-1 text-navy">
            {hello}, {firstName} <span className="text-gold">✦</span>
          </h1>
          <p className="mt-1 text-sm text-ink/60">
            {W ? "Tình hình kho hôm nay của chi nhánh bạn." : `Hôm nay có ${live(appts)} lịch hẹn${myBranch ? "" : " ở cả 2 chi nhánh"}. Chúc một ngày làm việc nhẹ nhàng!`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={bookHref} className="btn-primary px-6 py-3 shadow-[0_8px_20px_-8px_rgba(43,45,100,0.6)]">
            <span className="text-lg leading-none">+</span> Đặt lịch
          </Link>
          {!W && <Link href="/quan-ly/thu-tien" className="btn-outline px-5 py-3">Thu tiền</Link>}
        </div>
      </div>

      {/* ô số liệu */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {!W && (
          <>
            <StatTile label="Lịch hẹn hôm nay" icon="calendar" value={live(appts)} foot={<Delta now={live(appts)} prev={live(apptsY)} />} href="/quan-ly/lich-hen" />
            <StatTile label="Khách đã làm xong" icon="check" value={done(appts)} foot={<Delta now={done(appts)} prev={done(apptsY)} />} />
          </>
        )}
        {money ? (
          <StatTile
            label="Tiền thực thu hôm nay"
            icon="money"
            value={<span className="text-[0.8em]">{formatVnd(money.real)}</span>}
            foot={<Delta now={money.real} prev={money.realY} />}
            href={O ? "/quan-ly/bao-cao" : undefined}
          />
        ) : (
          !W && <StatTile label="Chờ xác nhận" icon="clock" value={byStatus("pending")} tone={byStatus("pending") ? "gold" : "default"} foot={<span className="text-xs text-ink/55">Lịch khách đặt chưa có KTV nhận</span>} href="/quan-ly/lich-hen" />
        )}
        {!W && (
          <StatTile label="Khách cần gọi lại" icon="phone" value={counts.care} foot={<span className="text-xs text-ink/55">Nhắc chăm sóc đến hạn</span>} href="/quan-ly/cham-soc" />
        )}
        {W && (
          <>
            <StatTile label="Hàng sắp hết / hết" icon="alert" value={lowStock} tone={lowStock ? "alert" : "default"} foot={<span className="text-xs text-ink/55">{outStock} dòng đã hết hàng</span>} href="/quan-ly/kho" />
            <StatTile label="Phiếu xin xuất chờ duyệt" icon="box" value={counts.stockRequests} href="/quan-ly/kho/xin-xuat" />
            <StatTile label="Phiếu nhập chờ duyệt giá" icon="inbox" value={counts.receipts} href="/quan-ly/kho/nhap-hang" />
            <StatTile label="Kiểm kho chờ duyệt" icon="check" value={counts.stockCounts} href="/quan-ly/kho/kiem-kho" />
          </>
        )}
      </div>
      {money && (money.debt > 0 || money.debtIn > 0) && (
        <p className="-mt-2 text-xs text-ink/60">
          Hôm nay: khách nợ lại <b className={money.debt ? "text-[#7A5600]" : ""}>{formatVnd(money.debt)}</b> · thu nợ cũ <b>{formatVnd(money.debtIn)}</b>
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* lịch hẹn hôm nay */}
        {!W && (
          <section className="card space-y-4 lg:col-span-2">
            <div className="flex items-center justify-between">
              <h2 className="text-navy">Lịch hẹn hôm nay{myBranch ? "" : " · cả 2 chi nhánh"}</h2>
              <Link href="/quan-ly/lich-hen" className="text-sm font-semibold text-brown hover:underline">Xem lịch →</Link>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              {[
                ["pending", "Chờ xác nhận"],
                ["confirmed", "Đã xác nhận"],
                ["in_progress", "Đang làm"],
                ["completed", "Hoàn thành"],
              ].map(([k, l]) => (
                <div key={k} className="rounded-2xl bg-cream px-1 py-3">
                  <p className="font-display text-2xl font-bold text-navy">{byStatus(k)}</p>
                  <p className="mt-0.5 leading-tight text-ink/60">{l}</p>
                </div>
              ))}
            </div>
            {upcoming.length === 0 ? (
              <p className="rounded-2xl bg-cream/60 px-4 py-6 text-center text-sm text-ink/50">Không còn lịch hẹn sắp tới trong hôm nay.</p>
            ) : (
              <ul className="space-y-2">
                {upcoming.map((a) => (
                  <li key={a.id}>
                    <Link href={`/quan-ly/lich-hen#lh-${a.id}`} className="flex items-center gap-3 rounded-2xl border border-beige-dark/50 px-3 py-2.5 transition hover:border-gold hover:bg-cream/50">
                      <span className="w-14 shrink-0 rounded-xl bg-gold-soft py-1.5 text-center font-display text-base font-bold text-navy">{formatTime(a.start_at)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{a.customers?.full_name ?? "Khách"}</span>
                        <span className="block truncate text-xs text-ink/55">{a.appointment_services.map((s) => s.services?.name).filter(Boolean).join(", ") || "Hẹn tư vấn"}</span>
                      </span>
                      <span className={`chip shrink-0 ${STATUS_STYLE[a.status] ?? ""}`}>{STATUS_LABEL[a.status] ?? a.status}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className={`space-y-4 ${W ? "lg:col-span-3 lg:grid lg:grid-cols-2 lg:gap-4 lg:space-y-0" : ""}`}>
          {(M || W || approvals.length > 0) && (
            <section className="card space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-navy">Chờ duyệt / xử lý</h2>
                {M && <Link href="/quan-ly/cho-duyet" className="text-sm font-semibold text-brown hover:underline">Mở →</Link>}
              </div>
              {approvals.length === 0 ? (
                <p className="rounded-2xl bg-[#D6EDD8] px-4 py-3 text-sm text-[#22612A]">✓ Không có việc nào đang chờ.</p>
              ) : (
                <ul className="space-y-1.5">
                  {approvals.map((a) => (
                    <li key={a.href + a.label}>
                      <Link href={a.href} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm hover:bg-cream">
                        <span>{a.label}</span>
                        <b className="chip bg-[#C2410C] text-white">{a.n}</b>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="card space-y-1">
            <h2 className="mb-2 text-navy">Thao tác nhanh</h2>
            {actions.map((a) => (
              <Link key={a.href} href={a.href} className="flex items-center gap-3 rounded-xl px-2 py-2 text-sm font-medium hover:bg-cream">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gold-soft text-brown">
                  <TileIconSvg name={a.icon} className="h-4 w-4" />
                </span>
                {a.label}
                <span className="ml-auto text-ink/30">›</span>
              </Link>
            ))}
            {M && (
              <Link href="/quan-ly/kho" className="mt-2 flex items-center justify-between rounded-2xl bg-cream px-3 py-2.5 text-sm hover:ring-1 hover:ring-gold">
                <span>Hàng sắp hết / hết</span>
                <b className={lowStock ? "text-[#8A2323]" : "text-navy"}>{lowStock}</b>
              </Link>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
