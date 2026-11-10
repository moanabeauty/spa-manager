import { getCurrentUser } from "@/lib/supabase/server";
import { formatVnd } from "@/lib/format";
import PayButton from "./PayButton";

export const metadata = { title: "Công nợ nhà cung cấp – Moana Beauty" };

type Row = {
  receipt_id: string;
  code: string;
  created_at: string;
  approved_at: string | null;
  warehouse: string;
  supplier_id: string | null;
  supplier: string | null;
  goods_total: number;
  extra_cost_total: number;
  payable: number;
  paid: number;
  payments: { amount: number; method: string; paid_on: string; note: string | null }[];
};

const d = (s: string) => new Date(s).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

export default async function SupplierDebtPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  if (profile?.role !== "owner") return <p className="card text-sm">Chỉ chủ spa xem công nợ nhà cung cấp.</p>;
  const sp = await searchParams;
  const showAll = sp.all === "1";
  const { data } = await supabase.rpc("supplier_ledger");
  const rows = ((data ?? []) as Row[]).map((r) => ({ ...r, goods_total: Number(r.goods_total), extra_cost_total: Number(r.extra_cost_total), payable: Number(r.payable), paid: Number(r.paid) }));

  const groups = new Map<string, { name: string; rows: Row[]; debt: number; payable: number; paid: number }>();
  rows.forEach((r) => {
    const key = r.supplier_id ?? "none";
    const g = groups.get(key) ?? { name: r.supplier ?? "Chưa ghi nhà cung cấp", rows: [], debt: 0, payable: 0, paid: 0 };
    g.rows.push(r);
    g.payable += r.payable;
    g.paid += r.paid;
    g.debt += r.payable - r.paid;
    groups.set(key, g);
  });
  const list = [...groups.values()].filter((g) => showAll || g.debt > 0).sort((a, b) => b.debt - a.debt);
  const totalDebt = [...groups.values()].reduce((a, g) => a + g.debt, 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Công nợ nhà cung cấp</h1>
        <p className="text-sm text-ink/70">Từ các phiếu nhập đã duyệt. Bấm “Trả tiền” để ghi các lần thanh toán tiếp theo.</p>
      </div>

      <div className="card flex items-center justify-between p-4">
        <span className="text-sm">Tổng dư nợ tất cả nhà cung cấp</span>
        <b className="text-lg text-[#8A2323]">{formatVnd(totalDebt)}</b>
      </div>

      <div className="flex gap-2 text-sm">
        <a href="/quan-ly/kho/cong-no-ncc" className={`rounded-full px-3 py-1.5 font-semibold ${!showAll ? "bg-navy text-white" : "bg-white text-navy"}`}>Đang nợ</a>
        <a href="/quan-ly/kho/cong-no-ncc?all=1" className={`rounded-full px-3 py-1.5 font-semibold ${showAll ? "bg-navy text-white" : "bg-white text-navy"}`}>Tất cả</a>
      </div>

      {list.length === 0 && <p className="card text-sm text-ink/60">Không còn nợ nhà cung cấp nào.</p>}

      {list.map((g) => (
        <div key={g.name} className="card space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-semibold text-navy">{g.name}</h2>
            <div className="text-right">
              <p className="text-xs text-ink/60">Tổng dư nợ</p>
              <p className={`font-bold ${g.debt > 0 ? "text-[#8A2323]" : "text-[#22612A]"}`}>{formatVnd(g.debt)}</p>
            </div>
          </div>
          {g.rows
            .filter((r) => showAll || r.payable - r.paid > 0)
            .map((r) => {
              const owe = r.payable - r.paid;
              return (
                <div key={r.receipt_id} className="rounded-xl border border-beige-dark p-3 text-sm">
                  <p className="font-medium">
                    {r.code} · {r.warehouse}
                    <span className="ml-1 text-xs font-normal text-ink/55">{d(r.approved_at ?? r.created_at)}</span>
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <dt className="text-ink/60">Tổng đơn</dt>
                    <dd className="text-right">{formatVnd(r.goods_total + r.extra_cost_total)}</dd>
                    <dt className="text-ink/60">Cần trả NCC (tiền hàng)</dt>
                    <dd className="text-right">{formatVnd(r.payable)}</dd>
                    <dt className="text-ink/60">Đã trả NCC</dt>
                    <dd className="text-right">{formatVnd(r.paid)}</dd>
                    <dt className="font-semibold">Còn nợ</dt>
                    <dd className={`text-right font-semibold ${owe > 0 ? "text-[#8A2323]" : "text-[#22612A]"}`}>{formatVnd(owe)}</dd>
                  </dl>
                  {r.payments.length > 0 && (
                    <ul className="mt-2 space-y-0.5 border-t border-beige pt-2 text-xs text-ink/60">
                      {r.payments.map((p, k) => (
                        <li key={k}>
                          {d(p.paid_on)} · {formatVnd(Number(p.amount))}
                          {p.note ? ` · ${p.note}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                  {owe > 0 && <PayButton receiptId={r.receipt_id} owe={owe} />}
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}
