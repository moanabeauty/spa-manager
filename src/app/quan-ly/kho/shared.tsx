import type { Profile } from "@/lib/supabase/server";

/** Các trang con của Kho nay nằm trong thanh mục con của nhóm "Kho" (src/lib/nav.ts) */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function KhoNav(_: { active: string; role: Profile["role"]; pending?: number }) {
  return null;
}

/** Chi nhánh được xem: chủ / quản lý chọn tự do, nhân viên khác cố định chi nhánh của mình */
export function pickBranch(
  profile: Pick<Profile, "role" | "branch_id"> | null,
  branches: { id: string; name: string }[],
  wanted?: string,
): { branchId: string; canSwitch: boolean } {
  const canSwitch = profile?.role === "owner" || profile?.role === "manager" || !profile?.branch_id;
  const branchId = canSwitch
    ? branches.find((b) => b.id === wanted)?.id ?? profile?.branch_id ?? branches[0]?.id ?? ""
    : profile!.branch_id!;
  return { branchId, canSwitch };
}
