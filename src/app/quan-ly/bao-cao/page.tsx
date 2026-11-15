import { activeBranches } from "@/lib/refData";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatVnd, todayVn } from "@/lib/format";
import { isDate, monthEnd, pctText, shiftMonth } from "@/lib/reports";
import ExportButtons from "./ExportButtons";

export const metadata = { title: "Báo cáo doanh thu – Moana Beauty" };

type Overview = {
  as_of: string;
  real: { cash: number; transfer: number; pos: number; debt_in: number; refund: number; total: number };
  net: { service: number; product: number; card: number; card_face: number; combo: number; combo_n: number; combo_face: number; total: number };
  prepaid: { package: number; package_n: number; topup: number; topup_n: number };
  new_debt: number;
  liab: { card_balance: number; card_owed: number; cards_n: number; pkg_owed: number; pkg_sessions: number; pkgs_n: number };
  days: { day: string; real: number; net: number }[];
  categories: { name: string; amount: number; cnt: number }[];
  services: { name: string; cat: string; amount: number; cnt: number }[];
};

type Kind = "tuan" | "thang" | "nam" | "khac";
const KIND_LABEL: Record<Kind, string> = { tuan: "Tuần", thang: "Tháng", nam: "Năm", khac: "Tự chọn" };

// ---- tính khoảng ngày (chuỗi YYYY-MM-DD, không lệch múi giờ) ----
const toD = (s: string) => new Date(`${s}T00:00:00Z`);
const fromD = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => fromD(new Date(toD(s).getTime() + n * 86400000));
const dm = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const dmy = (s: string) => `${dm(s)}/${s.slice(0, 4)}`;

function rangeOf(kind: Kind, anchor: string): [string, string] {
  if (kind === "tuan") {
    const wd = (toD(anchor).getUTCDay() + 6) % 7; // thứ 2 = 0
    const start = addDays(anchor, -wd);
    return [start, addDays(start, 6)];
  }
  if (kind === "nam") return [`${anchor.slice(0, 4)}-01-01`, `${anchor.slice(0, 4)}-12-31`];
  const m = anchor.slice(0, 7);
  return [`${m}-01`, monthEnd(m)];
}
function shiftAnchor(kind: Kind, anchor: string, d: number): string {
  if (kind === "tuan") return addDays(anchor, 7 * d);
  if (kind === "nam") return `${Number(anchor.slice(0, 4)) + d}-01-01`;
  return `${shiftMonth(anchor.slice(0, 7), d)}-01`;
}
function periodTitle(kind: Kind, from: string, to: string): string {
  if (kind === "nam") return `Năm ${from.slice(0, 4)}`;
  if (kind === "thang") return `Tháng ${from.slice(5, 7)}/${from.slice(0, 4)}`;
  if (kind === "tuan") return `Tuần ${dm(from)} – ${dmy(to)}`;
  return `${dmy(from)} – ${dmy(to)}`;
}

const n = (v: unknown) => Number(v ?? 0);

