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
  "id, name, brand, capacity, volume, unit, barcode, category, used_in, retail_price, for_treatment, for_retail, max_staff_discount_pct, min_stock, note, is_active, sku, expiry_date, deleted_at";

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
  sku: string | null;
  expiry_date: string | null;
  deleted_at?: string | null; // đã xoá mã: ẩn khỏi mọi danh sách, chỉ giữ cho lịch sử
};

export type Warehouse = { id: string; branch_id: string; type: WarehouseType; name: string };

/** "BR Lotion P50 · 500ml" */
export function productLabel(p: Pick<Product, "name" | "capacity">): string {
  return p.capacity && !p.name.toLowerCase().includes(p.capacity.toLowerCase()) ? `${p.name} · ${p.capacity}` : p.name;
}

/** Bỏ khoảng trắng trong mã vạch; mã UPC-A 12 số đổi thành EAN-13 (thêm số 0 đầu) — giống cơ sở dữ liệu */
export function cleanBarcode(s: string): string {
  const c = s.replace(/\s/g, "");
  return /^\d{12}$/.test(c) ? "0" + c : c;
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
/** Có quyền sửa danh mục sản phẩm theo BẤT KỲ vai trò nào (VD: KTV kiêm Kho đang ở giao diện KTV) – khớp quyền dữ liệu has_role */
export function canEditProducts(roles: readonly string[] | null | undefined): boolean {
  return (roles ?? []).some((r) => r === "owner" || r === "manager" || r === "warehouse");
}

export function canManageStock(role: string | null | undefined): boolean {
  return role === "owner" || role === "manager" || role === "warehouse";
}

/** Mức còn của chai đang dở khi kiểm đầu kỳ (ước lượng bằng mắt) */
export const OPEN_LEVELS: { pct: number; label: string }[] = [
  { pct: 75, label: "3/4" },
  { pct: 66.67, label: "2/3" },
  { pct: 50, label: "1/2" },
  { pct: 33.33, label: "1/3" },
  { pct: 25, label: "1/4" },
  { pct: 10, label: "Gần hết" },
];

/** 50 → "1/2", 100 → "Nguyên chai" */
export function openLevelLabel(pct: number): string {
  if (pct >= 100) return "Nguyên chai";
  const hit = OPEN_LEVELS.find((l) => Math.abs(l.pct - pct) < 0.5);
  return hit ? hit.label : `${Math.round(pct)}%`;
}

/** Hàng dùng 1 lần: xuất ra là hết, không thành "chai đang mở" — giống hàm is_single_use_product.
 *  Có dung tích thì theo dung tích (≤ 1 là dùng 1 lần, vd 1 miếng / 1 bộ); chưa có dung tích thì theo đơn vị. */
export function isSingleUse(unit: string | null | undefined, volume?: number | string | null): boolean {
  if (volume != null && volume !== "") return Number(volume) <= 1;
  return ["cái", "miếng", "gói", "ống", "túi"].includes((unit ?? "").toLowerCase());
}

/** Đơn vị dung tích — giống hàm volume_unit: "500ml" → ml, "Hũ 120g" → g, "Hộp 50 cái" → cái */
export function volumeUnit(capacity: string | null | undefined, unit?: string | null): string {
  const c = (capacity ?? "").toLowerCase();
  if (c.includes("ml")) return "ml";
  if (/\d\s*(g|gr|gram)\b/.test(c)) return "g";
  if (c.includes("shot")) return "shot";
  for (const u of ["miếng", "cái", "ống", "lọ"]) if (c.includes(u)) return u;
  return unit ?? "";
}

/** 0.5 → "0,5"; 246 → "246" */
export function fmtQty(n: number | string | null | undefined): string {
  return Number(n ?? 0).toLocaleString("vi-VN", { maximumFractionDigits: 3 });
}

export type OpenedItem = { id: string; product_id: string; remaining_pct: number; source: "opening" | "request"; opened_at: string };

/** Chai đang mở theo sản phẩm của 1 kho liệu trình */
export async function fetchOpened(supabase: Db, warehouseId: string): Promise<Map<string, OpenedItem[]>> {
  const out = new Map<string, OpenedItem[]>();
  if (!warehouseId) return out;
  const { data } = await supabase
    .from("opened_items")
    .select("id, product_id, remaining_pct, source, opened_at")
    .eq("warehouse_id", warehouseId)
    .eq("status", "open")
    .order("opened_at");
  ((data ?? []) as OpenedItem[]).forEach((o) => {
    const l = out.get(o.product_id) ?? [];
    l.push({ ...o, remaining_pct: Number(o.remaining_pct) });
    out.set(o.product_id, l);
  });
  return out;
}
