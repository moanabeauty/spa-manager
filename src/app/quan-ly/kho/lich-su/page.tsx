import { activeBranches } from "@/lib/refData";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatTime } from "@/lib/format";
import { MOVEMENT_LABEL, WAREHOUSE_LABEL, type Warehouse, type WarehouseType } from "@/lib/inventory";
import { KhoNav, pickBranch } from "../shared";

export const metadata = { title: "Lịch sử kho – Moana Beauty" };

type Move = {
  id: string;
  movement_type: string;
  quantity: number;
  note: string | null;
  created_at: string;
  warehouse_id: string;
  products: { name: string; capacity: string | null; unit: string } | null;
  profiles: { full_name: string | null } | null;
};

export default async function StockHistoryPage({ searchParams }: { searchParams: Promise<{ cn?: string; kho?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  const sp = await searchParams;
  const type: WarehouseType = sp.kho === "retail" ? "retail" : "treatment";
  const { data: branches } = await activeBranches();
  const { branchId, canSwitch } = pickBranch(profile, branches ?? [], sp.cn);
  const { data: whs } = await supabase.from("warehouses").select("id, branch_id, type, name").eq("branch_id", branchId).eq("type", type);
  const wh = ((whs ?? []) as Warehouse[])[0];

  const { data } = wh
    ? await supabase
        .from("stock_movements")
        .select("id, movement_type, quantity, note, created_at, warehouse_id, products(name, capacity, unit), profiles(full_name)")
        .eq("warehouse_id", wh.id)
        .order("created_at", { ascending: false })
        .limit(200)
    : { data: [] };
  const rows = (data ?? []) as unknown as Move[];
  const link = (cn: string, kho: WarehouseType) => `/quan-ly/kho/lich-su?cn=${cn}&kho=${kho}`;

  // nhóm theo ngày
  const days = new Map<string, Move[]>();
  rows.forEach((m) => {
    const d = new Date(m.created_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
    days.set(d, [...(days.get(d) ?? []), m]);
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Lịch sử nhập / xuất</h1>
        <p className="text-sm text-ink/70">200 lần gần nhất: nhập hàng, xuất làm liệu trình, bán lẻ, kiểm kê.</p>
      </div>
      <KhoNav active="ls" role={profile!.role} />
      <div className="card space-y-3 p-4">
        {canSwitch && (
          <div className="flex flex-wrap gap-2">
            {(branches ?? []).map((b) => (
              <Link key={b.id} href={link(b.id, type)} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${b.id === branchId ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}>
                {b.name}
              </Link>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          {(["treatment", "retail"] as const).map((t) => (
            <Link key={t} href={link(branchId, t)} className={`flex-1 rounded-xl px-3 py-2 text-center text-sm font-semibold ${t === type ? "bg-beige text-navy ring-2 ring-navy/30" : "bg-cream text-navy/70"}`}>
              {WAREHOUSE_LABEL[t]}
            </Link>
          ))}
        </div>
      </div>

      {rows.length === 0 && <p className="card text-sm text-ink/60">Chưa có lần nhập / xuất nào.</p>}
      {[...days.entries()].map(([d, ms]) => (
        <div key={d} className="card p-0">
          <p className="border-b border-beige px-4 py-2 text-xs font-bold capitalize text-brown">{d}</p>
          <ul className="divide-y divide-beige text-sm">
            {ms.map((m) => (
              <li key={m.id} className="flex justify-between gap-3 px-4 py-2">
                <span className="min-w-0">
                  {m.products?.name}
                  {m.products?.capacity ? ` · ${m.products.capacity}` : ""}
                  <span className="block text-xs text-ink/55">
                    {formatTime(m.created_at)} · {MOVEMENT_LABEL[m.movement_type] ?? m.movement_type}
                    {m.profiles?.full_name ? ` · ${m.profiles.full_name}` : ""}
                    {m.note ? ` · ${m.note}` : ""}
                  </span>
                </span>
                <b className={`shrink-0 ${m.quantity > 0 ? "text-[#22612A]" : "text-[#8A2323]"}`}>
                  {m.quantity > 0 ? "+" : ""}
                  {m.quantity} {m.products?.unit}
                </b>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
