// Dùng chung cho các trang quản lý (lễ tân / chủ spa)
// Kiểu tối giản cho client Supabase (dùng được cả ở server lẫn trình duyệt)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };

export type Technician = { id: string; full_name: string | null; role: string; branch_id: string | null };
/** Khoảng thời gian KTV đã bận (để đánh dấu "bận" khi chọn) */
export type Busy = { id: string; technician_id: string; start_at: string; end_at: string };

export async function fetchTechnicians(supabase: Db): Promise<Technician[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, role, branch_id")
    .in("role", ["technician", "manager", "owner"])
    .eq("is_active", true)
    .order("full_name");
  const order: Record<string, number> = { technician: 0, manager: 1, owner: 2 };
  return ((data ?? []) as Technician[]).sort((a, b) => order[a.role] - order[b.role]);
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
