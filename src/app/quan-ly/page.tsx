import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, isStaffRole } from "@/lib/supabase/server";
import { STATUS_LABEL, STATUS_STYLE, formatDate, formatTime, formatVnd, todayVn, vnDateTime } from "@/lib/format";
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

  let appts: Appt[] = [];
  let money: { real: number; debt: number; debtIn: number } | null = null;
  let lowStock = 0;
  if (!W) {
    let q = supabase
      .from("appointments")
      .select("id, start_at, status, branch_id, customers(full_name), appointment_services(services(name))")
      .gte("start_at", from)
      .lt("start_at", to)
      .order("start_at");
    if (myBranch) q = q.eq("branch_id", myBranch);
    const { data } = await q;
    appts = (data ?? []) as unknown as Appt[];
  }
  if (M) {
    const [{ data: pays }, { data: inv }, { data: dIn }] = await Promise.all([
      supabase.from("payments").select("amount, method, invoices!inner(status, paid_at)").neq("method", "service_card")
        .eq("invoices.status", "paid").gte("invoices.paid_at", from).lt("invoices.paid_at", to),
      supabase.from("invoices").select("debt_amount").eq("status", "paid").gt("debt_amount", 0).gte("paid_at", from).lt("paid_at", to),
      supabase.from("debt_payments").select("amount").gte("created_at", from).lt("created_at", to),
    ]);
    const sum = (r: { amount?: number; debt_amount?: number }[] | null, k: "amount" | "debt_amount") =>
      (r ?? []).reduce((a, x) => a + Number(x[k] ?? 0), 0);
    money = { real: sum(pays, "amount") + sum(dIn, "amount"), debt: sum(inv, "debt_amount"), debtIn: sum(dIn, "amount") };
  }
  if (W || M) {
    let lq = supabase.from("stock_levels").select("product_id, quantity, branch_id");
    if (W && profile!.branch_id) lq = lq.eq("branch_id", profile!.branch_id);
    const [{ data: lv }, { data: ps }] = await Promise.all([lq, supabase.from("products").select("id, min_stock").eq("is_active", true)]);
    const min = new Map(((ps ?? []) as { id: string; min_stock: number }[]).map((p) => [p.id, p.min_stock]));
    lowStock = ((lv ?? []) as { product_id: string; quantity: number }[]).filter(
      (r) => min.has(r.product_id) && Number(r.quantity) <= (min.get(r.product_id) ?? 0),
    ).length;
  }

  const byStatus = (s: string) => appts.filter((a) => a.status === s).length;
  const now = Date.now();
  const upcoming = appts.filter((a) => ["pending", "confirmed", "in_progress"].includes(a.status) && new Date(a.start_at).getTime() > now - 3600000).slice(0, 6);

  const actions = W
    ? [
        { href: "/quan-ly/kho/nhap-hang", label: "Nhập hàng" },
        { href: "/quan-ly/kho/kiem-kho", label: "Kiểm kho" },
        { href: "/quan-ly/kho/chuyen-kho", label: "Chuyển kho" },
        { href: "/quan-ly/phieu-thu-chi", label: "Thu chi tiền mặt" },
      ]
    : [
        { href: "/quan-ly/tao-lich", label: "+ Tạo lịch" },
        { href: "/quan-ly/thu-tien", label: "Thu tiền / bán hàng" },
        { href: "/quan-ly/phieu-thu-chi", label: "Thu chi tiền mặt" },
        { href: "/quan-ly/kho/xin-xuat", label: "Xin xuất hàng" },
      ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Xin chào, {profile!.full_name ?? "bạn"}</h1>
        <p className="text-sm capitalize text-ink/70">{formatDate(vnDateTime(today, "12:00").toISOString())}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {actions.map((a) => (
          <Link key={a.href} href={a.href} className="card p-3 text-center text-sm font-semibold text-navy hover:border-navy">
            {a.label}
          </Link>
        ))}
      </div>

      {(M || W || approvals.length > 0) && (
        <section className="card space-y-2 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-navy">Chờ duyệt / xử lý</h2>
            {M && <Link href="/quan-ly/cho-duyet" className="text-sm text-navy underline">Mở Việc chờ duyệt</Link>}
          </div>
          {approvals.length === 0 ? (
            <p className="text-sm text-[#22612A]">✓ Không có việc nào đang chờ.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {approvals.map((a) => (
                <li key={a.href}>
                  <Link href={a.href} className="flex items-center justify-between rounded-xl bg-[#FFF4DB] px-3 py-2 text-sm hover:ring-1 hover:ring-[#E0A526]">
                    <span>{a.label}</span>
                    <b className="rounded-full bg-[#C2410C] px-2 text-white">{a.n}</b>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {money && (
        <section className="grid grid-cols-3 gap-2">
          <div className="card p-3">
            <p className="text-xs text-ink/60">Tiền thực thu hôm nay</p>
            <p className="text-lg font-bold text-navy">{formatVnd(money.real)}</p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-ink/60">Khách nợ lại hôm nay</p>
            <p className={`text-lg font-bold ${money.debt ? "text-[#7A5600]" : ""}`}>{formatVnd(money.debt)}</p>
          </div>
          <div className="card p-3">
            <p className="text-xs text-ink/60">Thu nợ cũ hôm nay</p>
            <p className="text-lg font-bold">{formatVnd(money.debtIn)}</p>
          </div>
        </section>
      )}

      {!W && (
        <section className="card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-navy">Lịch hẹn hôm nay{myBranch ? "" : " (cả 2 chi nhánh)"}</h2>
            <Link href="/quan-ly/lich-hen" className="text-sm text-navy underline">Xem lịch</Link>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            {[
              ["pending", "Chờ xác nhận"],
              ["confirmed", "Đã xác nhận"],
              ["in_progress", "Đang làm"],
              ["completed", "Hoàn thành"],
            ].map(([k, l]) => (
              <div key={k} className="rounded-xl bg-cream px-1 py-2">
                <p className="text-lg font-bold text-navy">{byStatus(k)}</p>
                <p className="leading-tight text-ink/60">{l}</p>
              </div>
            ))}
          </div>
          {upcoming.length > 0 && (
            <ul className="divide-y divide-beige text-sm">
              {upcoming.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <b>{formatTime(a.start_at)}</b> {a.customers?.full_name ?? "Khách"}
                    <span className="block truncate text-xs text-ink/60">{a.appointment_services.map((s) => s.services?.name).filter(Boolean).join(", ")}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[a.status] ?? ""}`}>{STATUS_LABEL[a.status] ?? a.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {!W && (
          <Link href="/quan-ly/cham-soc" className="card flex items-center justify-between p-4 text-sm hover:border-navy">
            <span>
              <b className="text-navy">Khách cần gọi</b>
              <span className="block text-xs text-ink/60">Nhắc chăm sóc đến hạn · khách chưa quay lại theo tuần</span>
            </span>
            <b className="text-lg text-navy">{counts.care}</b>
          </Link>
        )}
        {(W || M) && (
          <Link href="/quan-ly/kho" className="card flex items-center justify-between p-4 text-sm hover:border-navy">
            <span>
              <b className="text-navy">Hàng sắp hết / hết</b>
              <span className="block text-xs text-ink/60">Số dòng tồn kho ≤ mức báo</span>
            </span>
            <b className={`text-lg ${lowStock ? "text-[#8A2323]" : "text-navy"}`}>{lowStock}</b>
          </Link>
        )}
      </div>
    </div>
  );
}
