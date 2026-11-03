import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { STATUS_LABEL, STATUS_STYLE, formatDate, formatTime, formatVnd } from "@/lib/format";
import CancelButton from "./CancelButton";
import { cardBalance, fetchWallet, isPackageUsable, itemLeft, itemText, type Wallet } from "@/lib/billing";

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
                  <span>
                    {i.label}
                    {i.services.length > 1 && <span className="block text-xs text-ink/50">{i.services.map((x) => x.name).join(", ")}</span>}
                  </span>
                  <span className="shrink-0">{itemText(i)}</span>
                </p>
              ))}
              {p.expires_at && <p className="text-xs text-ink/50">Hạn dùng đến {formatDate(p.expires_at)}</p>}
            </div>
          ))}
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
