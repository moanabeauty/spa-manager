import { activeBranches } from "@/lib/refData";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatShortDate, formatVnd, textMatch } from "@/lib/format";
import { canCheckout } from "@/lib/staff";
import { SHIP_STATUS } from "@/lib/shipping";
import { fetchReserved } from "@/lib/inventory";

export const metadata = { title: "Bán hàng online – Moana Beauty" };

type Row = {
  id: string;
  code: string;
  status: string;
  branch_id: string;
  paid_at: string | null;
  created_at: string;
  customers: { full_name: string; code: string | null } | null;
  invoice_items: { item_type: string; description: string | null; quantity: number; amount: number }[];
  payments: { amount: number }[];
  debt_payments: { amount: number }[];
  invoice_shipments: {
    carrier: string | null;
    tracking_code: string | null;
    status: string;
    recipient_name: string | null;
    recipient_phone: string | null;
    address: string | null;
    cod_amount: number;
    stock_out_at: string | null;
  } | null;
};

const SELECT =
  "id, code, status, branch_id, paid_at, created_at, customers(full_name, code), invoice_items(item_type, description, quantity, amount), payments(amount), debt_payments(amount), invoice_shipments(carrier, tracking_code, status, recipient_name, recipient_phone, address, cod_amount, stock_out_at)";

