import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { STATUS_LABEL, STATUS_STYLE, formatDate, formatTime, formatVnd } from "@/lib/format";
import CancelButton from "./CancelButton";
import { cardBalance, fetchWallet, isPackageUsable, itemLeft, itemText, type Wallet } from "@/lib/billing";
import { REG_STATUS_LABEL, REG_STATUS_STYLE, canRedeem, dmy, redeemDeadline, sortedItems, type PromoItem } from "@/lib/promotions";
import CancelRegButton from "../khuyen-mai/CancelRegButton";

type MyReg = {
  id: string;
  status: string;
  preferred_at: string | null;
  created_at: string;
  cancel_reason: string | null;
  branches: { name: string } | null;
  promotions: { name: string; end_date: string | null; redeem_until: string | null; promotion_items: PromoItem[] } | null;
};

export const metadata = { title: "Lịch của tôi – Moana Beauty" };

type Appt = {
  id: string;
  start_at: string;
  end_at: string | null;
  status: string;
  note: string | null;
  branches: { name: string; address: string } | null;
  appointment_services: { id: string; start_at: string; price: number | null; services: { name: string } | null }[];
};

export default async function MyAppointmentsPage() {
  const { supabase, user } = await getCurrentUser();
  if (!user) redirect("/dang-nhap?next=/lich-hen");

  const { data: customer } = await supabase.from("customers").select("id").eq("profile_id", user.id).maybeSingle();
  const { data } = customer
    ? await supabase
        .from("appointments")
        .select("id, start_at, end_at, status, note, branches(name, address), appointment_services(id, start_at, price, services(name))")
        .eq("customer_id", customer.id)
        .order("start_at", { ascending: false })
        .limit(50)
    : { data: [] };
  const appts = (data ?? []) as unknown as Appt[];
  const wallet: Wallet = customer ? await fetchWallet(supabase, customer.id) : { cards: [], packages: [] };
  const myPackages = wallet.packages.filter((p) => p.is_active);
  const { data: regData } = customer
    ? await supabase
        .from("promotion_registrations")
        .select("id, status, preferred_at, created_at, cancel_reason, branches(name), promotions(name, end_date, redeem_until, promotion_items(id, item_type, service_id, package_id, product_id, label, list_price, promo_price, quantity, sort_order))")
        .eq("customer_id", customer.id)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [] };
  const regs = ((regData ?? []) as unknown as MyReg[]).filter(
    (r) => r.status === "pending" || r.status === "confirmed" || Date.now() - new Date(r.created_at).getTime() < 60 * 86400000,
  );

  const now = Date.now();
  const upcoming = appts.filter((a) => new Date(a.start_at).getTime() >= now - 3 * 3600000 && !["cancelled", "no_show", "completed"].includes(a.status)).reverse();
  const past = appts.filter((a) => !upcoming.includes(a));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">Lịch của tôi</h1>
          <p className="text-sm text-ink/70">Lịch hẹn sắp tới và lịch sử tại Moana.</p>
        </div>
        <Link href="/dat-lich" className="btn-primary">+ Đặt lịch</Link>
      </div>

      {(wallet.cards.length > 0 || myPackages.length > 0) && (
        <section className="card space-y-2">
          {wallet.cards.length > 0 && (
            <p className="flex justify-between text-sm">
              <span>Số dư thẻ tài khoản</span>
              <b className="text-lg text-navy">{formatVnd(cardBalance(wallet))}</b>
            </p>
          )}
          {myPackages.map((p) => (
            <div key={p.id} className="border-t border-beige pt-2 text-sm">
              <p className="font-semibold">
                {p.name}
                {!isPackageUsable(p) ? <span className="text-xs font-normal text-ink/50"> (hết hạn)</span> : p.items.every((i) => itemLeft(i) <= 0) ? <span className="text-xs font-normal text-ink/50"> (đã dùng hết)</span> : null}
              </p>
              {p.items.map((i) => (
                <p key={i.id} className="flex justify-between gap-3 text-ink/80">
                  <span>{i.label}</span>
                  <span className="shrink-0">{itemText(i)}</span>
                </p>
              ))}
              {p.expires_at && <p className="text-xs text-ink/50">Hạn dùng đến {formatDate(p.expires_at)}</p>}
            </div>
          ))}
        </section>
      )}

      {regs.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-brown">Ưu đãi đã đăng ký</h2>
            <Link href="/khuyen-mai" className="text-sm font-semibold text-navy underline">Xem khuyến mãi</Link>
          </div>
          {regs.map((r) => {
            const expired = r.promotions && r.status === "confirmed" && !canRedeem(r.promotions);
            return (
              <div key={r.id} className="card p-4 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-navy">{r.promotions?.name}</p>
                    <p className="text-xs text-ink/60">
                      {r.branches?.name}
                      {r.preferred_at && ` · muốn đến ${formatTime(r.preferred_at)} ${formatDate(r.preferred_at)}`}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${REG_STATUS_STYLE[r.status] ?? ""}`}>
                    {expired ? "Hết hạn dùng" : REG_STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </div>
                {r.promotions && (
                  <p className="mt-1 text-xs text-ink/70">
                    {sortedItems(r.promotions)
                      .map((i) => `${i.label}${i.quantity > 1 ? ` ×${i.quantity}` : ""}: ${Number(i.promo_price) === 0 ? "tặng" : formatVnd(Number(i.promo_price))}`)
                      .join(" · ")}
                  </p>
                )}
                {r.status === "pending" && <p className="mt-1 text-xs text-ink/60">Moana sẽ gọi cho bạn để xác nhận.</p>}
                {r.status === "confirmed" && r.promotions && redeemDeadline(r.promotions) && !expired && (
                  <p className="mt-1 text-xs text-ink/60">Dùng ưu đãi đến hết {dmy(redeemDeadline(r.promotions))}, báo lễ tân khi thanh toán.</p>
                )}
                {r.status === "cancelled" && r.cancel_reason && <p className="mt-1 text-xs text-ink/50">Lý do huỷ: {r.cancel_reason}</p>}
                {(r.status === "pending" || r.status === "confirmed") && !expired && (
                  <div className="mt-2 text-right">
                    <CancelRegButton id={r.id} />
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-brown">Sắp tới</h2>
        {upcoming.length === 0 && <p className="card text-sm text-ink/60">Bạn chưa có lịch hẹn nào sắp tới.</p>}
        {upcoming.map((a) => (
          <ApptCard key={a.id} a={a} canCancel={a.status === "pending"} />
        ))}
      </section>

      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-brown">Đã qua / đã huỷ</h2>
          {past.map((a) => (
            <ApptCard key={a.id} a={a} canCancel={false} />
          ))}
        </section>
      )}
    </div>
  );
}

function ApptCard({ a, canCancel }: { a: Appt; canCancel: boolean }) {
  const items = [...a.appointment_services].sort((x, y) => x.start_at.localeCompare(y.start_at));
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-bold text-navy">
            {formatTime(a.start_at)}
            {a.end_at && <span className="font-normal text-ink/50"> – {formatTime(a.end_at)}</span>}
          </p>
          <p className="text-sm capitalize">{formatDate(a.start_at)}</p>
          <p className="mt-1 text-xs text-ink/60">{a.branches?.name} · {a.branches?.address}</p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[a.status] ?? ""}`}>
          {STATUS_LABEL[a.status] ?? a.status}
        </span>
      </div>
      <ul className="mt-3 space-y-1 border-t border-beige pt-3 text-sm">
        {items.map((s) => (
          <li key={s.id} className="flex justify-between gap-3">
            <span>{s.services?.name}</span>
            <span className="text-ink/60">{formatVnd(s.price)}</span>
          </li>
        ))}
      </ul>
      {a.note && <p className="mt-2 text-xs italic text-ink/60">Ghi chú: {a.note}</p>}
      {canCancel && (
        <div className="mt-3 text-right">
          <CancelButton id={a.id} />
        </div>
      )}
    </div>
  );
}
