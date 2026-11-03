// Dùng chung cho các trang báo cáo (doanh thu, gói & thẻ, bảng lương, thu chi)

/** "2026-11" + 1 -> "2026-12" */
export function shiftMonth(m: string, d: number): string {
  const [y, mo] = m.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + d, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Ngày cuối tháng: "2026-02" -> "2026-02-28" */
export function monthEnd(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo, 0));
  return `${m}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

export function isDate(s: string | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function isMonth(s: string | undefined): s is string {
  return !!s && /^\d{4}-\d{2}$/.test(s);
}

/** "2026-11-03" -> "03/11"; "2026-11" -> "11/2026" */
export function shortLabel(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s.slice(5, 7)}/${s.slice(0, 4)}`;
  return s;
}

/** 3.500.000 -> "3,5tr"; 850.000 -> "850k" (cho ô nhỏ) */
export function compactVnd(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e9) return `${sign}${(a / 1e9).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} tỷ`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}tr`;
  if (a >= 1e3) return `${sign}${Math.round(a / 1e3)}k`;
  return `${sign}${a}đ`;
}

export function pctText(part: number, whole: number): string {
  if (!whole) return "–";
  return `${(Math.round((part / whole) * 1000) / 10).toLocaleString("vi-VN")}%`;
}

export const CASH_METHOD_LABEL: Record<string, string> = {
  cash: "Tiền mặt",
  bank_transfer: "Chuyển khoản",
  pos: "Quẹt thẻ POS",
  other: "Khác",
};