/** Bán hàng online: nhân viên lên đơn theo yêu cầu khách (không cần đặt lịch) → giao hàng → theo dõi tiền */
export default async function OnlineSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ cn?: string; gh?: string; tien?: string; q?: string }>;
}) {
  const { supabase, profile } = await getCurrentUser();
  if (profile?.role === "marketing") redirect("/quan-ly/marketing");
  if (!canCheckout(profile?.role)) return <p className="card text-sm">Trang dành cho nhân viên bán hàng.</p>;
  const sp = await searchParams;
  const { data: branches } = await activeBranches();
  const branchId = sp.cn === "tat-ca" || !sp.cn ? "" : sp.cn;
  const shipFilter = sp.gh && sp.gh in SHIP_STATUS ? sp.gh : "";
  const moneyFilter = sp.tien === "con" || sp.tien === "du" ? sp.tien : "";
  const query = (sp.q ?? "").trim();

  let q = supabase.from("invoices").select(SELECT).eq("channel", "online").neq("status", "draft").order("created_at", { ascending: false }).limit(300);
  if (branchId) q = q.eq("branch_id", branchId);
  const [{ data }, reserved, { data: prods }] = await Promise.all([
    q,
    fetchReserved(supabase),
    supabase.from("products").select("id, name, capacity").eq("for_retail", true),
  ]);
  const all = (data ?? []) as unknown as Row[];

  const totalOf = (r: Row) => r.invoice_items.reduce((a, i) => a + Number(i.amount), 0);
  const paidOf = (r: Row) => r.payments.reduce((a, p) => a + Number(p.amount), 0) + r.debt_payments.reduce((a, p) => a + Number(p.amount), 0);
  const owedOf = (r: Row) => (r.status === "paid" ? Math.max(0, totalOf(r) - paidOf(r)) : 0);
  const shipOf = (r: Row) => (r.status === "cancelled" ? "cancelled" : r.invoice_shipments?.status ?? "preparing");

  const counts: Record<string, number> = {};
  all.forEach((r) => (counts[shipOf(r)] = (counts[shipOf(r)] ?? 0) + 1));
  let rows = all;
  if (shipFilter) rows = rows.filter((r) => shipOf(r) === shipFilter);
  if (moneyFilter === "con") rows = rows.filter((r) => owedOf(r) > 0);
  if (moneyFilter === "du") rows = rows.filter((r) => r.status === "paid" && owedOf(r) === 0);
  if (query)
    rows = rows.filter((r) =>
      textMatch(
        [r.code, r.customers?.full_name, r.customers?.code, r.invoice_shipments?.recipient_name, r.invoice_shipments?.recipient_phone, r.invoice_shipments?.tracking_code]
          .filter(Boolean)
          .join(" "),
        query,
      ),
    );
  const owedAll = all.filter((r) => r.status === "paid").reduce((a, r) => a + owedOf(r), 0);

  // hàng đang giữ cho các đơn chưa gửi
  const prodName = new Map(((prods ?? []) as { id: string; name: string; capacity: string | null }[]).map((p) => [p.id, [p.name, p.capacity].filter(Boolean).join(" ")]));
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));
  const held = reserved.filter((r) => !branchId || r.branch_id === branchId);

  const link = (p: { cn?: string; gh?: string; tien?: string }) => {
    const params: Record<string, string> = {};
    const cn = p.cn ?? (branchId || "");
    const gh = p.gh ?? shipFilter;
    const tien = p.tien ?? moneyFilter;
    if (cn) params.cn = cn;
    if (gh) params.gh = gh;
    if (tien) params.tien = tien;
    if (query) params.q = query;
    const s = new URLSearchParams(params).toString();
    return `/quan-ly/ban-online${s ? `?${s}` : ""}`;
  };
  const pill = (on: boolean) => `rounded-full px-3 py-1.5 text-xs ${on ? "bg-navy font-semibold text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-navy">Bán hàng online</h1>
          <p className="text-sm text-ink/70">Lên đơn theo yêu cầu khách, không cần đặt lịch. Đã lên đơn = giữ hàng · Đang giao = trừ kho.</p>
        </div>
        <Link href="/quan-ly/thu-tien?kenh=online" className="btn-primary">+ Lên đơn mới</Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href={link({ cn: "" })} className={pill(!branchId)}>Tất cả chi nhánh</Link>
        {(branches ?? []).map((b) => (
          <Link key={b.id} href={link({ cn: b.id })} className={pill(b.id === branchId)}>{b.name}</Link>
        ))}
      </div>

      <div className="flex flex-wrap gap-1">
        <Link href={link({ gh: "" })} className={pill(!shipFilter)}>Tất cả ({all.length})</Link>
        {Object.entries(SHIP_STATUS).map(([k, v]) => (
          <Link key={k} href={link({ gh: k })} className={pill(shipFilter === k)}>
            {v.label} ({counts[k] ?? 0})
          </Link>
        ))}
        {(counts.cancelled ?? 0) > 0 && (
          <Link href={link({ gh: "cancelled" })} className={pill(shipFilter === "cancelled")}>Đã huỷ ({counts.cancelled})</Link>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link href={link({ tien: "" })} className={pill(!moneyFilter)}>Mọi đơn</Link>
        <Link href={link({ tien: "con" })} className={pill(moneyFilter === "con")}>Chưa thu đủ tiền</Link>
        <Link href={link({ tien: "du" })} className={pill(moneyFilter === "du")}>Đã thu đủ</Link>
        <form action="/quan-ly/ban-online" className="ml-auto flex gap-2">
          {branchId && <input type="hidden" name="cn" value={branchId} />}
          {shipFilter && <input type="hidden" name="gh" value={shipFilter} />}
          {moneyFilter && <input type="hidden" name="tien" value={moneyFilter} />}
          <input name="q" defaultValue={query} placeholder="Tìm tên, mã KH, SĐT, mã vận đơn" className="input w-56 py-2 text-sm" />
          <button className="btn-outline py-2">Tìm</button>
        </form>
      </div>

      {owedAll > 0 && (
        <p className="card p-3 text-sm">
          Tiền đơn online chưa thu về (gồm ship thu hộ COD): <b className="text-[#7A5600]">{formatVnd(owedAll)}</b>
        </p>
      )}

      {held.length > 0 && (
        <details className="card p-4 text-sm">
          <summary className="cursor-pointer font-semibold text-navy">Hàng đang giữ cho đơn chưa gửi ({held.length} sản phẩm)</summary>
          <div className="mt-2 space-y-1">
            {held.map((h) => (
              <p key={h.warehouse_id + h.product_id} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">
                  {prodName.get(h.product_id) ?? "Sản phẩm"}
                  {!branchId && <span className="text-xs text-ink/50"> · {branchName.get(h.branch_id)}</span>}
                </span>
                <b className="shrink-0">{h.quantity}</b>
              </p>
            ))}
          </div>
        </details>
      )}

      {rows.length === 0 && <p className="card text-sm text-ink/60">{all.length === 0 ? "Chưa có đơn online nào. Bấm “+ Lên đơn mới” để tạo đơn." : "Không có đơn nào khớp bộ lọc."}</p>}

      <div className="space-y-2">
        {rows.map((r) => {
          const total = totalOf(r);
          const owed = owedOf(r);
          const sh = r.invoice_shipments;
          const st = shipOf(r);
          const cod = Number(sh?.cod_amount ?? 0);
          return (
            <Link key={r.id} href={`/quan-ly/hoa-don/${r.id}`} className={`card block p-4 hover:border-navy ${r.status === "cancelled" ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="font-semibold">
                    {r.customers?.full_name ?? sh?.recipient_name ?? "Khách lẻ"}{" "}
                    <span className="text-xs font-normal text-ink/50">
                      {[r.customers?.code, r.code, formatShortDate(r.paid_at ?? r.created_at), !branchId ? branchName.get(r.branch_id) : null].filter(Boolean).join(" · ")}
                    </span>
                  </p>
                  <p className="truncate text-xs text-ink/70">
                    {r.invoice_items.map((i) => `${i.description ?? ""}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`).join(", ")}
                  </p>
                  <p className="truncate text-xs">
                    {st === "cancelled" ? (
                      <span className="mr-1 rounded-full bg-[#F6D5D5] px-2 py-0.5 font-semibold text-[#8A2323]">Đã huỷ</span>
                    ) : (
                      <span className={`mr-1 rounded-full px-2 py-0.5 font-semibold ${SHIP_STATUS[st]?.cls ?? ""}`}>{SHIP_STATUS[st]?.label}</span>
                    )}
                    {[sh?.carrier, sh?.tracking_code].filter(Boolean).join(" · ") || <span className="text-[#7A5600]">chưa có mã vận đơn</span>}
                  </p>
                  {sh?.address && <p className="truncate text-xs text-ink/50">{sh.address}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-bold">{formatVnd(total)}</p>
                  {r.status === "paid" &&
                    (owed > 0 ? (
                      <p className="text-xs font-semibold text-[#7A5600]">
                        Còn thu {formatVnd(owed)}
                        {cod > 0 && <span className="block font-normal">(COD {formatVnd(cod)})</span>}
                      </p>
                    ) : (
                      <p className="text-xs font-semibold text-[#22612A]">Đã thu đủ ✓</p>
                    ))}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
