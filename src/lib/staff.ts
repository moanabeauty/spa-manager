// Dùng chung cho các trang quản lý (lễ tân / chủ spa)
// Kiểu tối giản cho client Supabase (dùng được cả ở server lẫn trình duyệt)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };

export type Technician = { id: string; full_name: string | null; role: string; branch_id: string | null };
/** Khoảng thời gian KTV đã bận (để đánh dấu "bận" khi chọn) */
export type Busy = { id: string; technician_id: string; start_at: string; end_at: string };

type StaffRow = { id: string; full_name: string | null; role: string; branch_id: string | null; extra_roles: string[] | null };

/** Chọn vai trò đại diện của một người (ưu tiên theo thứ tự trong `order`), tính cả vai trò kiêm nhiệm */
function pickRole(r: StaffRow, order: Record<string, number>): string {
  return [r.role, ...(r.extra_roles ?? [])]
    .filter((x) => x in order)
    .sort((a, b) => order[a] - order[b])[0] ?? r.role;
}

export async function fetchTechnicians(supabase: Db): Promise<Technician[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, role, branch_id, extra_roles")
    .or("role.in.(technician,manager,owner),extra_roles.ov.{technician,manager}")
    .eq("is_active", true)
    .order("full_name");
  const order: Record<string, number> = { technician: 0, manager: 1, owner: 2 };
  return ((data ?? []) as StaffRow[])
    .map((r) => ({ id: r.id, full_name: r.full_name, branch_id: r.branch_id, role: pickRole(r, order) }))
    .sort((a, b) => order[a.role] - order[b.role]);
}

export async function fetchBusy(supabase: Db, fromIso: string, toIso: string): Promise<Busy[]> {
  const { data } = await supabase
    .from("appointment_services")
    .select("id, technician_id, start_at, end_at")
    .eq("is_active", true)
    .not("technician_id", "is", null)
    .lt("start_at", toIso)
    .gt("end_at", fromIso);
  return (data ?? []) as Busy[];
}

export function isBusy(busy: Busy[], techId: string, start: string, end: string, ignoreId?: string): boolean {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return busy.some(
    (b) =>
      b.technician_id === techId &&
      b.id !== ignoreId &&
      new Date(b.start_at).getTime() < e &&
      new Date(b.end_at).getTime() > s,
  );
}

export function techLabel(t: Technician, branches: { id: string; name: string }[]): string {
  const extra = t.role === "owner" ? "chủ" : t.role === "manager" ? "quản lý" : branches.find((b) => b.id === t.branch_id)?.name.replace("Moana ", "");
  return `${t.full_name ?? "(chưa có tên)"}${extra ? ` · ${extra}` : ""}`;
}

export type Seller = { id: string; full_name: string | null; role: string; branch_id: string | null };

/** Nhân viên được chia doanh số (KTV, lễ tân, quản lý, chủ) */
export async function fetchSellers(supabase: Db): Promise<Seller[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, role, branch_id, extra_roles")
    .or("role.in.(technician,receptionist,manager,owner),extra_roles.ov.{technician,receptionist,manager}")
    .eq("is_active", true)
    .order("full_name");
  const order: Record<string, number> = { technician: 0, receptionist: 1, manager: 2, owner: 3 };
  return ((data ?? []) as StaffRow[])
    .map((r) => ({ id: r.id, full_name: r.full_name, branch_id: r.branch_id, role: pickRole(r, order) }))
    .sort((a, b) => order[a.role] - order[b.role]);
}

/** Vai trò được thu tiền (khớp hàm checkout_invoice) */
export function canCheckout(role: string | null | undefined): boolean {
  return role === "owner" || role === "manager" || role === "receptionist" || role === "technician";
}
