// Dùng chung cho các trang Kho + bán lẻ ở Thu tiền
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };

export type WarehouseType = "treatment" | "retail";

export const WAREHOUSE_LABEL: Record<WarehouseType, string> = {
  treatment: "Kho liệu trình",
  retail: "Kho bán lẻ",
};

export const MOVEMENT_LABEL: Record<string, string> = {
  import: "Nhập hàng",
  export_use: "Xuất làm liệu trình",
  export_sale: "Bán lẻ",
  transfer_in: "Chuyển đến",
  transfer_out: "Chuyển đi",
  adjustment: "Điều chỉnh",
};

export const REQUEST_STATUS_LABEL: Record<string, string> = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt – đã xuất",
  rejected: "Từ chối",
  cancelled: "Đã huỷ",
};
export const REQUEST_STATUS_STYLE: Record<string, string> = {
  pending: "bg-[#FFE8BA] text-[#7A5600]",
  approved: "bg-[#D6EDD8] text-[#22612A]",
  rejected: "bg-[#F6D5D5] text-[#8A2323]",
  cancelled: "bg-[#ECECEC] text-[#666]",
};

export const UNITS = ["chai", "hộp", "lọ", "ống", "tuýp", "hũ", "túi", "gói", "miếng", "set", "bộ", "cái"];

/** Cột sản phẩm mọi nhân viên đọc được (không có giá nhập) */
export const PRODUCT_COLUMNS =
  "id, name, brand, capacity, volume, unit, barcode, category, used_in, retail_price, for_treatment, for_retail, max_staff_discount_pct, min_stock, note, is_active";

export type Product = {
  id: string;
  name: string;
  brand: string | null;
  capacity: string | null;
  volume: number | null;
  unit: string;
  barcode: string | null;
  category: string | null;
  used_in: string | null;
  retail_price: number | null;
  for_treatment: boolean;
  for_retail: boolean;
  max_staff_discount_pct: number | null;
  min_stock: number;
  note: string | null;
  is_active: boolean;
};

export type Warehouse = { id: string; branch_id: string; type: WarehouseType; name: string };

/** "BR Lotion P50 · 500ml" */
export function productLabel(p: Pick<Product, "name" | "capacity">): string {
  return p.capacity && !p.name.toLowerCase().includes(p.capacity.toLowerCase()) ? `${p.name} · ${p.capacity}` : p.name;
}

/** Bỏ khoảng trắng trong mã vạch (giống cơ sở dữ liệu) */
export function cleanBarcode(s: string): string {
  return s.replace(/\s/g, "");
}

/** Giá bán lẻ thấp nhất nhân viên được bán — giống hàm retail_min_price */
export function retailMinPrice(list: number, productPct: number | null, defaultPct: number): number {
  const pct = Math.min(100, Math.max(0, productPct ?? defaultPct ?? 0));
  return Math.round((list * (100 - pct)) / 100);
}

export async function fetchDefaultDiscountPct(supabase: Db): Promise<number> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "retail_staff_max_discount_pct")
    .maybeSingle();
  const n = Number(data?.value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Tồn kho theo kho: Map productId -> số lượng */
export async function fetchStock(supabase: Db, warehouseIds: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  warehouseIds.forEach((w) => out.set(w, new Map()));
  if (warehouseIds.length === 0) return out;
  const { data } = await supabase
    .from("stock_levels")
    .select("warehouse_id, product_id, quantity")
    .in("warehouse_id", warehouseIds);
  ((data ?? []) as { warehouse_id: string; product_id: string; quantity: number }[]).forEach((r) =>
    out.get(r.warehouse_id)?.set(r.product_id, Number(r.quantity)),
  );
  return out;
}

/** Chủ / quản lý: mọi chi nhánh; quản lý kho: chi nhánh của mình */
export function canManageStock(role: string | null | undefined): boolean {
  return role === "owner" || role === "manager" || role === "warehouse";
}
