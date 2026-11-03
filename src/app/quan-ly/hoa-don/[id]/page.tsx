import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatDate, formatTime, formatVnd } from "@/lib/format";
import { METHOD_LABEL } from "@/lib/billing";
import PrintButton from "./PrintButton";
import VoidButton from "./VoidButton";

export const metadata = { title: "Hoá đơn – Moana Beauty" };

type Inv = {
  id: string;
  code: string;
  status: string;
  paid_at: string | null;
  created_at: string;
  note: string | null;
  void_reason: string | null;
  discount_reason: string | null;
  voided_at: string | null;
  appointment_id: string | null;
  branches: { name: string; address: string } | null;
  customers: { id: string; full_name: string; phone: string | null } | null;
  creator: { full_name: string | null } | null;
  invoice_items: {
    id: string;
    item_type: string;
    description: string | null;
    quantity: number;
    unit_price: number;
    discount: number;
    amount: number;
    paid_with_card: boolean;
    customer_package_id: string | null;
    invoice_item_sellers: { amount: number; profiles: { full_name: string | null } | null }[];
  }[];
  payments: { id: string; method: string; amount: number }[];
};

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ moi?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, profile } = await getCurrentUser();
  const { data } = await supabase
    .from("invoices")
    .select(
      `id, code, status, paid_at, created_at, note, void_reason, discount_reason, voided_at, appointment_id,
       branches(name, address), customers(id, full_name, phone), creator:profiles!invoices_created_by_fkey(full_name),
       invoice_items(id, item_type, description, quantity, unit_price, discount, amount, paid_with_card, customer_package_id,
         invoice_item_sellers(amount, profiles(full_name))),
       payments(id, method, amount)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return <p className="card text-sm">Không tìm thấy hoá đơn.</p>;
  const inv = data as unknown as Inv;
  const total = inv.invoice_items.reduce((a, i) => a + Number(i.amount), 0);
  const gross = inv.invoice_items.reduce((a, i) => a + Number(i.unit_price) * i.quantity, 0);
  const discount = gross - total;
  const cancelled = inv.status === "cancelled";
  const showSellers = profile?.role === "owner" || profile?.role === "manager" || profile?.role === "receptionist";

  return (
    <div className="space-y-4">
      {sp.moi && !cancelled && (
        <div className="card flex flex-wrap items-center justify-between gap-2 border-l-4 border-l-[#22612A] p-4 text-sm print:hidden">
          <span>✓ Đã thu tiền và chốt hoá đơn.</span>
          <span className="flex gap-2">
            <Link href="/quan-ly" className="btn-outline py-2">Về lịch hẹn</Link>
            {inv.customers && <Link href={`/quan-ly/khach-hang?id=${inv.customers.id}`} className="btn-ghost py-2">Hồ sơ khách</Link>}
          </span>
        </div>
      )}

      <div className={`card space-y-4 print:border-0 print:shadow-none ${cancelled ? "opacity-70" : ""}`}>
        <div className="text-center">
          <p className="text-lg font-bold tracking-[0.2em] text-navy">MOANA BEAUTY</p>
          {inv.branches && <p className="text-xs text-ink/60">{inv.branches.address}</p>}
          <p className="mt-2 font-semibold">HOÁ ĐƠN {inv.code}</p>
          <p className="text-xs text-ink/60">
            {inv.paid_at ? `${formatTime(inv.paid_at)} · ${formatDate(inv.paid_at)}` : formatDate(inv.created_at)}
          </p>
          {cancelled && (
            <p className="mt-2 rounded-lg bg-[#F6D5D5] px-3 py-2 text-sm font-semibold text-[#8A2323]">
              ĐÃ HUỶ{inv.void_reason ? ` – ${inv.void_reason}` : ""}
            </p>
          )}
        </div>

        <div className="text-sm">
          <p>Khách: <b>{inv.customers?.full_name ?? "Khách lẻ"}</b> {inv.customers?.phone && `· ${inv.customers.phone}`}</p>
          {inv.creator?.full_name && <p className="text-ink/60">Thu ngân: {inv.creator.full_name}</p>}
        </div>

        <table className="w-full text-sm">
          <tbody>
            {inv.invoice_items.map((it) => (
              <tr key={it.id} className="border-t border-beige align-top">
                <td className="py-2 pr-2">
                  <p>
                    {it.description}
                    {it.quantity > 1 && ` ×${it.quantity}`}
                  </p>
                  {Number(it.discount) > 0 && (
                    <p className="text-xs text-ink/50">
                      {formatVnd(Number(it.unit_price) * it.quantity)} − giảm {formatVnd(Number(it.discount))}
                    </p>
                  )}
                  {it.paid_with_card && <p className="text-xs text-navy">Trả bằng thẻ tài khoản</p>}
                  {showSellers && it.invoice_item_sellers.length > 0 && (
                    <p className="text-xs text-ink/50 print:hidden">
                      Doanh số: {it.invoice_item_sellers.map((s) => `${s.profiles?.full_name ?? "?"} ${formatVnd(Number(s.amount))}`).join(", ")}
                    </p>
                  )}
                </td>
                <td className="py-2 text-right whitespace-nowrap">{it.customer_package_id ? "Trừ gói" : formatVnd(Number(it.amount))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="space-y-1 border-t border-beige pt-3 text-sm">
          {discount > 0 && (
            <>
              <p className="flex justify-between"><span>Tổng tiền</span><span>{formatVnd(gross)}</span></p>
              <p className="flex justify-between"><span>Giảm giá</span><span>−{formatVnd(discount)}</span></p>
              {inv.discount_reason && <p className="text-xs text-ink/60 print:hidden">Lý do giảm: {inv.discount_reason}</p>}
            </>
          )}
          <p className="flex justify-between text-base font-bold text-navy"><span>Thanh toán</span><span>{formatVnd(total)}</span></p>
          {inv.payments.map((p) => (
            <p key={p.id} className="flex justify-between text-ink/70">
              <span>{METHOD_LABEL[p.method] ?? p.method}</span>
              <span>{formatVnd(Number(p.amount))}</span>
            </p>
          ))}
        </div>
        {inv.note && <p className="text-sm text-ink/70">Ghi chú: {inv.note}</p>}
        <p className="text-center text-xs text-ink/50">Cảm ơn quý khách!</p>
      </div>

      <div className="flex flex-wrap justify-between gap-2 print:hidden">
        <Link href="/quan-ly/hoa-don" className="btn-ghost">‹ Danh sách hoá đơn</Link>
        <span className="flex gap-2">
          {profile?.role === "owner" && !cancelled && <VoidButton id={inv.id} />}
          <PrintButton />
        </span>
      </div>
    </div>
  );
}
