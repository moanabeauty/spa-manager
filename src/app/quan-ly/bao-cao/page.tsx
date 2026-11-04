import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatVnd, todayVn } from "@/lib/format";
import { isDate, monthEnd, pctText, shiftMonth, shortLabel } from "@/lib/reports";
import ReportNav from "./ReportNav";

export const metadata = { title: "Báo cáo doanh thu – Moana Beauty" };

type Row = { day: string; branch_id: string; kind: string; key: string; amount: number; cnt: number };
type ItemRow = { item_type: string; name: string; qty: number; amount: number; card_amount: number };

type Sum = {
  service: number; serviceCard: number; pkg: number; product: number; topup: number;
  cash: number; transfer: number; pos: number; card: number; refund: number; debt: number; debtIn: number;
};
const empty = (): Sum => ({ service: 0, serviceCard: 0, pkg: 0, product: 0, topup: 0, cash: 0, transfer: 0, pos: 0, card: 0, refund: 0, debt: 0, debtIn: 0 });

function add(s: Sum, r: Row) {
  const a = Number(r.amount);
  if (r.kind === "line") {
    if (r.key === "service") s.service += a;
    else if (r.key === "service:card") s.serviceCard += a;
    else if (r.key.startsWith("package")) s.pkg += a;
    else if (r.key.startsWith("product")) s.product += a;
    else if (r.key.startsWith("card_topup")) s.topup += a;
  } else if (r.kind === "debt") s.debt += a;
  else if (r.kind === "debt_in") {
    s.debtIn += a;
    if (r.key === "cash") s.cash += a;
    else if (r.key === "bank_transfer") s.transfer += a;
    else if (r.key === "pos") s.pos += a;
  } else if (r.kind === "pay") {
    if (r.key === "cash") s.cash += a;
    else if (r.key === "bank_transfer") s.transfer += a;
    else if (r.key === "pos") s.pos += a;
    else if (r.key === "service_card") s.card += a;
  } else if (r.kind === "refund") s.refund += a;
}
const real = (s: Sum) => s.cash + s.transfer + s.pos;
const sales = (s: Sum) => s.service + s.serviceCard + s.pkg + s.product + s.topup;

const TYPE_LABEL: Record<string, string> = { service: "Dịch vụ lẻ", package: "Gói combo / liệu trình", product: "Sản phẩm", card_topup: "Nạp thẻ" };

