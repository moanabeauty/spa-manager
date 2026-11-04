import Link from "next/link";
import { fillPhones } from "@/lib/phones";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatShortDate, formatVnd, todayVn } from "@/lib/format";

export const metadata = { title: "Công nợ khách – Moana Beauty" };

type Debt = {
  invoice_id: string; code: string; customer_id: string | null; branch_id: string; channel: string; paid_at: string;
  debt_amount: number; collected: number; outstanding: number;
};

export default async function DebtReportPage({ searchParams }: { searchParams: Promise<{ cn?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  if (profile?.role !== "owner" && profile?.role !== "manager") return <p className="card text-sm">Trang dành cho chủ spa / quản lý.</p>;
  const sp = await searchParams;
  const branch = sp.cn ?? "";
  let q = supabase.from("invoice_debts").select("*").gt("outstanding", 0).order("paid_at");
  if (branch) q = q.eq("branch_id", branch);
  const [{ data: branches }, { data }] = await Promise.all([
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    q,
  ]);
  const debts = (data ?? []) as Debt[];
  const ids = [...new Set(debts.map((d) => d.customer_id).filter(Boolean))] as string[];
  const { data: custData } = ids.length
    ? await supabase.from("customers").select("id, full_name").in("id", ids)
    : { data: [] as { id: string; full_name: string; phone: string | null }[] };
  const custList = (custData ?? []) as { id: string; full_name: string; phone: string | null }[];
  await fillPhones(supabase, custList);
  const cust = new Map(custList.map((c) => [c.id, c]));
  const today = new Date(`${todayVn()}T12:00:00+07:00`).getTime();
  const age = (iso: string) => Math.floor((today - new Date(iso).getTime()) / 86400000);

  // gom theo khách (đơn COD không có khách thì để riêng)
  const groups = new Map<string, { name: string; phone: string | null; id: string | null; items: Debt[]; total: number }>();
  for (const d of debts) {
    const key = d.customer_id ?? `cod-${d.invoice_id}`;
    const c = d.customer_id ? cust.get(d.customer_id) : null;
    if (!groups.has(key))
      groups.set(key, { name: c?.full_name ?? (d.channel === "online" ? "Đơn online (ship thu hộ)" : "Khách lẻ"), phone: c?.phone ?? null, id: d.customer_id, items: [], total: 0 });
    const g = groups.get(key)!;
    g.items.push(d);
    g.total += Number(d.outstanding);
  }
  const list = [...groups.values()].sort((a, b) => b.total - a.total);
  const total = debts.reduce((a, d) => a + Number(d.outstanding), 0);
  const cod = debts.filter((d) => d.channel === "online").reduce((a, d) => a + Number(d.outstanding), 0);
  const old30 = debts.filter((d) => age(d.paid_at) > 30).reduce((a, d) => a + Number(d.outstanding), 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Công nợ khách</h1>
        <p className="text-sm text-ink/70">Hoá đơn khách trả thiếu và đơn online chờ đơn vị ship trả tiền thu hộ.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/quan-ly/bao-cao/cong-no" className={`rounded-full px-4 py-2 text-sm font-semibold ${!branch ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}>Cả 2 chi nhánh</Link>
        {(branches ?? []).map((b) => (
          <Link key={b.id} href={`/quan-ly/bao-cao/cong-no?cn=${b.id}`} className={`rounded-full px-4 py-2 text-sm font-semibold ${branch === b.id ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}>
            {b.name}
          </Link>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Box label="Tổng khách còn nợ" value={total} strong />
        <Box label="Trong đó ship thu hộ (COD)" value={cod} />
        <Box label="Nợ quá 30 ngày" value={old30} warn={old30 > 0} />
        <Box label="Số hoá đơn" value={debts.length} plain />
      </div>
      {list.length === 0 && <p className="card text-sm text-ink/60">Không có khách nào đang nợ.</p>}
      <div className="space-y-2">
        {list.map((g, i) => (
          <div key={i} className="card p-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                {g.id ? (
                  <Link href={`/quan-ly/khach-hang?id=${g.id}`} className="font-semibold text-navy underline-offset-2 hover:underline">{g.name}</Link>
                ) : (
                  <p className="font-semibold">{g.name}</p>
                )}
                {g.phone && <p className="text-xs text-ink/60">{g.phone}</p>}
              </div>
              <p className="font-bold text-[#7A5600]">{formatVnd(g.total)}</p>
            </div>
            <ul className="mt-2 space-y-1">
              {g.items.map((d) => (
                <li key={d.invoice_id} className="flex justify-between gap-2 text-xs">
                  <Link href={`/quan-ly/hoa-don/${d.invoice_id}`} className="text-navy underline">
                    {d.code} · {formatShortDate(d.paid_at)}{d.channel === "online" ? " · online" : ""}
                  </Link>
                  <span className={age(d.paid_at) > 30 ? "text-[#8A2323]" : "text-ink/60"}>
                    {age(d.paid_at)} ngày · còn {formatVnd(Number(d.outstanding))}
                    {Number(d.collected) > 0 && ` (đã thu ${formatVnd(Number(d.collected))})`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function Box({ label, value, strong, warn, plain }: { label: string; value: number; strong?: boolean; warn?: boolean; plain?: boolean }) {
  return (
    <div className="card p-3">
      <p className="text-xs text-ink/60">{label}</p>
      <p className={`mt-1 text-lg font-bold ${warn ? "text-[#8A2323]" : strong ? "text-navy" : ""}`}>{plain ? value : formatVnd(value)}</p>
    </div>
  );
}
