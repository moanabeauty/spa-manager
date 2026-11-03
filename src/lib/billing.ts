// Dùng chung cho thu tiền, khách hàng, hoá đơn
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };

export const METHOD_LABEL: Record<string, string> = {
  cash: "Tiền mặt",
  bank_transfer: "Chuyển khoản",
  pos: "Quẹt thẻ POS",
  service_card: "Thẻ tài khoản",
};

export const ITEM_TYPE_LABEL: Record<string, string> = {
  service: "Dịch vụ",
  package: "Gói combo",
  card_topup: "Nạp thẻ",
  product: "Sản phẩm",
};

export const CARD_TXN_LABEL: Record<string, string> = {
  topup: "Nạp tiền",
  bonus: "Tiền tặng",
  charge: "Thanh toán",
  refund: "Hoàn tiền",
  adjustment: "Điều chỉnh",
};

export type WalletItem = {
  id: string;
  label: string;
  total_qty: number | null; // null = không giới hạn
  used_qty: number;
  services: { id: string; name: string }[];
};
export type WalletPackage = {
  id: string;
  name: string;
  purchased_at: string;
  expires_at: string | null;
  is_active: boolean;
  items: WalletItem[];
};
export type Wallet = {
  cards: { card_id: string; code: string; balance: number }[];
  packages: WalletPackage[];
};

export function itemLeft(i: WalletItem): number {
  return i.total_qty === null ? Infinity : i.total_qty - i.used_qty;
}
export function itemText(i: WalletItem): string {
  return i.total_qty === null ? `đã dùng ${i.used_qty} buổi (không giới hạn)` : `còn ${i.total_qty - i.used_qty}/${i.total_qty} buổi`;
}

export function cardBalance(w: Wallet): number {
  return w.cards.reduce((a, c) => a + Number(c.balance), 0);
}

/** Gói còn dùng được (đang hoạt động, chưa hết hạn) */
export function isPackageUsable(p: WalletPackage, at = new Date()): boolean {
  return p.is_active && (!p.expires_at || new Date(p.expires_at) >= at);
}

export async function fetchWallet(supabase: Db, customerId: string): Promise<Wallet> {
  const [{ data: cards }, { data: active }, { data: pkgs }] = await Promise.all([
    supabase.from("service_card_balances").select("card_id, code, balance").eq("customer_id", customerId),
    supabase.from("service_cards").select("id").eq("customer_id", customerId).eq("is_active", true),
    supabase
      .from("customer_packages")
      .select(
        "id, purchased_at, expires_at, is_active, packages(name), customer_package_items(id, label, total_qty, used_qty, sort_order, customer_package_item_services(service_id, services(name)))",
      )
      .eq("customer_id", customerId)
      .order("purchased_at", { ascending: false }),
  ]);
  type P = {
    id: string;
    purchased_at: string;
    expires_at: string | null;
    is_active: boolean;
    packages: { name: string } | null;
    customer_package_items: {
      id: string;
      label: string;
      total_qty: number | null;
      used_qty: number;
      sort_order: number;
      customer_package_item_services: { service_id: string; services: { name: string } | null }[];
    }[];
  };
  return {
    cards: ((cards ?? []) as Wallet["cards"])
      .filter((c) => ((active ?? []) as { id: string }[]).some((x) => x.id === c.card_id))
      .map((c) => ({ ...c, balance: Number(c.balance) })),
    packages: ((pkgs ?? []) as P[]).map((p) => ({
      id: p.id,
      name: p.packages?.name ?? "Gói",
      purchased_at: p.purchased_at,
      expires_at: p.expires_at,
      is_active: p.is_active,
      items: [...p.customer_package_items]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((i) => ({
          id: i.id,
          label: i.label,
          total_qty: i.total_qty,
          used_qty: i.used_qty,
          services: i.customer_package_item_services.map((x) => ({ id: x.service_id, name: x.services?.name ?? "" })),
        })),
    })),
  };
}

/**
 * Chia giảm giá cả hoá đơn vào các dòng — giống hệt hàm checkout_invoice trong cơ sở dữ liệu:
 * theo tỉ lệ số tiền, đúng thứ tự dòng, dòng cuối nhận phần lẻ. Dòng không đủ điều kiện truyền eligible = false.
 */
export function allocateDiscount(amounts: { amount: number; eligible: boolean }[], discount: number): number[] {
  const out = amounts.map(() => 0);
  const d = Math.round(discount);
  if (d <= 0) return out;
  const idx = amounts.map((a, i) => (a.eligible && a.amount > 0 ? i : -1)).filter((i) => i >= 0);
  const total = idx.reduce((s, i) => s + amounts[i].amount, 0);
  if (total <= 0) return out;
  let left = d;
  idx.forEach((i, k) => {
    const v = k === idx.length - 1 ? left : Math.min(amounts[i].amount, Math.round((d * amounts[i].amount) / total));
    out[i] = v;
    left -= v;
  });
  return out;
}

/** Quy tỉ lệ chia doanh số ra tiền — giống cơ sở dữ liệu (người cuối nhận phần lẻ) */
export function splitByShares(amount: number, shares: number[]): number[] {
  const sum = shares.reduce((a, b) => a + b, 0);
  if (sum <= 0) return shares.map(() => 0);
  let left = amount;
  return shares.map((s, k) => {
    const v = k === shares.length - 1 ? left : Math.round((amount * s) / sum);
    left -= v;
    return v;
  });
}

/** "1.500.000" / "1500k" / "1,5tr" -> 1500000 */
export function parseVnd(s: string): number {
  const t = s.trim().toLowerCase().replace(/\s/g, "");
  if (!t) return 0;
  const m = t.match(/^([\d.,]+)(k|tr|m)?$/);
  if (!m) return NaN;
  let num = m[1];
  if (m[2]) num = num.replace(",", ".");
  else num = num.replace(/[.,]/g, "");
  const n = Number(num);
  if (Number.isNaN(n)) return NaN;
  const mul = m[2] === "k" ? 1000 : m[2] === "tr" || m[2] === "m" ? 1000000 : 1;
  return Math.round(n * mul);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("vi-VN").format(n);
}
