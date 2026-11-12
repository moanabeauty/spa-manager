import { activeBranches } from "@/lib/refData";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatShortDate } from "@/lib/format";
import { fmtQty, openLevelLabel, productLabel, volumeUnit } from "@/lib/inventory";
import { pickBranch } from "../shared";
import FinishButton from "./FinishButton";

export const metadata = { title: "Chai đang mở – Moana Beauty" };

type Row = {
  id: string; product_id: string; remaining_pct: number; remaining_qty: number | null; source: "opening" | "request" | "confirm"; status: string;
  opened_at: string; finished_at: string | null; finish_note: string | null;
  products: { name: string; capacity: string | null; brand: string | null; unit: string; volume: number | null } | null;
  opener: { full_name: string | null } | null;
  finisher: { full_name: string | null } | null;
};
const SELECT =
  "id, product_id, remaining_pct, remaining_qty, source, status, opened_at, finished_at, finish_note, products(name, capacity, brand, unit, volume), opener:profiles!opened_items_opened_by_fkey(full_name), finisher:profiles!opened_items_finished_by_fkey(full_name)";

export default async function OpenedPage({ searchParams }: { searchParams: Promise<{ cn?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  if (profile?.role === "marketing") return <p className="card text-sm">Trang dành cho nhân viên làm liệu trình và kho.</p>;
  const sp = await searchParams;
  const { data: branches } = await activeBranches();
  const { branchId, canSwitch } = pickBranch(profile, branches ?? [], sp.cn);
  const { data: wh } = await supabase.from("warehouses").select("id").eq("branch_id", branchId).eq("type", "treatment").maybeSingle();

  const [{ data: openData }, { data: doneData }] = await Promise.all([
    supabase.from("opened_items").select(SELECT).eq("warehouse_id", wh?.id ?? "").eq("status", "open").order("opened_at"),
    supabase.from("opened_items").select(SELECT).eq("warehouse_id", wh?.id ?? "").eq("status", "finished").order("finished_at", { ascending: false }).limit(20),
  ]);
  const open = (openData ?? []) as unknown as Row[];
  const done = (doneData ?? []) as unknown as Row[];
  const groups = new Map<string, Row[]>();
  open.forEach((o) => groups.set(o.product_id, [...(groups.get(o.product_id) ?? []), o]));
  const sorted = [...groups.values()].sort((a, b) => (a[0].products?.name ?? "").localeCompare(b[0].products?.name ?? "", "vi"));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Chai đang mở</h1>
        <p className="text-sm text-ink/70">
          Chai / lọ / hũ… đã xuất khỏi kho liệu trình và đang dùng ở chi nhánh. Mỗi buổi liệu trình KTV bấm Hoàn thành, app tự trừ theo định mức (ml / g…); chai về 0 tự báo hết. Đổ vỡ, hỏng hoặc thực tế đã hết thì bấm <b>Hết chai</b>, rồi gửi{" "}
          <Link href="/quan-ly/kho/xin-xuat" className="font-semibold text-navy underline">Xin xuất</Link> lấy chai mới.
        </p>
      </div>

      {canSwitch && (
        <div className="flex flex-wrap gap-2">
          {(branches ?? []).map((b) => (
            <Link key={b.id} href={`/quan-ly/kho/chai-dang-mo?cn=${b.id}`} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${b.id === branchId ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}>
              {b.name}
            </Link>
          ))}
        </div>
      )}

      <div className="card p-0">
        <ul className="divide-y divide-beige">
          {sorted.map((rows) => {
            const p = rows[0].products;
            const label = p ? productLabel(p) : "?";
            return (
              <li key={rows[0].product_id} className="space-y-1.5 px-4 py-3 text-sm">
                <p>
                  <span className="font-medium">{label}</span>
                  <span className="ml-1 text-xs text-ink/55">{p?.brand ?? ""} · {rows.length} {p?.unit ?? "chai"} đang mở</span>
                </p>
                <ul className="space-y-1">
                  {rows.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-cream/60 px-2 py-1.5 text-xs">
                      <span>
                        🧴 <b>
                          {o.remaining_qty != null
                            ? `Còn ${fmtQty(o.remaining_qty)} ${volumeUnit(p?.capacity, p?.unit)} (${Math.round(Number(o.remaining_pct))}%)`
                            : o.source === "opening" ? `Đầu kỳ còn ${openLevelLabel(Number(o.remaining_pct))}` : "Chai mới"}
                        </b>
                        <span className="text-ink/55">
                          {o.source === "opening" ? " · đầu kỳ" : o.source === "confirm" ? " · chủ spa xác nhận còn hàng" : ""}
                        </span>
                        <span className="text-ink/55"> · mở {formatShortDate(o.opened_at)}{o.opener?.full_name ? ` · ${o.opener.full_name}` : ""}</span>
                      </span>
                      <FinishButton id={o.id} label={label} />
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
          {sorted.length === 0 && (
            <li className="px-4 py-3 text-sm text-ink/60">
              Chưa có chai nào đang mở. Làm <Link href="/quan-ly/kho/kiem-kho?loai=dau-ky" className="font-semibold text-navy underline">Kiểm đầu kỳ</Link> để ghi các chai đang dở.
            </li>
          )}
        </ul>
      </div>

      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold text-navy">Đã dùng hết gần đây</h2>
          <ul className="card divide-y divide-beige p-0 text-xs">
            {done.map((o) => (
              <li key={o.id} className="flex justify-between gap-2 px-4 py-2">
                <span className="min-w-0">
                  {o.products ? productLabel(o.products) : "?"}
                  {o.finish_note && <span className="block text-ink/55">{o.finish_note}</span>}
                </span>
                <span className="shrink-0 text-right text-ink/60">
                  mở {formatShortDate(o.opened_at)} → hết {o.finished_at ? formatShortDate(o.finished_at) : ""}
                  {o.finisher?.full_name && <span className="block">{o.finisher.full_name}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
