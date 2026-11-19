import { normalizePhone } from "./format";

/** Ô tìm khách: gõ tên, mã KH (KH00012 / 12) hoặc SĐT */
export const CUSTOMER_SEARCH_HINT = "Gõ tên, mã KH hoặc SĐT…";

/** Đủ ký tự để bắt đầu tìm chưa (SĐT ≥ 4 số, tên / mã ≥ 2 ký tự) */
export function customerQueryReady(q: string): boolean {
  const t = q.trim();
  if (/^[\d\s.+-]+$/.test(t)) return t.replace(/\D/g, "").length >= 2;
  return t.length >= 2;
}

/**
 * Tự chọn khách khi chắc chắn đúng người:
 * - gõ đủ mã KH (KH00012), hoặc
 * - gõ đủ SĐT (≥ 10 số) trùng 1 khách, hoặc
 * - gõ tên (≥ 4 ký tự) chỉ ra đúng 1 khách (tắt ở màn đặt lịch vì có thể đang tạo khách mới trùng tên).
 */
export function autoPickCustomer<T extends { code?: string | null; phone?: string | null }>(
  q: string,
  list: T[],
  opts: { byName?: boolean } = {},
): T | undefined {
  const t = q.trim();
  if (!t || list.length === 0) return undefined;
  const code = t.toUpperCase().replace(/\s/g, "");
  const m = code.match(/^KH(\d{5})$/);
  if (m) return list.find((c) => c.code === code);
  if (/^[\d\s.+-]+$/.test(t)) {
    const d = normalizePhone(t);
    if (d.length >= 10) {
      const hits = list.filter((c) => c.phone && normalizePhone(c.phone) === d);
      if (hits.length === 1) return hits[0];
    }
    return undefined;
  }
  if (/^KH\d*$/i.test(code)) return undefined; // đang gõ dở mã KH
  if (opts.byName !== false && list.length === 1 && t.length >= 4) return list[0];
  return undefined;
}
