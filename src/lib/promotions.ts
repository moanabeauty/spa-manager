// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any; rpc: (...args: any[]) => any };
import { todayVn } from "./format";

export type PromoItem = {
  id: string;
  item_type: "service" | "package" | "product";
  service_id: string | null;
  package_id: string | null;
  product_id: string | null;
  label: string;
  list_price: number | null;
  promo_price: number;
  quantity: number;
  sort_order: number;
};

export type Promotion = {
  id: string;
  name: string;
  description: string | null;
  terms: string | null;
  kind: "discount" | "package" | "first_visit" | "gift";
  start_date: string | null;
  end_date: string | null;
  redeem_until: string | null;
  branch_id: string | null;
  new_customers_only: boolean;
  max_slots: number | null;
  per_customer_limit: number;
  show_online: boolean;
  is_active: boolean;
  created_at: string;
  promotion_items: PromoItem[];
};

export const PROMO_SELECT =
  "id, name, description, terms, kind, start_date, end_date, redeem_until, branch_id, new_customers_only, max_slots, per_customer_limit, show_online, is_active, created_at, promotion_items(id, item_type, service_id, package_id, product_id, label, list_price, promo_price, quantity, sort_order)";

export const KIND_LABEL: Record<Promotion["kind"], string> = {
  discount: "Giảm giá dịch vụ",
  package: "Gói giá ưu đãi",
  first_visit: "Trải nghiệm lần đầu",
  gift: "Mua kèm tặng",
};

export const REG_STATUS_LABEL: Record<string, string> = {
  pending: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  used: "Đã dùng",
  cancelled: "Đã huỷ",
};
export const REG_STATUS_STYLE: Record<string, string> = {
  pending: "bg-[#FFE8BA] text-[#7A5600]",
  confirmed: "bg-[#DCE3F5] text-navy",
  used: "bg-[#D6EDD8] text-[#22612A]",
  cancelled: "bg-[#ECECEC] text-[#666]",
};

export function sortedItems(p: { promotion_items: PromoItem[] }) {
  return [...p.promotion_items].sort((a, b) => a.sort_order - b.sort_order);
}

/** Đang trong thời gian nhận đăng ký */
export function isOpen(p: Promotion, today = todayVn()): boolean {
  if (!p.is_active) return false;
  if (p.start_date && today < p.start_date) return false;
  if (p.end_date && today > p.end_date) return false;
  return true;
}

/** Ngày cuối được dùng ưu đãi (null = không hạn) */
export function redeemDeadline(p: Pick<Promotion, "redeem_until" | "end_date">): string | null {
  return p.redeem_until ?? p.end_date;
}

export function canRedeem(p: Pick<Promotion, "redeem_until" | "end_date">, today = todayVn()): boolean {
  const d = redeemDeadline(p);
  return !d || today <= d;
}

/** "2026-11-30" -> "30/11/2026" */
export function dmy(d: string | null): string {
  if (!d) return "";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
}

/** Tổng giá niêm yết / tổng giá KM của chương trình */
export function promoTotals(p: { promotion_items: PromoItem[] }) {
  let list = 0;
  let promo = 0;
  let listKnown = true;
  for (const i of p.promotion_items) {
    promo += Number(i.promo_price) * i.quantity;
    if (i.list_price === null) listKnown = false;
    else list += Number(i.list_price) * i.quantity;
  }
  return { list: listKnown ? list : null, promo };
}

export async function fetchTakenCounts(supabase: Db): Promise<Map<string, number>> {
  const { data } = await supabase.rpc("promotion_taken_counts");
  return new Map(((data ?? []) as { promotion_id: string; taken: number }[]).map((r) => [r.promotion_id, Number(r.taken)]));
}

export function periodText(p: Pick<Promotion, "start_date" | "end_date">): string {
  if (p.start_date && p.end_date) return `${dmy(p.start_date)} – ${dmy(p.end_date)}`;
  if (p.end_date) return `đến hết ${dmy(p.end_date)}`;
  if (p.start_date) return `từ ${dmy(p.start_date)}`;
  return "không giới hạn thời gian";
}

/** Ưu đãi khách đã đăng ký và được xác nhận, còn hạn dùng (dùng ở màn hình Thu tiền) */
export type CustomerPromo = {
  regId: string;
  promotionId: string;
  name: string;
  branch_id: string | null;
  deadline: string | null;
  items: PromoItem[];
};

export async function fetchCustomerPromos(supabase: Db, customerId: string): Promise<CustomerPromo[]> {
  const { data } = await supabase
    .from("promotion_registrations")
    .select(
      "id, promotions(id, name, branch_id, end_date, redeem_until, promotion_items(id, item_type, service_id, package_id, product_id, label, list_price, promo_price, quantity, sort_order))",
    )
    .eq("customer_id", customerId)
    .eq("status", "confirmed")
    .order("created_at");
  type R = {
    id: string;
    promotions: { id: string; name: string; branch_id: string | null; end_date: string | null; redeem_until: string | null; promotion_items: PromoItem[] } | null;
  };
  return ((data ?? []) as unknown as R[])
    .filter((r) => r.promotions && canRedeem(r.promotions))
    .map((r) => ({
      regId: r.id,
      promotionId: r.promotions!.id,
      name: r.promotions!.name,
      branch_id: r.promotions!.branch_id,
      deadline: redeemDeadline(r.promotions!),
      items: sortedItems(r.promotions!),
    }));
}
