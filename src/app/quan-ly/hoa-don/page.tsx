import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatDate, formatTime, formatVnd, todayVn, vnDateTime } from "@/lib/format";
import { METHOD_LABEL } from "@/lib/billing";
import { canCheckout } from "@/lib/staff";
import { SHIP_STATUS } from "@/lib/shipping";

export const metadata = { title: "Hoá đơn – Moana Beauty" };

type Row = {
  id: string;
  code: string;
  status: string;
  channel: string;
  paid_at: string | null;
  created_at: string;
  debt_amount: number;
  customers: { full_name: string; phone: string | null } | null;
  invoice_items: { item_type: string; description: string | null; amount: number }[];
  payments: { method: string; amount: number }[];
  debt_payments: { amount: number }[];
  invoice_shipments: { carrier: string | null; tracking_code: string | null; status: string; recipient_name: string | null; address: string | null } | null;
};
type Tab = "quay" | "online" | "no";

function shiftDate(d: string, days: number) {
  const t = vnDateTime(d, "12:00").getTime() + days * 86400000;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(t));
}
function shortDate(iso: string) {
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit" }).format(new Date(iso));
}
const SELECT =
  "id, code, status, channel, paid_at, created_at, debt_amount, customers(full_name, phone), invoice_items(item_type, description, amount), payments(method, amount), debt_payments(amount), invoice_shipments(carrier, tracking_code, status, recipient_name, address)";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ ngay?: string; cn?: string; loai?: string; gh?: string }>;
}) {
  const { supabase, profile } = await getCurrentUser();
  if (!canCheckout(profile?.role)) return <p className="card text-sm">Trang dành cho nhân viên thu ngân.</p>;
  const sp = await searchParams;
  const tab: Tab = sp.loai === "online" || sp.loai === "no" ? sp.loai : "quay";
  const date = sp.ngay && /^\d{4}-\d{2}-\d{2}$/.test(sp.ngay) ? sp.ngay : todayVn();
  const { data: branches } = await supabase.from("branches").select("id, name").eq("is_active", true).order("name");
  const branchId = sp.cn === "tat-ca" ? "" : (sp.cn ?? profile?.branch_id ?? (tab === "quay" ? branches?.[0]?.id : "") ?? "");
  const shipFilter = sp.gh && sp.gh in SHIP_STATUS ? sp.gh : "";
  const from = vnDateTime(date, "00:00").toISOString();
  const to = vnDateTime(shiftDate(date, 1), "00:00").toISOString();

  let q = supabase.from("invoices").select(SELECT).neq("status", "draft");
  if (branchId) q = q.eq("branch_id", branchId);
  if (tab === "quay") q = q.eq("channel", "store").gte("created_at", from).lt("created_at", to).order("created_at", { ascending: false });
  else if (tab === "online") {
    q = q.eq("channel", "online").order("created_at", { ascending: false }).limit(150);
  } else q = q.eq("status", "paid").gt("debt_amount", 0).order("paid_at", { ascending: true }).limit(300);
  const { data } = await q;
  let rows = (data ?? []) as unknown as Row[];
  const paidOf = (r: Row) => r.payments.reduce((a, p) => a + Number(p.amount), 0) + r.debt_payments.reduce((a, p) => a + Number(p.amount), 0);
  const totalOf = (r: Row) => r.invoice_items.reduce((a, i) => a + Number(i.amount), 0);
  const owedOf = (r: Row) => (r.status === "paid" ? Math.max(0, totalOf(r) - paidOf(r)) : 0);
  if (tab === "no") rows = rows.filter((r) => owedOf(r) > 0);
  if (tab === "online" && shipFilter) rows = rows.filter((r) => (r.invoice_shipments?.status ?? "preparing") === shipFilter);

  // tổng trong ngày (tab tại quầy)
  let summary: React.ReactNode = null;
  if (tab === "quay") {
    const [{ data: refundData }, { data: debtIn }] = await Promise.all([
      (() => {
        let r = supabase.from("refunds").select("id, kind, refund_amount, method, reason, created_at, customers(id, full_name)")
          .gte("created_at", from).lt("created_at", to).order("created_at", { ascending: false });
        if (branchId) r = r.eq("branch_id", branchId);
        return r;
      })(),
      (() => {
        let d = supabase.from("debt_payments").select("amount, method, created_at, invoices!inner(id, code, branch_id, customers(full_name))")
          .gte("created_at", from).lt("created_at", to);
        if (branchId) d = d.eq("invoices.branch_id", branchId);
        return d;
      })(),
    ]);
    const refunds = (refundData ?? []) as unknown as {
      id: string; kind: string; refund_amount: number; method: string; reason: string; created_at: string;
      customers: { id: string; full_name: string } | null;
    }[];
    const collected = (debtIn ?? []) as unknown as { amount: number; method: string; created_at: string; invoices: { id: string; code: string; customers: { full_name: string } | null } }[];
    const refundTotal = refunds.reduce((a, r) => a + Number(r.refund_amount), 0);
    const paid = rows.filter((r) => r.status === "paid");
    const byMethod: Record<string, number> = {};
    paid.forEach((r) => r.payments.forEach((p) => (byMethod[p.method] = (byMethod[p.method] ?? 0) + Number(p.amount))));
    const debtInTotal = collected.reduce((a, d) => a + Number(d.amount), 0);
    const newDebt = paid.reduce((a, r) => a + Number(r.debt_amount), 0);
    const realMoney = (byMethod.cash ?? 0) + (byMethod.bank_transfer ?? 0) + (byMethod.pos ?? 0);
    summary = (
      <>
        <div className="card grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {(["cash", "bank_transfer", "pos", "service_card"] as const).map((m) => (
            <div key={m}>
              <p className="text-xs text-ink/60">{METHOD_LABEL[m]}</p>
              <p className="font-bold text-navy">{formatVnd(byMethod[m] ?? 0)}</p>
            </div>
          ))}
          <div className="col-span-2 space-y-0.5 border-t border-beige pt-2 sm:col-span-4">
            <p>
              <span className="text-ink/70">Tiền thực thu (mặt + CK + POS): </span>
              <b className="text-navy">{formatVnd(realMoney)}</b>
              <span className="text-ink/60"> · {paid.length} hoá đơn</span>
            </p>
            {newDebt > 0 && <p className="text-[#7A5600]">Khách nợ lại trong ngày: {formatVnd(newDebt)}</p>}
            {debtInTotal > 0 && <p className="text-[#22612A]">Thu nợ cũ trong ngày: +{formatVnd(debtInTotal)}</p>}
            {refundTotal > 0 && <p className="text-[#8A2323]">Đã hoàn khách (huỷ gói / thẻ): −{formatVnd(refundTotal)}</p>}
          </div>
        </div>
        {collected.length > 0 && (
          <div className="card space-y-1 p-4 text-sm">
            <p className="font-semibold text-[#22612A]">Thu nợ trong ngày</p>
            {collected.map((d, i) => (
              <p key={i} className="flex justify-between gap-3">
                <Link href={`/quan-ly/hoa-don/${d.invoices.id}`} className="min-w-0 truncate underline-offset-2 hover:underline">
                  {formatTime(d.created_at)} {d.invoices.customers?.full_name ?? "Khách lẻ"} · {d.invoices.code}
                </Link>
                <span className="shrink-0">+{formatVnd(Number(d.amount))} ({METHOD_LABEL[d.method]})</span>
              </p>
            ))}
          </div>
        )}
        {refunds.length > 0 && (
          <div className="card space-y-1 p-4 text-sm">
            <p className="font-semibold text-[#8A2323]">Hoàn tiền trong ngày</p>
            {refunds.map((r) => (
              <p key={r.id} className="flex justify-between gap-3">
                <Link href={`/quan-ly/khach-hang?id=${r.customers?.id ?? ""}`} className="min-w-0 truncate">
                  {formatTime(r.created_at)} {r.customers?.full_name} · huỷ {r.kind === "card" ? "thẻ" : "gói"} · {r.reason}
                </Link>
                <span className="shrink-0">−{formatVnd(Number(r.refund_amount))} ({METHOD_LABEL[r.method]})</span>
              </p>
            ))}
          </div>
        )}
      </>
    );
  }

  const link = (p: { ngay?: string; cn?: string; loai?: Tab; gh?: string }) => {
    const params: Record<string, string> = { loai: p.loai ?? tab };
    const cn = p.cn ?? (branchId || "tat-ca");
    params.cn = cn;
    if ((p.loai ?? tab) === "quay") params.ngay = p.ngay ?? date;
    if ((p.loai ?? tab) === "online" && (p.gh ?? shipFilter)) params.gh = p.gh ?? shipFilter;
    return `/quan-ly/hoa-don?${new URLSearchParams(params).toString()}`;
  };
  const owedTotal = tab === "no" ? rows.reduce((a, r) => a + owedOf(r), 0) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-navy">Hoá đơn</h1>
          {tab === "quay" && <p className="text-sm capitalize text-ink/70">{formatDate(vnDateTime(date, "12:00").toISOString())}</p>}
          {profile?.role === "technician" && <p className="text-xs text-ink/60">Chỉ hiện hoá đơn bạn bán hoặc bạn thu.</p>}
        </div>
        <Link href="/quan-ly/thu-tien" className="btn-primary">+ Bán sản phẩm / gói / nạp thẻ</Link>
      </div>

      <div className="flex gap-1 rounded-full bg-white p-1 ring-1 ring-beige-dark">
        {(
          [
            ["quay", "Tại quầy"],
            ["online", "Online"],
            ["no", "Còn nợ"],
          ] as const
        ).map(([k, label]) => (
          <Link
            key={k}
            href={link({ loai: k, cn: branchId || "tat-ca" })}
            className={`flex-1 rounded-full px-3 py-2 text-center text-sm font-semibold ${tab === k ? "bg-navy text-white" : "text-navy"}`}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {tab !== "quay" && (
          <Link
            href={link({ cn: "tat-ca" })}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${!branchId ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}
          >
            Tất cả chi nhánh
          </Link>
        )}
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

      {tab === "quay" && (
        <div className="card flex flex-wrap items-center gap-2 p-3">
          <Link href={link({ ngay: shiftDate(date, -1) })} className="btn-ghost">‹ Hôm trước</Link>
          <form action="/quan-ly/hoa-don" className="flex items-center gap-2">
            <input type="hidden" name="cn" value={branchId || "tat-ca"} />
            <input type="hidden" name="loai" value="quay" />
            <input type="date" name="ngay" defaultValue={date} className="input w-auto py-2" />
            <button className="btn-outline py-2">Xem</button>
          </form>
          <Link href={link({ ngay: shiftDate(date, 1) })} className="btn-ghost">Hôm sau ›</Link>
          <Link href={link({ ngay: todayVn() })} className="btn-ghost">Hôm nay</Link>
        </div>
      )}
      {tab === "online" && (
        <div className="flex flex-wrap gap-1 text-xs">
          <Link href={link({ gh: "" })} className={`rounded-full px-3 py-1.5 ${!shipFilter ? "bg-beige font-semibold text-navy" : "text-ink/70"}`}>Tất cả</Link>
          {Object.entries(SHIP_STATUS).map(([k, v]) => (
            <Link key={k} href={link({ gh: k })} className={`rounded-full px-3 py-1.5 ${shipFilter === k ? "bg-beige font-semibold text-navy" : "text-ink/70"}`}>
              {v.label}
            </Link>
          ))}
        </div>
      )}
      {tab === "no" && (
        <div className="card flex justify-between text-sm">
          <span>{rows.length} hoá đơn còn nợ</span>
          <b className="text-[#7A5600]">Tổng còn nợ {formatVnd(owedTotal)}</b>
        </div>
      )}

      {summary}

      {rows.length === 0 && (
        <p className="card text-sm text-ink/60">
          {tab === "quay" ? "Chưa có hoá đơn nào trong ngày này." : tab === "online" ? "Chưa có đơn online nào." : "Không có khách nào đang nợ."}
        </p>
      )}
      <div className="space-y-2">
        {rows.map((r) => {
          const total = totalOf(r);
          const owed = owedOf(r);
          const sh = r.invoice_shipments;
          return (
            <Link key={r.id} href={`/quan-ly/hoa-don/${r.id}`} className={`card block p-4 hover:border-navy ${r.status === "cancelled" ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {r.customers?.full_name ?? sh?.recipient_name ?? "Khách lẻ"}{" "}
                    <span className="text-xs font-normal text-ink/50">
                      {r.code} · {tab === "quay" ? formatTime(r.paid_at ?? r.created_at) : shortDate(r.paid_at ?? r.created_at)}
                    </span>
                  </p>
                  <p className="truncate text-xs text-ink/60">{r.invoice_items.map((i) => i.description).join(", ")}</p>
                  {sh && (
                    <p className="truncate text-xs">
                      <span className={`mr-1 rounded-full px-2 py-0.5 font-semibold ${SHIP_STATUS[sh.status]?.cls ?? ""}`}>{SHIP_STATUS[sh.status]?.label}</span>
                      {[sh.carrier, sh.tracking_code].filter(Boolean).join(" · ") || "chưa có mã vận đơn"}
                    </p>
                  )}
                  {!sh && <p className="text-xs text-ink/50">{r.payments.map((p) => METHOD_LABEL[p.method]).join(" + ")}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-bold">{formatVnd(total)}</p>
                  {owed > 0 && <p className="text-xs font-semibold text-[#7A5600]">Còn nợ {formatVnd(owed)}</p>}
                  {r.status === "cancelled" && <p className="text-xs font-semibold text-[#8A2323]">Đã huỷ</p>}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
