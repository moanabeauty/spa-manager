import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatDmy2, formatVnd, normalizeText, todayVn } from "@/lib/format";
import { isMonth, monthEnd, shiftMonth, shortLabel } from "@/lib/reports";
import ReportNav from "../ReportNav";

export const metadata = { title: "Gói & thẻ còn nợ khách – Moana Beauty" };

type Card = {
  card_id: string; code: string; customer_id: string; customer_name: string; phone: string | null; branch_id: string | null;
  topup: number; bonus: number; balance: number; real_owed: number; last_used_at: string | null;
};
type Pkg = {
  customer_package_id: string; customer_id: string; customer_name: string; phone: string | null; branch_id: string | null;
  package_name: string; purchased_at: string; expires_at: string | null; expired: boolean; paid: number;
  used_sessions: number; used_value: number; remaining_sessions: number; has_unlimited: boolean; owed_value: number;
  items: { label: string; total: number | null; used: number }[];
};
type ItemRow = { item_type: string; name: string; qty: number; amount: number };

const d = formatDmy2;

export default async function LiabilitiesPage({ searchParams }: { searchParams: Promise<{ thang?: string; cn?: string; q?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  const role = profile?.role;
  if (role !== "owner" && role !== "manager") return <p className="card text-sm">Trang dành cho chủ spa / quản lý.</p>;
  const sp = await searchParams;
  const month = isMonth(sp.thang) ? sp.thang : todayVn().slice(0, 7);
  const branch = sp.cn ?? "";
  const search = normalizeText(sp.q ?? "").trim();

  const [{ data: branches }, { data: cardData }, { data: pkgData }, { data: soldData }] = await Promise.all([
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    supabase.rpc("card_liabilities"),
    supabase.rpc("package_liabilities"),
    supabase.rpc("sales_by_item", { p_from: `${month}-01`, p_to: monthEnd(month), p_branch: branch || null }),
  ]);
  const match = (name: string, phone: string | null) =>
    !search || normalizeText(name).includes(search) || (phone ?? "").includes(search.replace(/\s/g, ""));
  const cards = ((cardData ?? []) as Card[]).filter((c) => (!branch || c.branch_id === branch) && match(c.customer_name, c.phone));
  const pkgs = ((pkgData ?? []) as Pkg[]).filter((p) => (!branch || p.branch_id === branch) && match(p.customer_name, p.phone));
  const sold = ((soldData ?? []) as ItemRow[]).filter((i) => i.item_type === "package" || i.item_type === "card_topup");
  const bname = (id: string | null) => (branches ?? []).find((b) => b.id === id)?.name.replace("Moana ", "") ?? "";

  const active = pkgs.filter((p) => !p.expired);
  const expired = pkgs.filter((p) => p.expired);
  const sum = (a: number[]) => a.reduce((x, y) => x + Number(y), 0);
  const cardBalance = sum(cards.map((c) => c.balance));
  const cardOwed = sum(cards.map((c) => c.real_owed));
  const sessions = sum(active.map((p) => p.remaining_sessions));
  const pkgOwed = sum(active.map((p) => p.owed_value));
  const link = (o: Record<string, string>) =>
    `/quan-ly/bao-cao/goi-the?${new URLSearchParams({ thang: month, ...(branch ? { cn: branch } : {}), ...(sp.q ? { q: sp.q } : {}), ...o })}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Gói & thẻ</h1>
        <p className="text-sm text-ink/70">Đã bán trong tháng, số buổi và số tiền spa còn nợ khách</p>
      </div>
      <ReportNav active="goi-the" isOwner={role === "owner"} />

      <form className="card flex flex-wrap items-end gap-2 p-3" action="/quan-ly/bao-cao/goi-the">
        <input type="hidden" name="thang" value={month} />
        <label className="text-xs">
          Chi nhánh bán
          <select name="cn" defaultValue={branch} className="input mt-1 py-2 text-sm">
            <option value="">Cả 2 chi nhánh</option>
            {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="min-w-40 flex-1 text-xs">
          Tìm khách (tên / SĐT)
          <input name="q" defaultValue={sp.q ?? ""} className="input mt-1 py-2 text-sm" />
        </label>
        <button className="btn-primary py-2">Lọc</button>
      </form>

      <div className="card p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
          <p className="text-sm font-semibold text-navy">Đã bán tháng {shortLabel(month)}</p>
          <div className="flex gap-1">
            <Link href={link({ thang: shiftMonth(month, -1) })} className="btn-ghost py-1 text-xs">‹ Trước</Link>
            <Link href={link({ thang: shiftMonth(month, 1) })} className="btn-ghost py-1 text-xs">Sau ›</Link>
          </div>
        </div>
        {sold.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink/60">Chưa bán gói / thẻ nào.</p>
        ) : (
          <ul className="divide-y divide-beige text-sm">
            {sold.map((i) => (
              <li key={i.item_type + i.name} className="flex justify-between gap-2 px-4 py-1.5">
                <span>{i.item_type === "card_topup" ? "💳" : "🎁"} {i.name} <span className="text-ink/50">×{i.qty}</span></span>
                <span className="font-medium">{formatVnd(Number(i.amount))}</span>
              </li>
            ))}
            <li className="flex justify-between gap-2 bg-cream px-4 py-2 font-semibold text-navy">
              <span>
                {sum(sold.filter((i) => i.item_type === "package").map((i) => i.qty))} gói ·{" "}
                {sum(sold.filter((i) => i.item_type === "card_topup").map((i) => i.qty))} lần nạp thẻ
              </span>
              <span>{formatVnd(sum(sold.map((i) => i.amount)))}</span>
            </li>
          </ul>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-3">
          <p className="text-xs text-ink/60">Buổi combo còn nợ</p>
          <p className="mt-1 text-lg font-bold text-navy">{sessions} buổi</p>
          <p className="text-[11px] text-ink/50">{active.length} gói đang dùng</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-ink/60">Giá trị combo còn nợ</p>
          <p className="mt-1 text-lg font-bold text-navy">{formatVnd(pkgOwed)}</p>
          <p className="text-[11px] text-ink/50">giá mua − buổi đã dùng × giá lẻ</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-ink/60">Số dư thẻ của khách</p>
          <p className="mt-1 text-lg font-bold">{formatVnd(cardBalance)}</p>
          <p className="text-[11px] text-ink/50">{cards.length} thẻ, gồm cả tiền tặng</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-ink/60">Tiền thực nợ khách có thẻ</p>
          <p className="mt-1 text-lg font-bold text-navy">{formatVnd(cardOwed)}</p>
          <p className="text-[11px] text-ink/50">số dư × mệnh giá / (mệnh giá + tặng)</p>
        </div>
      </div>

      <div className="card overflow-x-auto p-0">
        <p className="px-4 pt-3 text-sm font-semibold text-navy">Thẻ tài khoản còn số dư</p>
        {cards.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink/60">Không có thẻ nào còn số dư.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink/60">
              <tr>
                <th className="px-4 py-2">Khách</th>
                <th className="px-2 py-2 text-right">Đã nạp + tặng</th>
                <th className="px-2 py-2 text-right">Số dư</th>
                <th className="px-4 py-2 text-right">Thực nợ</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.card_id} className="border-t border-beige">
                  <td className="px-4 py-2">
                    <Link href={`/quan-ly/khach-hang?id=${c.customer_id}`} className="font-medium text-navy underline">{c.customer_name}</Link>
                    <span className="block text-xs text-ink/50">
                      {c.code} · {c.phone} {bname(c.branch_id) && `· ${bname(c.branch_id)}`}
                      {c.last_used_at && ` · dùng gần nhất ${d(c.last_used_at)}`}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right text-xs">
                    {formatVnd(Number(c.topup))}
                    <span className="block text-ink/50">+ {formatVnd(Number(c.bonus))}</span>
                  </td>
                  <td className="px-2 py-2 text-right">{formatVnd(Number(c.balance))}</td>
                  <td className="px-4 py-2 text-right font-semibold">{formatVnd(Number(c.real_owed))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <PkgTable title="Gói combo còn buổi" rows={active} bname={bname} />
      {expired.length > 0 && <PkgTable title="Gói đã hết hạn nhưng còn buổi" rows={expired} bname={bname} muted />}

      <p className="text-xs text-ink/60">
        Ví dụ thẻ: khách nạp 10.000.000đ được 13.000.000đ (tặng 3tr), còn số dư 6.500.000đ thì spa thực nợ 6.500.000 × 10/13 =
        5.000.000đ. Gói combo: giá trị còn nợ = giá khách trả cho gói − số buổi đã làm × giá lẻ / buổi (giống cách tính khi huỷ gói hoàn
        tiền). Gói không giới hạn buổi (vd Glow Infinite) ghi "∞" đến khi hết hạn.
      </p>
    </div>
  );
}

function PkgTable({ title, rows, bname, muted }: { title: string; rows: Pkg[]; bname: (id: string | null) => string; muted?: boolean }) {
  return (
    <div className={`card overflow-x-auto p-0 ${muted ? "opacity-80" : ""}`}>
      <p className="px-4 pt-3 text-sm font-semibold text-navy">{title} ({rows.length})</p>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink/60">Không có gói nào.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink/60">
            <tr>
              <th className="px-4 py-2">Khách / gói</th>
              <th className="px-2 py-2">Còn lại</th>
              <th className="px-2 py-2 text-right">Giá mua</th>
              <th className="px-4 py-2 text-right">Còn nợ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.customer_package_id} className="border-t border-beige align-top">
                <td className="px-4 py-2">
                  <Link href={`/quan-ly/khach-hang?id=${p.customer_id}`} className="font-medium text-navy underline">{p.customer_name}</Link>
                  <span className="block text-xs">{p.package_name}</span>
                  <span className="block text-xs text-ink/50">
                    {p.phone} · mua {d(p.purchased_at)}
                    {p.expires_at && ` · hạn ${d(p.expires_at)}`}
                    {bname(p.branch_id) && ` · ${bname(p.branch_id)}`}
                  </span>
                </td>
                <td className="px-2 py-2 text-xs">
                  <span className="text-base font-bold text-navy">{p.remaining_sessions}{p.has_unlimited ? " + ∞" : ""}</span> buổi
                  {p.items.map((i, k) => (
                    <span key={k} className="block text-ink/60">
                      {i.label}: {i.total === null ? `∞ (đã ${i.used})` : `${i.total - i.used}/${i.total}`}
                    </span>
                  ))}
                </td>
                <td className="px-2 py-2 text-right">{formatVnd(Number(p.paid))}</td>
                <td className="px-4 py-2 text-right font-semibold">{formatVnd(Number(p.owed_value))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
