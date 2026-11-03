import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatDate, formatTime, formatVnd, todayVn, vnDateTime } from "@/lib/format";
import { METHOD_LABEL } from "@/lib/billing";
import { canCheckout } from "@/lib/staff";

export const metadata = { title: "Hoá đơn – Moana Beauty" };

type Row = {
  id: string;
  code: string;
  status: string;
  paid_at: string | null;
  created_at: string;
  customers: { full_name: string; phone: string | null } | null;
  invoice_items: { item_type: string; description: string | null; amount: number }[];
  payments: { method: string; amount: number }[];
};

function shiftDate(d: string, days: number) {
  const t = vnDateTime(d, "12:00").getTime() + days * 86400000;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(t));
}

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ ngay?: string; cn?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  if (!canCheckout(profile?.role)) return <p className="card text-sm">Trang dành cho nhân viên thu ngân.</p>;
  const sp = await searchParams;
  const date = sp.ngay && /^\d{4}-\d{2}-\d{2}$/.test(sp.ngay) ? sp.ngay : todayVn();
  const { data: branches } = await supabase.from("branches").select("id, name").eq("is_active", true).order("name");
  const branchId = sp.cn ?? profile?.branch_id ?? branches?.[0]?.id ?? "";
  const from = vnDateTime(date, "00:00").toISOString();
  const to = vnDateTime(shiftDate(date, 1), "00:00").toISOString();

  const { data } = await supabase
    .from("invoices")
    .select("id, code, status, paid_at, created_at, customers(full_name, phone), invoice_items(item_type, description, amount), payments(method, amount)")
    .eq("branch_id", branchId)
    .neq("status", "draft")
    .gte("created_at", from)
    .lt("created_at", to)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as unknown as Row[];
  const { data: refundData } = await supabase
    .from("refunds")
    .select("id, kind, refund_amount, method, reason, created_at, customers(id, full_name)")
    .eq("branch_id", branchId)
    .gte("created_at", from)
    .lt("created_at", to)
    .order("created_at", { ascending: false });
  const refunds = (refundData ?? []) as unknown as {
    id: string; kind: string; refund_amount: number; method: string; reason: string; created_at: string;
    customers: { id: string; full_name: string } | null;
  }[];
  const refundTotal = refunds.reduce((a, r) => a + Number(r.refund_amount), 0);
  const paid = rows.filter((r) => r.status === "paid");

  const byMethod: Record<string, number> = {};
  paid.forEach((r) => r.payments.forEach((p) => (byMethod[p.method] = (byMethod[p.method] ?? 0) + Number(p.amount))));
  const realMoney = (byMethod.cash ?? 0) + (byMethod.bank_transfer ?? 0) + (byMethod.pos ?? 0);

  const link = (p: { ngay?: string; cn?: string }) =>
    `/quan-ly/hoa-don?${new URLSearchParams({ ngay: p.ngay ?? date, cn: p.cn ?? branchId }).toString()}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-navy">Hoá đơn</h1>
          <p className="text-sm capitalize text-ink/70">{formatDate(vnDateTime(date, "12:00").toISOString())}</p>
          {profile?.role === "technician" && <p className="text-xs text-ink/60">Chỉ hiện hoá đơn bạn bán hoặc bạn thu.</p>}
        </div>
        <Link href="/quan-ly/thu-tien" className="btn-primary">+ Bán gói / nạp thẻ / thu lẻ</Link>
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
        <form action="/quan-ly/hoa-don" className="flex items-center gap-2">
          <input type="hidden" name="cn" value={branchId} />
          <input type="date" name="ngay" defaultValue={date} className="input w-auto py-2" />
          <button className="btn-outline py-2">Xem</button>
        </form>
        <Link href={link({ ngay: shiftDate(date, 1) })} className="btn-ghost">Hôm sau ›</Link>
        <Link href={link({ ngay: todayVn() })} className="btn-ghost">Hôm nay</Link>
      </div>

      <div className="card grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {(["cash", "bank_transfer", "pos", "service_card"] as const).map((m) => (
          <div key={m}>
            <p className="text-xs text-ink/60">{METHOD_LABEL[m]}</p>
            <p className="font-bold text-navy">{formatVnd(byMethod[m] ?? 0)}</p>
          </div>
        ))}
        <div className="col-span-2 border-t border-beige pt-2 sm:col-span-4">
          <span className="text-ink/70">Tiền thực thu (mặt + CK + POS): </span>
          <b className="text-navy">{formatVnd(realMoney)}</b>
          <span className="text-ink/60"> · {paid.length} hoá đơn</span>
          {refundTotal > 0 && (
            <span className="block text-[#8A2323]">Đã hoàn khách (huỷ gói / thẻ): −{formatVnd(refundTotal)}</span>
          )}
        </div>
      </div>

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
      {rows.length === 0 && <p className="card text-sm text-ink/60">Chưa có hoá đơn nào trong ngày này.</p>}
      <div className="space-y-2">
        {rows.map((r) => {
          const total = r.invoice_items.reduce((a, i) => a + Number(i.amount), 0);
          return (
            <Link key={r.id} href={`/quan-ly/hoa-don/${r.id}`} className={`card block p-4 hover:border-navy ${r.status === "cancelled" ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {r.customers?.full_name ?? "Khách lẻ"}{" "}
                    <span className="text-xs font-normal text-ink/50">{r.code} · {formatTime(r.paid_at ?? r.created_at)}</span>
                  </p>
                  <p className="truncate text-xs text-ink/60">{r.invoice_items.map((i) => i.description).join(", ")}</p>
                  <p className="text-xs text-ink/50">{r.payments.map((p) => METHOD_LABEL[p.method]).join(" + ")}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-bold">{formatVnd(total)}</p>
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