export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ tu?: string; den?: string; cn?: string; xem?: string }>;
}) {
  const { supabase, profile } = await getCurrentUser();
  const role = profile?.role;
  if (role !== "owner" && role !== "manager") return <p className="card text-sm">Trang dành cho chủ spa / quản lý.</p>;
  const sp = await searchParams;
  const today = todayVn();
  const thisMonth = today.slice(0, 7);
  let from = isDate(sp.tu) ? sp.tu : `${thisMonth}-01`;
  let to = isDate(sp.den) ? sp.den : today;
  if (to < from) [from, to] = [to, from];
  const branch = sp.cn ?? "";
  const days = (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
  const view = sp.xem === "thang" || sp.xem === "ngay" ? sp.xem : days > 62 ? "thang" : "ngay";

  const [{ data: branches }, { data, error }, { data: itemData }] = await Promise.all([
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    supabase.rpc("revenue_report", { p_from: from, p_to: to, p_branch: branch || null }),
    supabase.rpc("sales_by_item", { p_from: from, p_to: to, p_branch: branch || null }),
  ]);
  const rows = (data ?? []) as Row[];
  const items = (itemData ?? []) as ItemRow[];
  const bname = (id: string) => (branches ?? []).find((b) => b.id === id)?.name.replace("Moana ", "") ?? "?";

  const total = empty();
  const byPeriod = new Map<string, Sum>();
  const byBranch = new Map<string, Sum>();
  for (const r of rows) {
    add(total, r);
    const p = view === "thang" ? r.day.slice(0, 7) : r.day;
    if (!byPeriod.has(p)) byPeriod.set(p, empty());
    add(byPeriod.get(p)!, r);
    const bk = r.branch_id ?? "";
    if (!byBranch.has(bk)) byBranch.set(bk, empty());
    add(byBranch.get(bk)!, r);
  }
  const periods = [...byPeriod.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  const q = (o: Record<string, string>) => {
    const p = new URLSearchParams({ tu: from, den: to, ...(branch ? { cn: branch } : {}), ...o });
    return `/quan-ly/bao-cao?${p.toString()}`;
  };
  const year = today.slice(0, 4);
  const presets = [
    { label: "Hôm nay", tu: today, den: today },
    { label: "Tháng này", tu: `${thisMonth}-01`, den: today },
    { label: "Tháng trước", tu: `${shiftMonth(thisMonth, -1)}-01`, den: monthEnd(shiftMonth(thisMonth, -1)) },
    { label: `Năm ${year}`, tu: `${year}-01-01`, den: today },
  ];

  const typeRows = [
    { key: "service", label: TYPE_LABEL.service, realAmt: total.service, cardAmt: total.serviceCard },
    { key: "package", label: TYPE_LABEL.package, realAmt: total.pkg, cardAmt: 0 },
    { key: "product", label: TYPE_LABEL.product, realAmt: total.product, cardAmt: 0 },
    { key: "card_topup", label: TYPE_LABEL.card_topup, realAmt: total.topup, cardAmt: 0 },
  ];
  const grand = sales(total);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Báo cáo doanh thu</h1>
        <p className="text-sm text-ink/70">
          {shortLabel(from)}/{from.slice(0, 4)} – {shortLabel(to)}/{to.slice(0, 4)} · {branch ? bname(branch) : "Cả 2 chi nhánh"}
        </p>
      </div>
      <ReportNav active="doanh-thu" isOwner={role === "owner"} />

      <form className="card flex flex-wrap items-end gap-2 p-3 print:hidden" action="/quan-ly/bao-cao">
        <label className="text-xs">Từ ngày<input type="date" name="tu" defaultValue={from} className="input mt-1 py-2 text-sm" /></label>
        <label className="text-xs">Đến ngày<input type="date" name="den" defaultValue={to} className="input mt-1 py-2 text-sm" /></label>
        <label className="text-xs">
          Chi nhánh
          <select name="cn" defaultValue={branch} className="input mt-1 py-2 text-sm">
            <option value="">Cả 2 chi nhánh</option>
            {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="text-xs">
          Xem theo
          <select name="xem" defaultValue={view} className="input mt-1 py-2 text-sm">
            <option value="ngay">Ngày</option>
            <option value="thang">Tháng</option>
          </select>
        </label>
        <button className="btn-primary py-2">Xem</button>
        <div className="flex w-full flex-wrap gap-1">
          {presets.map((p) => (
            <Link key={p.label} href={q({ tu: p.tu, den: p.den, xem: p.label.startsWith("Năm") ? "thang" : "ngay" })} className="btn-ghost py-1 text-xs">
              {p.label}
            </Link>
          ))}
        </div>
      </form>

      {error && <p className="card text-sm text-[#8A2323]">{error.message}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Tiền thực thu" value={real(total)} hint="tiền mặt + chuyển khoản + POS" strong />
        <Stat label="Tiền trừ thẻ" value={total.card} hint="khách dùng thẻ đã nạp trước" />
        <Stat label="Hoàn tiền khách" value={-total.refund} hint="huỷ gói / thẻ" />
        <Stat label="Thực thu còn lại" value={real(total) - total.refund} hint="thực thu − hoàn tiền" strong />
      </div>

      <div className="card overflow-x-auto p-0">
        <p className="px-4 pt-3 text-sm font-semibold text-navy">Tiền đến từ đâu</p>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink/60">
            <tr>
              <th className="px-4 py-2">Nguồn</th>
              <th className="px-3 py-2 text-right">Thực thu</th>
              <th className="px-3 py-2 text-right">Trừ thẻ</th>
              <th className="px-3 py-2 text-right">Cộng</th>
              <th className="px-4 py-2 text-right">Tỉ trọng</th>
            </tr>
          </thead>
          <tbody>
            {typeRows.map((t) => (
              <tr key={t.key} className="border-t border-beige">
                <td className="px-4 py-2 font-medium">{t.label}</td>
                <td className="px-3 py-2 text-right">{formatVnd(t.realAmt)}</td>
                <td className="px-3 py-2 text-right">{t.cardAmt ? formatVnd(t.cardAmt) : "–"}</td>
                <td className="px-3 py-2 text-right font-semibold">{formatVnd(t.realAmt + t.cardAmt)}</td>
                <td className="px-4 py-2 text-right text-ink/60">{pctText(t.realAmt + t.cardAmt, grand)}</td>
              </tr>
            ))}
            <tr className="border-t border-beige-dark bg-cream font-bold text-navy">
              <td className="px-4 py-2">Tổng</td>
              <td className="px-3 py-2 text-right">{formatVnd(sales(total) - total.serviceCard)}</td>
              <td className="px-3 py-2 text-right">{formatVnd(total.serviceCard)}</td>
              <td className="px-3 py-2 text-right">{formatVnd(grand)}</td>
              <td className="px-4 py-2" />
            </tr>
          </tbody>
        </table>
        <p className="px-4 pb-3 pt-1 text-xs text-ink/60">
          Thu theo hình thức: tiền mặt {formatVnd(total.cash)} · chuyển khoản {formatVnd(total.transfer)} · POS {formatVnd(total.pos)}.
          Buổi trừ gói combo không có tiền (đã thu lúc bán gói).
          {(total.debt > 0 || total.debtIn > 0) && (
            <>
              {" "}Công nợ: khách nợ lại {formatVnd(total.debt)} (đã tính trong doanh số, chưa vào tiền thực thu) · thu nợ{" "}
              {formatVnd(total.debtIn)} (đã cộng vào tiền thực thu). <Link href="/quan-ly/bao-cao/cong-no" className="underline">Xem công nợ</Link>
            </>
          )}
        </p>
      </div>

      {!branch && byBranch.size > 0 && (
        <div className="card overflow-x-auto p-0">
          <p className="px-4 pt-3 text-sm font-semibold text-navy">Theo chi nhánh</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink/60">
              <tr>
                <th className="px-4 py-2">Chi nhánh</th>
                <th className="px-3 py-2 text-right">Thực thu</th>
                <th className="px-3 py-2 text-right">Trừ thẻ</th>
                <th className="px-3 py-2 text-right">Hoàn tiền</th>
                <th className="px-4 py-2 text-right">Thực thu còn lại</th>
              </tr>
            </thead>
            <tbody>
              {[...byBranch.entries()].map(([id, s]) => (
                <tr key={id} className="border-t border-beige">
                  <td className="px-4 py-2 font-medium">{id ? bname(id) : "Chưa rõ"}</td>
                  <td className="px-3 py-2 text-right">{formatVnd(real(s))}</td>
                  <td className="px-3 py-2 text-right">{formatVnd(s.card)}</td>
                  <td className="px-3 py-2 text-right">{s.refund ? formatVnd(-s.refund) : "–"}</td>
                  <td className="px-4 py-2 text-right font-semibold">{formatVnd(real(s) - s.refund)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <p className="px-4 pt-3 text-sm font-semibold text-navy">Theo {view === "thang" ? "tháng" : "ngày"}</p>
        {periods.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink/60">Chưa có hoá đơn trong khoảng này.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink/60">
              <tr>
                <th className="px-4 py-2">{view === "thang" ? "Tháng" : "Ngày"}</th>
                <th className="px-2 py-2 text-right">Dịch vụ</th>
                <th className="px-2 py-2 text-right">Gói</th>
                <th className="px-2 py-2 text-right">Sản phẩm</th>
                <th className="px-2 py-2 text-right">Nạp thẻ</th>
                <th className="px-2 py-2 text-right">Trừ thẻ</th>
                <th className="px-4 py-2 text-right">Thực thu</th>
              </tr>
            </thead>
            <tbody>
              {periods.map(([p, s]) => (
                <tr key={p} className="border-t border-beige">
                  <td className="px-4 py-2 font-medium">
                    {view === "ngay" ? (
                      <Link href={`/quan-ly/hoa-don?ngay=${p}${branch ? `&cn=${branch}` : ""}`} className="underline">{shortLabel(p)}</Link>
                    ) : (
                      <Link href={q({ tu: `${p}-01`, den: monthEnd(p), xem: "ngay" })} className="underline">{shortLabel(p)}</Link>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">{formatVnd(s.service)}</td>
                  <td className="px-2 py-2 text-right">{formatVnd(s.pkg)}</td>
                  <td className="px-2 py-2 text-right">{formatVnd(s.product)}</td>
                  <td className="px-2 py-2 text-right">{formatVnd(s.topup)}</td>
                  <td className="px-2 py-2 text-right text-ink/60">{formatVnd(s.card)}</td>
                  <td className="px-4 py-2 text-right font-semibold text-navy">
                    {formatVnd(real(s))}
                    {s.refund > 0 && <span className="block text-xs font-normal text-[#8A2323]">hoàn {formatVnd(s.refund)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {items.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(["service", "package", "product", "card_topup"] as const).map((t) => {
            const list = items.filter((i) => i.item_type === t).slice(0, 10);
            if (!list.length) return null;
            return (
              <div key={t} className="card p-0">
                <p className="px-4 pt-3 text-sm font-semibold text-navy">{TYPE_LABEL[t]} bán nhiều nhất</p>
                <ul className="divide-y divide-beige text-sm">
                  {list.map((i) => (
                    <li key={i.name} className="flex justify-between gap-2 px-4 py-1.5">
                      <span className="min-w-0">{i.name} <span className="text-ink/50">×{i.qty}</span></span>
                      <span className="shrink-0 text-right">
                        {formatVnd(Number(i.amount))}
                        {Number(i.card_amount) > 0 && <span className="block text-xs text-ink/50">trừ thẻ {formatVnd(Number(i.card_amount))}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-ink/60">
        Tính theo ngày chốt hoá đơn, không tính hoá đơn đã huỷ. <b>Tiền thực thu</b> là tiền mặt + chuyển khoản + POS khách trả (đã trừ
        giảm giá). <b>Trừ thẻ</b> là dịch vụ khách trả bằng thẻ nạp sẵn: tiền này đã thu lúc khách nạp thẻ (nằm trong "Nạp thẻ"), nên
        không cộng vào thực thu. Hoàn tiền tính theo ngày huỷ gói / thẻ.
      </p>
    </div>
  );
}

function Stat({ label, value, hint, strong }: { label: string; value: number; hint?: string; strong?: boolean }) {
  return (
    <div className="card p-3">
      <p className="text-xs text-ink/60">{label}</p>
      <p className={`mt-1 text-lg font-bold ${strong ? "text-navy" : ""} ${value < 0 ? "text-[#8A2323]" : ""}`}>{formatVnd(value)}</p>
      {hint && <p className="text-[11px] text-ink/50">{hint}</p>}
    </div>
  );
}