export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ ky?: string; ngay?: string; tu?: string; den?: string; cn?: string }>;
}) {
  const { supabase, profile } = await getCurrentUser();
  const role = profile?.role;
  if (role !== "owner" && role !== "manager") return <p className="card text-sm">Trang dành cho chủ spa / quản lý.</p>;
  const sp = await searchParams;
  const today = todayVn();
  const kind: Kind = sp.ky === "tuan" || sp.ky === "nam" || sp.ky === "khac" ? sp.ky : "thang";
  const anchor = isDate(sp.ngay) ? sp.ngay : today;
  let [from, to] = rangeOf(kind, anchor);
  if (kind === "khac") {
    from = isDate(sp.tu) ? sp.tu : `${today.slice(0, 7)}-01`;
    to = isDate(sp.den) ? sp.den : today;
    if (to < from) [from, to] = [to, from];
  }
  const branch = sp.cn ?? "";

  const [{ data: branches }, { data, error }] = await Promise.all([
    activeBranches(),
    supabase.rpc("report_overview", { p_from: from, p_to: to, p_branch: branch || null }),
  ]);
  const o = data as Overview | null;
  const bname = (id: string) => (branches ?? []).find((b) => b.id === id)?.name ?? "";
  const branchLabel = branch ? bname(branch) : "Cả 2 chi nhánh";
  const title = periodTitle(kind, from, to);

  const link = (p: Record<string, string>) => {
    const q = new URLSearchParams({ ky: kind, ngay: anchor, ...(branch ? { cn: branch } : {}), ...p });
    return `/quan-ly/bao-cao?${q.toString()}`;
  };

  // bảng theo ngày (tuần, tháng, tự chọn ngắn) hoặc theo tháng (năm, tự chọn dài)
  const byMonth = kind === "nam" || (kind === "khac" && (toD(to).getTime() - toD(from).getTime()) / 86400000 > 62);
  const periodRows = new Map<string, { real: number; net: number }>();
  for (const d of o?.days ?? []) {
    const k = byMonth ? d.day.slice(0, 7) : d.day;
    const r = periodRows.get(k) ?? { real: 0, net: 0 };
    r.real += n(d.real);
    r.net += n(d.net);
    periodRows.set(k, r);
  }
  const periods = [...periodRows.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const real = o?.real;
  const net = o?.net;
  const liab = o?.liab;
  const liabTotal = n(liab?.card_owed) + n(liab?.pkg_owed);
  const cats = o?.categories ?? [];
  const catMax = Math.max(1, ...cats.map((c) => n(c.amount)));
  const netTotal = n(net?.total);
  const asOf = o?.as_of ?? to;

  // ---- dữ liệu xuất Excel ----
  const rows: (string | number)[][] = [
    ["BÁO CÁO DOANH THU MOANA BEAUTY"],
    ["Kỳ báo cáo", title],
    ["Chi nhánh", branchLabel],
    ["Từ ngày", dmy(from), "Đến ngày", dmy(to)],
    [],
    ["TỔNG QUAN", "Số tiền (đ)"],
    ["Doanh thu thực (tiền thực thu)", n(real?.total)],
    ["Doanh thu thuần (đã làm / bán cho khách)", netTotal],
    [`Nợ khách hàng (tại ${dmy(asOf)})`, liabTotal],
    [],
    ["DOANH THU THỰC", "Số tiền (đ)"],
    ["Tiền mặt", n(real?.cash)],
    ["Chuyển khoản", n(real?.transfer)],
    ["Quẹt thẻ POS", n(real?.pos)],
    ["Trong đó: thu nợ khách", n(real?.debt_in)],
    ["Hoàn tiền khách (đã trừ)", -n(real?.refund)],
    ["Cộng doanh thu thực", n(real?.total)],
    ["Tham khảo: bán gói combo", n(o?.prepaid.package), `${n(o?.prepaid.package_n)} gói`],
    ["Tham khảo: nạp thẻ tài khoản", n(o?.prepaid.topup), `${n(o?.prepaid.topup_n)} lần`],
    ["Tham khảo: khách nợ mới", n(o?.new_debt)],
    [],
    ["DOANH THU THUẦN", "Số tiền (đ)", "Ghi chú"],
    ["Dịch vụ lẻ trả tiền", n(net?.service)],
    ["Sản phẩm bán lẻ", n(net?.product)],
    ["Dịch vụ trừ thẻ (quy ra tiền thật)", n(net?.card), `trên thẻ ${n(net?.card_face)}`],
    ["Buổi combo đã làm (quy ra tiền thật)", n(net?.combo), `${n(net?.combo_n)} buổi, giá lẻ ${n(net?.combo_face)}`],
    ["Cộng doanh thu thuần", netTotal],
    [],
    [`NỢ KHÁCH HÀNG TẠI ${dmy(asOf)}`, "Số tiền (đ)", "Ghi chú"],
    ["Thẻ tài khoản – thực nợ", n(liab?.card_owed), `${n(liab?.cards_n)} thẻ, số dư ${n(liab?.card_balance)}`],
    ["Combo còn buổi – giá trị còn nợ", n(liab?.pkg_owed), `${n(liab?.pkgs_n)} gói, ${n(liab?.pkg_sessions)} buổi`],
    ["Cộng nợ khách hàng", liabTotal],
    [],
    ["NHÓM LIỆU TRÌNH THEO DOANH THU THUẦN", "Số tiền (đ)", "Số lượt", "Tỉ trọng"],
    ...cats.map((c) => [c.name, n(c.amount), n(c.cnt), pctText(n(c.amount), netTotal)]),
    [],
    ["LIỆU TRÌNH DOANH THU CAO NHẤT", "Nhóm", "Số tiền (đ)", "Số lượt"],
    ...(o?.services ?? []).map((s) => [s.name, s.cat, n(s.amount), n(s.cnt)]),
    [],
    [byMonth ? "THEO THÁNG" : "THEO NGÀY", "Doanh thu thực", "Doanh thu thuần"],
    ...periods.map(([p, s]) => [byMonth ? `${p.slice(5, 7)}/${p.slice(0, 4)}` : dmy(p), s.real, s.net]),
  ];
  const fileName = `bao-cao-doanh-thu_${from}_${to}${branch ? "_" + bname(branch).replace(/\s+/g, "-") : ""}.csv`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-navy">Báo cáo doanh thu</h1>
          <p className="text-sm text-ink/70">
            {title} · {branchLabel}
          </p>
        </div>
        <ExportButtons filename={fileName} rows={rows} />
      </div>

      <div className="card space-y-3 p-3 print:hidden">
        <div className="flex flex-wrap items-center gap-1">
          {(["tuan", "thang", "nam", "khac"] as Kind[]).map((k) => (
            <Link
              key={k}
              href={link({ ky: k, ngay: today })}
              className={`${kind === k ? "btn-primary" : "btn-ghost"} py-1.5 text-sm`}
            >
              {KIND_LABEL[k]}
            </Link>
          ))}
        </div>
        {kind !== "khac" && (
          <div className="flex items-center gap-2">
            <Link href={link({ ngay: shiftAnchor(kind, anchor, -1) })} className="btn-outline px-3 py-1.5 text-sm">‹</Link>
            <span className="flex-1 text-center text-sm font-semibold text-navy">{title}</span>
            <Link href={link({ ngay: shiftAnchor(kind, anchor, 1) })} className="btn-outline px-3 py-1.5 text-sm">›</Link>
          </div>
        )}
        <form className="flex flex-wrap items-end gap-2" action="/quan-ly/bao-cao">
          <input type="hidden" name="ky" value={kind} />
          {kind === "khac" ? (
            <>
              <label className="text-xs">Từ ngày<input type="date" name="tu" defaultValue={from} className="input mt-1 py-2 text-sm" /></label>
              <label className="text-xs">Đến ngày<input type="date" name="den" defaultValue={to} className="input mt-1 py-2 text-sm" /></label>
            </>
          ) : (
            <input type="hidden" name="ngay" value={anchor} />
          )}
          <label className="text-xs">
            Chi nhánh
            <select name="cn" defaultValue={branch} className="input mt-1 py-2 text-sm">
              <option value="">Cả 2 chi nhánh</option>
              {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <button className="btn-primary py-2 text-sm">Xem</button>
        </form>
      </div>

      {error && <p className="card text-sm text-[#8A2323]">{error.message}</p>}

      {o && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Doanh thu thực" value={n(real?.total)} hint="tiền mặt + chuyển khoản + POS thực nhận, đã trừ hoàn tiền" />
            <Stat label="Doanh thu thuần" value={netTotal} hint="giá trị dịch vụ, sản phẩm đã làm / bán cho khách (quy ra tiền thật)" />
            <Stat label="Nợ khách hàng" value={liabTotal} hint={`tiền thẻ + combo spa còn phải phục vụ, tính đến ${dmy(asOf)}`} warn />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <Box title="Doanh thu thực">
              <Line label="Tiền mặt" value={n(real?.cash)} />
              <Line label="Chuyển khoản" value={n(real?.transfer)} />
              <Line label="Quẹt thẻ POS" value={n(real?.pos)} />
              {n(real?.debt_in) > 0 && <Line label="trong đó thu nợ khách" value={n(real?.debt_in)} muted />}
              {n(real?.refund) > 0 && <Line label="Hoàn tiền khách" value={-n(real?.refund)} />}
              <Line label="Cộng" value={n(real?.total)} strong />
              <p className="pt-2 text-xs text-ink/60">Tham khảo – tiền khách trả trước trong kỳ:</p>
              <Line label={`Bán gói combo (${n(o.prepaid.package_n)})`} value={n(o.prepaid.package)} muted />
              <Line label={`Nạp thẻ (${n(o.prepaid.topup_n)} lần)`} value={n(o.prepaid.topup)} muted />
              {n(o.new_debt) > 0 && (
                <Line label={<Link href="/quan-ly/bao-cao/cong-no" className="underline">Khách nợ mới</Link>} value={n(o.new_debt)} muted />
              )}
            </Box>

            <Box title="Doanh thu thuần">
              <Line label="Dịch vụ lẻ trả tiền" value={n(net?.service)} />
              <Line label="Sản phẩm bán lẻ" value={n(net?.product)} />
              <Line label="Dịch vụ trừ thẻ" value={n(net?.card)} sub={n(net?.card_face) ? `trên thẻ ${formatVnd(n(net?.card_face))}` : undefined} />
              <Line
                label={`Buổi combo đã làm (${n(net?.combo_n)})`}
                value={n(net?.combo)}
                sub={n(net?.combo_face) ? `giá lẻ ${formatVnd(n(net?.combo_face))}` : undefined}
              />
              <Line label="Cộng" value={netTotal} strong />
            </Box>

            <Box title={`Nợ khách hàng (đến ${dmy(asOf)})`}>
              <Line label={`Thẻ tài khoản (${n(liab?.cards_n)} thẻ)`} value={n(liab?.card_owed)} sub={`số dư trên thẻ ${formatVnd(n(liab?.card_balance))}`} />
              <Line label={`Combo còn ${n(liab?.pkg_sessions)} buổi (${n(liab?.pkgs_n)} gói)`} value={n(liab?.pkg_owed)} />
              <Line label="Cộng" value={liabTotal} strong />
              <Link href="/quan-ly/bao-cao/goi-the" className="block pt-2 text-xs text-navy underline print:hidden">Xem từng khách →</Link>
            </Box>
          </div>

          <div className="card p-0">
            <p className="px-4 pt-3 text-sm font-semibold text-navy">Nhóm liệu trình mang về doanh thu nhiều nhất</p>
            {cats.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink/60">Chưa có dịch vụ nào trong kỳ.</p>
            ) : (
              <ol className="space-y-2 px-4 py-3">
                {cats.map((c, i) => (
                  <li key={c.name} className="text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="min-w-0">
                        <b className="text-navy">{i + 1}.</b> {c.name} <span className="text-ink/50">· {n(c.cnt)} lượt</span>
                      </span>
                      <span className="shrink-0 font-semibold">
                        {formatVnd(n(c.amount))} <span className="font-normal text-ink/50">{pctText(n(c.amount), netTotal)}</span>
                      </span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-beige">
                      <div className="h-2 rounded-full bg-navy" style={{ width: `${Math.max(2, (n(c.amount) / catMax) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {(o.services ?? []).length > 0 && (
              <details className="border-t border-beige px-4 py-2 text-sm" open>
                <summary className="cursor-pointer text-xs font-semibold text-ink/70">Liệu trình doanh thu cao nhất</summary>
                <ul className="divide-y divide-beige">
                  {o.services.map((s) => (
                    <li key={s.name + s.cat} className="flex justify-between gap-2 py-1.5">
                      <span className="min-w-0">
                        {s.name} <span className="text-ink/50">×{n(s.cnt)}</span>
                        <span className="block text-xs text-ink/50">{s.cat}</span>
                      </span>
                      <span className="shrink-0">{formatVnd(n(s.amount))}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <div className="card overflow-x-auto p-0">
            <p className="px-4 pt-3 text-sm font-semibold text-navy">Theo {byMonth ? "tháng" : "ngày"}</p>
            {periods.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink/60">Chưa có số liệu trong kỳ này.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-ink/60">
                  <tr>
                    <th className="px-4 py-2">{byMonth ? "Tháng" : "Ngày"}</th>
                    <th className="px-3 py-2 text-right">Doanh thu thực</th>
                    <th className="px-4 py-2 text-right">Doanh thu thuần</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map(([p, s]) => (
                    <tr key={p} className="border-t border-beige">
                      <td className="px-4 py-2 font-medium">
                        {byMonth ? (
                          <Link href={link({ ky: "thang", ngay: `${p}-01` })} className="underline">{p.slice(5, 7)}/{p.slice(0, 4)}</Link>
                        ) : (
                          <Link href={`/quan-ly/hoa-don?ngay=${p}${branch ? `&cn=${branch}` : ""}`} className="underline">{dm(p)}</Link>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{formatVnd(s.real)}</td>
                      <td className="px-4 py-2 text-right">{formatVnd(s.net)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-beige-dark bg-cream font-bold text-navy">
                    <td className="px-4 py-2">Tổng</td>
                    <td className="px-3 py-2 text-right">{formatVnd(n(real?.total))}</td>
                    <td className="px-4 py-2 text-right">{formatVnd(netTotal)}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>

          <div className="space-y-1 text-xs text-ink/60">
            <p><b>Doanh thu thực</b>: tiền mặt + chuyển khoản + POS thực nhận trong kỳ (gồm thu nợ cũ), trừ tiền hoàn cho khách. Tính theo ngày chốt hoá đơn, bỏ hoá đơn đã huỷ.</p>
            <p>
              <b>Doanh thu thuần</b>: giá trị đã thực sự làm / bán cho khách trong kỳ. Dịch vụ trừ thẻ quy ra tiền thật theo mệnh giá / (mệnh giá +
              tặng), vd thẻ nạp 10tr được 13tr thì làm 1,3tr trên thẻ = 1tr. Buổi combo = giá gói × giá lẻ buổi đó / tổng giá lẻ cả gói. Tiền bán
              gói và nạp thẻ chưa tính vào đây (là tiền khách trả trước).
            </p>
            <p><b>Nợ khách hàng</b>: tiền spa còn phải phục vụ tính đến cuối kỳ: số dư thẻ quy ra tiền thật + phần combo chưa làm (gói đã hết hạn không tính).</p>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint, warn }: { label: string; value: number; hint: string; warn?: boolean }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-ink/60">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${warn ? "text-[#8A2323]" : "text-navy"}`}>{formatVnd(value)}</p>
      <p className="mt-1 text-[11px] text-ink/50">{hint}</p>
    </div>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <p className="mb-2 text-sm font-semibold text-navy">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Line({ label, value, sub, strong, muted }: { label: React.ReactNode; value: number; sub?: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 text-sm ${strong ? "border-t border-beige pt-1 font-bold text-navy" : ""} ${muted ? "text-ink/60" : ""}`}>
      <span className="min-w-0">
        {label}
        {sub && <span className="block text-[11px] font-normal text-ink/50">{sub}</span>}
      </span>
      <span className={`shrink-0 ${value < 0 ? "text-[#8A2323]" : ""}`}>{formatVnd(value)}</span>
    </div>
  );
}
