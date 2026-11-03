import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatTime, formatVnd, normalizePhone } from "@/lib/format";
import { CARD_TXN_LABEL, cardBalance, fetchWallet, isPackageUsable } from "@/lib/billing";
import { canCheckout } from "@/lib/staff";

export const metadata = { title: "Khách hàng – Moana Beauty" };

type Customer = { id: string; full_name: string; phone: string | null; email: string | null; note: string | null; created_at: string };

function shortDate(iso: string) {
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(iso),
  );
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; id?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const checkout = canCheckout(profile?.role);

  let list: Customer[] = [];
  if (q && !sp.id) {
    const digits = normalizePhone(q);
    const safe = q.replace(/[%,()]/g, " ");
    let query = supabase.from("customers").select("id, full_name, phone, email, note, created_at").order("full_name").limit(30);
    query = digits.length >= 3 && digits.length === q.replace(/[\s+.-]/g, "").length ? query.ilike("phone", `%${digits}%`) : query.ilike("full_name", `%${safe}%`);
    const { data } = await query;
    list = (data ?? []) as Customer[];
  }

  let detail: React.ReactNode = null;
  if (sp.id) {
    const { data: c } = await supabase.from("customers").select("id, full_name, phone, email, note, created_at").eq("id", sp.id).maybeSingle<Customer>();
    if (!c) {
      detail = <p className="card text-sm">Không tìm thấy khách.</p>;
    } else {
      const wallet = await fetchWallet(supabase, c.id);
      const cardIds = wallet.cards.map((x) => x.card_id);
      const [{ data: txns }, { data: invs }] = await Promise.all([
        cardIds.length
          ? supabase.from("card_transactions").select("id, txn_type, amount, note, created_at").in("card_id", cardIds).order("created_at", { ascending: false }).limit(30)
          : Promise.resolve({ data: [] }),
        supabase
          .from("invoices")
          .select("id, code, status, paid_at, created_at, invoice_items(amount, description)")
          .eq("customer_id", c.id)
          .neq("status", "draft")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      const balance = cardBalance(wallet);
      detail = (
        <div className="space-y-4">
          <div className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-navy">{c.full_name}</h2>
                <p className="text-sm text-ink/70">{c.phone ?? "(chưa có SĐT)"} {c.email && `· ${c.email}`}</p>
                <p className="text-xs text-ink/50">Khách từ {shortDate(c.created_at)}</p>
                {c.note && <p className="mt-2 rounded-lg bg-[#FFE8BA]/60 px-2 py-1 text-xs">{c.note}</p>}
              </div>
              <div className="text-right">
                <p className="text-xs text-ink/60">Số dư thẻ tài khoản</p>
                <p className="text-2xl font-bold text-navy">{wallet.cards.length ? formatVnd(balance) : "Chưa có thẻ"}</p>
                {wallet.cards.length > 0 && <p className="text-xs text-ink/50">Mã thẻ {wallet.cards.map((x) => x.code).join(", ")}</p>}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 border-t border-beige pt-3">
              {checkout && <Link href={`/quan-ly/thu-tien?kh=${c.id}`} className="btn-primary py-2">Bán gói / nạp thẻ</Link>}
              {c.phone && <Link href={`/quan-ly/tao-lich?sdt=${c.phone}`} className="btn-outline py-2">Tạo lịch</Link>}
            </div>
          </div>

          <div className="card">
            <h3 className="mb-2 font-semibold text-navy">Gói combo</h3>
            {wallet.packages.length === 0 && <p className="text-sm text-ink/60">Khách chưa mua gói nào.</p>}
            <div className="space-y-3">
              {wallet.packages.map((p) => {
                const usable = isPackageUsable(p);
                const left = p.services.reduce((a, s) => a + s.total_qty - s.used_qty, 0);
                return (
                  <div key={p.id} className={`rounded-xl border border-beige-dark p-3 text-sm ${usable && left > 0 ? "" : "opacity-60"}`}>
                    <div className="flex justify-between gap-2">
                      <p className="font-semibold">{p.name}</p>
                      <p className="text-xs text-ink/60">
                        Mua {shortDate(p.purchased_at)}
                        {p.expires_at && ` · hạn ${shortDate(p.expires_at)}`}
                        {!p.is_active ? " · đã huỷ" : !usable ? " · hết hạn" : left === 0 ? " · đã dùng hết" : ""}
                      </p>
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {p.services.map((s) => (
                        <li key={s.service_id} className="flex justify-between">
                          <span>{s.name}</span>
                          <span>
                            còn <b className="text-navy">{s.total_qty - s.used_qty}</b>/{s.total_qty} buổi
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>

          {wallet.cards.length > 0 && (
            <div className="card">
              <h3 className="mb-2 font-semibold text-navy">Lịch sử thẻ tài khoản</h3>
              <ul className="divide-y divide-beige text-sm">
                {(txns ?? []).map((t: { id: string; txn_type: string; amount: number; note: string | null; created_at: string }) => (
                  <li key={t.id} className="flex justify-between gap-3 py-1.5">
                    <span>
                      <span className="text-ink/50">{shortDate(t.created_at)} {formatTime(t.created_at)}</span> {CARD_TXN_LABEL[t.txn_type] ?? t.txn_type}
                      {t.note && <span className="text-xs text-ink/50"> · {t.note}</span>}
                    </span>
                    <span className={`shrink-0 font-medium ${Number(t.amount) < 0 ? "text-[#8A2323]" : "text-[#22612A]"}`}>
                      {Number(t.amount) > 0 ? "+" : ""}
                      {formatVnd(Number(t.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card">
            <h3 className="mb-2 font-semibold text-navy">Hoá đơn gần đây</h3>
            {(invs ?? []).length === 0 && <p className="text-sm text-ink/60">Chưa có hoá đơn.</p>}
            <ul className="divide-y divide-beige text-sm">
              {((invs ?? []) as { id: string; code: string; status: string; paid_at: string | null; created_at: string; invoice_items: { amount: number; description: string | null }[] }[]).map((i) => (
                <li key={i.id}>
                  <Link href={`/quan-ly/hoa-don/${i.id}`} className="flex justify-between gap-3 py-2 hover:bg-cream">
                    <span className="min-w-0">
                      <span className="text-ink/50">{shortDate(i.paid_at ?? i.created_at)}</span> {i.code}
                      <span className="block truncate text-xs text-ink/60">{i.invoice_items.map((x) => x.description).join(", ")}</span>
                    </span>
                    <span className="shrink-0">
                      {i.status === "cancelled" ? <span className="text-xs text-[#8A2323]">Đã huỷ</span> : formatVnd(i.invoice_items.reduce((a, x) => a + Number(x.amount), 0))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-navy">Khách hàng</h1>
      <form action="/quan-ly/khach-hang" className="card flex gap-2 p-3">
        <input name="q" defaultValue={q} className="input py-2" placeholder="Tìm theo SĐT hoặc tên" />
        <button className="btn-primary shrink-0">Tìm</button>
      </form>
      {q && !sp.id && (
        <div className="card p-0">
          {list.length === 0 && <p className="p-4 text-sm text-ink/60">Không tìm thấy khách nào.</p>}
          <ul className="divide-y divide-beige">
            {list.map((c) => (
              <li key={c.id}>
                <Link href={`/quan-ly/khach-hang?id=${c.id}`} className="flex justify-between gap-3 px-4 py-3 text-sm hover:bg-cream">
                  <span className="font-medium">{c.full_name}</span>
                  <span className="text-ink/60">{c.phone}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {detail}
    </div>
  );
}
