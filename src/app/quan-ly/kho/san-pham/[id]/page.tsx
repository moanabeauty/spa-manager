import Link from "next/link";
import { getCurrentUser, isStaffRole } from "@/lib/supabase/server";
import { formatShortDate, formatVnd, todayVn } from "@/lib/format";
import {
  MOVEMENT_LABEL, PRODUCT_COLUMNS, WAREHOUSE_LABEL, canManageStock, fetchDefaultDiscountPct, productLabel, retailMinPrice,
  type Product, type Warehouse,
} from "@/lib/inventory";
import ProductEdit from "./ProductEdit";

export const metadata = { title: "Chi tiết sản phẩm – Moana Beauty" };

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await getCurrentUser();
  if (!isStaffRole(profile?.role)) return <p className="card text-sm">Trang dành cho nhân viên.</p>;
  const canEdit = canManageStock(profile?.role);
  const [{ data }, { data: whs }, { data: branches }, { data: levels }, { data: moves }, pct] = await Promise.all([
    supabase.from("products").select(PRODUCT_COLUMNS).eq("id", id).maybeSingle(),
    supabase.from("warehouses").select("id, branch_id, type, name"),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    supabase.from("stock_levels").select("warehouse_id, quantity").eq("product_id", id),
    supabase.from("stock_movements").select("id, warehouse_id, movement_type, quantity, note, created_at").eq("product_id", id)
      .order("created_at", { ascending: false }).limit(30),
    fetchDefaultDiscountPct(supabase),
  ]);
  if (!data) return <p className="card text-sm">Không tìm thấy sản phẩm.</p>;
  const p = data as Product;
  let cost: number | null = null;
  if (canEdit) {
    const { data: costs } = await supabase.rpc("product_costs");
    cost = ((costs ?? []) as { product_id: string; cost_price: number | null }[]).find((c) => c.product_id === id)?.cost_price ?? null;
  }
  const warehouses = (whs ?? []) as Warehouse[];
  const qty = new Map(((levels ?? []) as { warehouse_id: string; quantity: number }[]).map((l) => [l.warehouse_id, Number(l.quantity)]));
  const whName = (wid: string) => warehouses.find((w) => w.id === wid)?.name ?? "";
  const today = todayVn();
  const expired = p.expiry_date && p.expiry_date < today;
  const expSoon = p.expiry_date && !expired && p.expiry_date <= todayVn(60);

  const info: [string, React.ReactNode][] = [
    ["Nhãn hàng", p.brand ?? "—"],
    ["Tên", p.name],
    ["Dung tích / quy cách", p.capacity ?? "—"],
    ["Mã sản phẩm", p.sku ?? "—"],
    ["Mã vạch", p.barcode ? <span className="font-mono">{p.barcode}</span> : <span className="text-[#7A5600]">chưa có</span>],
    ["Hạn sử dụng", p.expiry_date ? (
      <span className={expired ? "font-semibold text-[#8A2323]" : expSoon ? "font-semibold text-[#7A5600]" : ""}>
        {formatShortDate(`${p.expiry_date}T12:00:00+07:00`)}/{p.expiry_date.slice(0, 4)}{expired ? " · đã hết hạn" : expSoon ? " · sắp hết hạn" : ""}
      </span>
    ) : "—"],
    ["Nhóm", p.category ?? "—"],
    ["Đơn vị đếm", p.unit],
    ["Dùng cho", [p.for_treatment && "liệu trình", p.for_retail && "bán lẻ"].filter(Boolean).join(" + ") || "—"],
    ["Dùng trong liệu trình", p.used_in ?? "—"],
    ["Giá niêm yết", p.retail_price != null ? formatVnd(p.retail_price) : "—"],
    ...(p.retail_price != null && p.for_retail
      ? [["Bán thấp nhất (NV)", formatVnd(retailMinPrice(Number(p.retail_price), p.max_staff_discount_pct, pct))] as [string, React.ReactNode]]
      : []),
    ...(canEdit ? [["Giá nhập", cost != null ? formatVnd(cost) : "—"] as [string, React.ReactNode]] : []),
    ["Báo sắp hết khi còn ≤", String(p.min_stock)],
    ["Trạng thái", p.is_active ? "Đang dùng" : "Ngừng dùng"],
    ...(p.note ? [["Ghi chú", p.note] as [string, React.ReactNode]] : []),
  ];

  return (
    <div className="space-y-4">
      <Link href="/quan-ly/kho/san-pham" className="text-sm font-semibold text-navy">← Danh sách sản phẩm</Link>
      <div>
        <h1 className="text-2xl font-bold text-navy">{productLabel(p)}</h1>
        {p.brand && <p className="text-sm text-ink/70">{p.brand}</p>}
      </div>

      <div className="card p-0">
        <dl className="divide-y divide-beige text-sm">
          {info.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 px-4 py-2">
              <dt className="text-ink/60">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {canEdit && <ProductEdit product={p} cost={cost} defaultPct={pct} />}

      <div className="card p-0">
        <p className="px-4 pt-3 text-sm font-semibold text-navy">Tồn kho</p>
        <table className="w-full text-sm">
          <tbody>
            {(branches ?? []).flatMap((b) =>
              (["treatment", "retail"] as const).map((t) => {
                const w = warehouses.find((x) => x.branch_id === b.id && x.type === t);
                if (!w) return null;
                const q = qty.get(w.id) ?? 0;
                return (
                  <tr key={w.id} className="border-t border-beige">
                    <td className="px-4 py-2">{b.name.replace("Moana ", "")} · {WAREHOUSE_LABEL[t]}</td>
                    <td className={`px-4 py-2 text-right font-semibold ${q <= 0 ? "text-[#8A2323]" : q <= p.min_stock ? "text-[#7A5600]" : "text-navy"}`}>
                      {q} {p.unit}
                    </td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>

      <div className="card p-0">
        <p className="px-4 pt-3 text-sm font-semibold text-navy">Nhập / xuất gần đây</p>
        {(moves ?? []).length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink/60">Chưa có lần nhập / xuất nào.</p>
        ) : (
          <ul className="divide-y divide-beige text-sm">
            {((moves ?? []) as { id: string; warehouse_id: string; movement_type: string; quantity: number; note: string | null; created_at: string }[]).map((m) => (
              <li key={m.id} className="flex justify-between gap-3 px-4 py-2">
                <span className="min-w-0">
                  {MOVEMENT_LABEL[m.movement_type] ?? m.movement_type}
                  <span className="block truncate text-xs text-ink/55">
                    {formatShortDate(m.created_at)} · {whName(m.warehouse_id)}{m.note ? ` · ${m.note}` : ""}
                  </span>
                </span>
                <span className={`shrink-0 font-semibold ${m.quantity > 0 ? "text-[#22612A]" : "text-[#8A2323]"}`}>
                  {m.quantity > 0 ? "+" : ""}{m.quantity}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
