import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatVnd, todayVn } from "@/lib/format";
import { CASH_METHOD_LABEL, isMonth, monthEnd, pctText, shortLabel } from "@/lib/reports";
import ReportNav from "../bao-cao/ReportNav";
import CashbookForm, { DeleteEntryButton, type Category } from "./CashbookForm";

export const metadata = { title: "Thu chi & lợi nhuận – Moana Beauty" };

type Flow = { month: number; kind: "income" | "expense"; source: string; category: string; amount: number };
type EntryRow = {
  id: string; entry_date: string; branch_id: string | null; kind: string; amount: number; method: string;
  description: string | null; source: string; cashbook_categories: { name: string } | null;
  status: string; code: string | null;
};

export default async function CashbookPage({ searchParams }: { searchParams: Promise<{ nam?: string; cn?: string; thang?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  if (profile?.role !== "owner") return <p className="card text-sm">Trang dành cho chủ spa.</p>;
  const sp = await searchParams;
  const today = todayVn();
  const year = sp.nam && /^\d{4}$/.test(sp.nam) ? Number(sp.nam) : Number(today.slice(0, 4));
  const branch = sp.cn ?? "";
  const month = isMonth(sp.thang) && sp.thang.startsWith(String(year)) ? sp.thang : year === Number(today.slice(0, 4)) ? today.slice(0, 7) : `${year}-12`;

  let eq = supabase
    .from("cashbook_entries")
    .select("id, entry_date, branch_id, kind, amount, method, description, source, status, code, cashbook_categories(name)")
    .gte("entry_date", `${month}-01`)
    .lte("entry_date", monthEnd(month))
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (branch) eq = eq.eq("branch_id", branch);
  const [{ data: branches }, { data: flowData, error }, { data: cats }, { data: entryData }] = await Promise.all([
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    supabase.rpc("cashflow_report", { p_year: year, p_branch: branch || null }),
    supabase.from("cashbook_categories").select("id, kind, name, sort_order, is_active").order("sort_order"),
    eq,
  ]);
  const flows = (flowData ?? []) as Flow[];
  const entries = (entryData ?? []) as unknown as EntryRow[];
  const bname = (id: string | null) => (id ? (branches ?? []).find((b) => b.id === id)?.name.replace("Moana ", "") ?? "?" : "Chung");

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const inc = (m: number) => flows.filter((f) => f.month === m && f.kind === "income").reduce((a, f) => a + Number(f.amount), 0);
  const exp = (m: number) => flows.filter((f) => f.month === m && f.kind === "expense").reduce((a, f) => a + Number(f.amount), 0);
  const totalInc = months.reduce((a, m) => a + inc(m), 0);
  const totalExp = months.reduce((a, m) => a + exp(m), 0);
  const selM = Number(month.slice(5, 7));

  const byCategory = (kind: "income" | "expense", m?: number) => {
    const map = new Map<string, number>();
    flows.filter((f) => f.kind === kind && (m === undefined || f.month === m)).forEach((f) => map.set(f.category, (map.get(f.category) ?? 0) + Number(f.amount)));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  };
  const link = (o: Record<string, string>) =>
    `/quan-ly/thu-chi?${new URLSearchParams({ nam: String(year), ...(branch ? { cn: branch } : {}), thang: month, ...o })}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Thu chi & lợi nhuận {year}</h1>
        <p className="text-sm text-ink/70">{branch ? bname(branch) : "Cả 2 chi nhánh + khoản chung"}</p>
      </div>
      <ReportNav active="thu-chi" isOwner />

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <Link href={link({ nam: String(year - 1), thang: `${year - 1}-12` })} className="btn-ghost">‹ {year - 1}</Link>
        <Link href={link({ nam: String(year + 1), thang: `${year + 1}-01` })} className="btn-ghost">{year + 1} ›</Link>
        <span className="mx-1 h-5 w-px bg-beige-dark" />
        <Link href={`/quan-ly/thu-chi?nam=${year}&thang=${month}`} className={`btn-ghost ${!branch ? "bg-beige" : ""}`}>Tất cả</Link>
        {(branches ?? []).map((b) => (
          <Link key={b.id} href={link({ cn: b.id })} className={`btn-ghost ${branch === b.id ? "bg-beige" : ""}`}>{b.name.replace("Moana ", "")}</Link>
        ))}
      </div>
      {error && <p className="card text-sm text-[#8A2323]">{error.message}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Box label={`Tổng thu ${year}`} value={totalInc} />
        <Box label={`Tổng chi ${year}`} value={totalExp} />
        <Box label="Lợi nhuận" value={totalInc - totalExp} strong />
        <div className="card p-3">
          <p className="text-xs text-ink/60">% lợi nhuận năm</p>
          <p className={`mt-1 text-lg font-bold ${totalInc - totalExp < 0 ? "text-[#8A2323]" : "text-navy"}`}>{pctText(totalInc - totalExp, totalInc)}</p>
          <p className="text-[11px] text-ink/50">lợi nhuận / tổng thu</p>
        </div>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-cream text-left text-xs text-ink/60">
            <tr>
              <th className="px-3 py-2">Tháng</th>
              <th className="px-2 py-2 text-right">Thu</th>
              <th className="px-2 py-2 text-right">Chi</th>
              <th className="px-2 py-2 text-right">Lợi nhuận</th>
              <th className="px-3 py-2 text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const i = inc(m), e = exp(m);
              const key = `${year}-${String(m).padStart(2, "0")}`;
              if (!i && !e && key > today.slice(0, 7)) return null;
              return (
                <tr key={m} className={`border-t border-beige ${m === selM ? "bg-[#FFF8E6]" : ""}`}>
                  <td className="px-3 py-2"><Link href={link({ thang: key })} className="font-medium underline">{shortLabel(key)}</Link></td>
                  <td className="px-2 py-2 text-right">{formatVnd(i)}</td>
                  <td className="px-2 py-2 text-right">{formatVnd(e)}</td>
                  <td className={`px-2 py-2 text-right font-semibold ${i - e < 0 ? "text-[#8A2323]" : "text-navy"}`}>{formatVnd(i - e)}</td>
                  <td className="px-3 py-2 text-right text-ink/70">{pctText(i - e, i)}</td>
                </tr>
              );
            })}
            <tr className="border-t border-beige-dark bg-cream font-bold text-navy">
              <td className="px-3 py-2">Cả năm</td>
              <td className="px-2 py-2 text-right">{formatVnd(totalInc)}</td>
              <td className="px-2 py-2 text-right">{formatVnd(totalExp)}</td>
              <td className="px-2 py-2 text-right">{formatVnd(totalInc - totalExp)}</td>
              <td className="px-3 py-2 text-right">{pctText(totalInc - totalExp, totalInc)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(["income", "expense"] as const).map((k) => (
          <div key={k} className="card p-0">
            <p className="px-4 pt-3 text-sm font-semibold text-navy">
              {k === "income" ? "Thu" : "Chi"} tháng {shortLabel(month)} theo danh mục
            </p>
            {byCategory(k, selM).length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink/60">Chưa có.</p>
            ) : (
              <ul className="divide-y divide-beige text-sm">
                {byCategory(k, selM).map(([c, v]) => (
                  <li key={c} className="flex justify-between gap-2 px-4 py-1.5">
                    <span>{c}</span>
                    <span className="text-right">
                      {formatVnd(v)}
                      <span className="block text-xs text-ink/50">{pctText(v, k === "income" ? inc(selM) : exp(selM))}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <CashbookForm
        categories={(cats ?? []) as Category[]}
        branches={(branches ?? []) as { id: string; name: string }[]}
        defaultDate={today.startsWith(month) ? today : monthEnd(month)}
        defaultBranch={branch}
      />

      <div className="card p-0">
        <p className="px-4 pt-3 text-sm font-semibold text-navy">Khoản đã nhập tháng {shortLabel(month)} ({entries.length})</p>
        {entries.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink/60">Chưa nhập khoản nào.</p>
        ) : (
          <ul className="divide-y divide-beige text-sm">
            {entries.map((e) => (
              <li key={e.id} className={`flex items-center justify-between gap-2 px-4 py-2 ${e.status !== "approved" ? "opacity-60" : ""}`}>
                <span className="min-w-0">
                  <span className="font-medium">{e.cashbook_categories?.name}</span>
                  {e.description && <> · {e.description}</>}
                  <span className="block text-xs text-ink/50">
                    {shortLabel(e.entry_date)} · {bname(e.branch_id)} · {CASH_METHOD_LABEL[e.method] ?? e.method}
                    {e.source === "payroll" && " · từ bảng lương"}
                    {e.source === "counter" && ` · phiếu tại quầy ${e.code ?? ""}`}
                    {e.status === "pending" && <b className="text-[#7A5600]"> · chờ duyệt (chưa tính)</b>}
                    {e.status === "rejected" && <b className="text-[#8A2323]"> · đã từ chối (không tính)</b>}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className={e.kind === "income" ? "text-[#22612A]" : "text-[#8A2323]"}>
                    {e.kind === "income" ? "+" : "−"}{formatVnd(Number(e.amount))}
                  </span>
                  <DeleteEntryButton id={e.id} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-ink/60">
        <b>Thu</b> = tiền khách trả tại quầy (tiền mặt + chuyển khoản + POS, gồm cả tiền nạp thẻ và bán gói) + tiền thu nợ khách + các khoản
        thu nhập tay. Phiếu thu / chi tại quầy chỉ được tính sau khi chủ spa / quản lý duyệt.
        Dịch vụ trừ thẻ không tính lại vì tiền đã thu lúc nạp. <b>Chi</b> = tiền hoàn khách khi huỷ gói / thẻ + các khoản chi nhập tay
        (lương ghi từ trang Bảng lương). Lọc theo chi nhánh thì không gồm khoản “Chung”. Đây là dòng tiền thực tế: tháng khách nạp thẻ
        / mua gói nhiều thì lợi nhuận cao, nhưng spa vẫn còn nợ dịch vụ (xem trang Gói & thẻ).
      </p>
    </div>
  );
}

function Box({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="card p-3">
      <p className="text-xs text-ink/60">{label}</p>
      <p className={`mt-1 text-lg font-bold ${value < 0 ? "text-[#8A2323]" : strong ? "text-navy" : ""}`}>{formatVnd(value)}</p>
    </div>
  );
}
