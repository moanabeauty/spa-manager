// SĐT khách không còn đọc trực tiếp từ bảng customers (KTV không được xem).
// Lấy SĐT qua hàm customer_phones: chủ / quản lý / lễ tân thấy, KTV nhận null.
import type { SupabaseClient } from "@supabase/supabase-js";

export function canViewCustomerPhone(role: string | null | undefined): boolean {
  return role === "owner" || role === "manager" || role === "receptionist";
}

type WithPhone = { id: string; phone?: string | null };

/** Gắn SĐT vào các khách (sửa trực tiếp object). Bỏ qua null. */
export async function fillPhones<T extends WithPhone>(supabase: SupabaseClient, list: (T | null | undefined)[]): Promise<void> {
  const items = list.filter((x): x is T => !!x && !!x.id);
  for (const c of items) c.phone = null;
  const ids = [...new Set(items.map((c) => c.id))];
  if (ids.length === 0) return;
  const { data } = await supabase.rpc("customer_phones", { p_ids: ids });
  const map = new Map(((data ?? []) as { id: string; phone: string | null }[]).map((r) => [r.id, r.phone]));
  for (const c of items) c.phone = map.get(c.id) ?? null;
}
