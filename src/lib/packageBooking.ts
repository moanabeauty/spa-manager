// Đặt lịch theo gói khách đang có: lấy các phần gói còn dùng được và chọn phương án hợp lý nhất cho khách
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { rpc: (fn: string, args?: Record<string, unknown>) => any };

export type PackageOption = {
  item_id: string;
  customer_package_id: string;
  package_name: string;
  label: string;
  total_qty: number | null;
  used_qty: number;
  reserved: number; // buổi đã giữ cho lịch đặt trước chưa làm
  left_qty: number | null; // null = không giới hạn
  expires_at: string | null;
  staff_choice: boolean; // KTV chọn loại cụ thể tại spa (khách không thấy danh sách)
  service_ids: string[];
  sort_order: number;
};

export async function fetchPackageOptions(supabase: Db, customerId: string, excludeAppt?: string): Promise<PackageOption[]> {
  const { data } = await supabase.rpc("package_options", { p_customer: customerId, p_exclude_appt: excludeAppt ?? null });
  return ((data ?? []) as PackageOption[]).map((o) => ({ ...o, service_ids: o.service_ids ?? [] }));
}

/** số buổi còn lại sau khi trừ các dòng đang chọn trong form (Infinity = không giới hạn) */
export function partLeft(o: PackageOption, usedInForm: number): number {
  return o.left_qty === null ? Infinity : o.left_qty - usedInForm;
}

export function partName(o: PackageOption): string {
  return o.label && o.label !== o.package_name ? `${o.package_name} – ${o.label}` : o.package_name;
}

export function partLeftText(o: PackageOption, usedInForm = 0): string {
  const left = partLeft(o, usedInForm);
  return left === Infinity ? "không giới hạn" : `còn ${Math.max(left, 0)}/${o.total_qty} buổi`;
}

function expiryTime(o: PackageOption) {
  return o.expires_at ? new Date(o.expires_at).getTime() : Number.MAX_SAFE_INTEGER;
}

/**
 * Phần gói nên dùng cho 1 dịch vụ, có lợi nhất cho khách:
 * 1. phần không giới hạn (không tốn buổi)
 * 2. gói sắp hết hạn trước (tránh mất buổi)
 * 3. phần ít lựa chọn dịch vụ hơn (giữ lại phần linh hoạt cho lần sau)
 * 4. phần còn ít buổi hơn
 */
export function bestPart(options: PackageOption[], serviceId: string, used: Map<string, number>, skipItem?: string): PackageOption | null {
  const c = options.filter((o) => o.service_ids.includes(serviceId) && o.item_id !== skipItem && partLeft(o, used.get(o.item_id) ?? 0) > 0);
  c.sort(
    (a, b) =>
      Number(b.left_qty === null) - Number(a.left_qty === null) ||
      expiryTime(a) - expiryTime(b) ||
      a.service_ids.length - b.service_ids.length ||
      partLeft(a, used.get(a.item_id) ?? 0) - partLeft(b, used.get(b.item_id) ?? 0),
  );
  return c[0] ?? null;
}

/** đếm số dòng đang dùng mỗi phần gói */
export function usageOf(rows: { partId: string | null }[], exceptIndex?: number): Map<string, number> {
  const m = new Map<string, number>();
  rows.forEach((r, i) => {
    if (r.partId && i !== exceptIndex) m.set(r.partId, (m.get(r.partId) ?? 0) + 1);
  });
  return m;
}

/** phần gói nên dùng trước: hạn gần nhất trong 60 ngày tới, còn buổi */
export function urgentParts(options: PackageOption[], days = 60): PackageOption[] {
  const limit = Date.now() + days * 86400000;
  return options.filter((o) => o.expires_at && new Date(o.expires_at).getTime() < limit && partLeft(o, 0) > 0);
}

export function shortDmy(iso: string) {
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}
