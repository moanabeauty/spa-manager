import { normalizePhone } from "./format";

/** Ô tìm khách: gõ tên, mã khách Moana (M0085 / M00418) hoặc SĐT */
export const CUSTOMER_SEARCH_HINT = "Gõ tên, mã khách (M…) hoặc SĐT…";

/** Đủ ký tự để bắt đầu tìm chưa (SĐT ≥ 4 số, tên / mã ≥ 2 ký tự) */
export function customerQueryReady(q: string): boolean {
  const t = q.trim();
  if (/^[\d\s.+-]+$/.test(t)) return t.replace(/\D/g, "").length >= 2;
  return t.length >= 2;
}

/**
 * Tự chọn khách khi chắc chắn đúng người:
 * - gõ đủ, đúng y mã khách (M0085 / M00418), hoặc
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
  // mã khách Moana: chỉ tự chọn khi gõ ĐỦ, đúng y mã (M0085) – gõ dở "M008" không tự chọn
  if (/^[ML]\d{4,6}$/.test(code)) return list.find((c) => (c.code ?? "").toUpperCase() === code);
  if (/^[\d\s.+-]+$/.test(t)) {
    const d = normalizePhone(t);
    if (d.length >= 10) {
      const hits = list.filter((c) => c.phone && normalizePhone(c.phone) === d);
      if (hits.length === 1) return hits[0];
    }
    return undefined;
  }
  if (/^[ML]\d*$/i.test(code)) return undefined; // đang gõ dở mã khách
  if (opts.byName !== false && list.length === 1 && t.length >= 4) return list[0];
  return undefined;
}
