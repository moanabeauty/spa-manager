import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";

// cache(): trong 1 lần tải trang, Header + layout + trang dùng chung 1 client (không tạo lại)
export const createClient = cache(async () => {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // gọi từ Server Component: middleware sẽ làm mới phiên đăng nhập
        }
      },
    },
  });
});

/** Người dùng đang đăng nhập (lấy từ phiên) */
export type SessionUser = { id: string; email: string | null; phone: string | null; user_metadata: Record<string, unknown> };

export type Role = "owner" | "manager" | "receptionist" | "technician" | "warehouse" | "marketing" | "customer";

export type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  /** vai trò ĐANG DÙNG (người kiêm nhiều vai trò có thể chuyển) – khớp hàm my_role() */
  role: Role;
  /** vai trò chính (tính lương, mặc định) */
  primary_role: Role;
  /** tất cả vai trò: vai trò chính + kiêm nhiệm */
  roles: Role[];
  branch_id: string | null;
};

/** Người dùng đang đăng nhập + hồ sơ (null nếu chưa đăng nhập).
 *  Bọc cache(): Header, layout và trang gọi cùng lúc nhưng chỉ hỏi Supabase 1 lần mỗi lần tải trang. */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  // getClaims(): kiểm tra phiên đăng nhập ngay trên máy chủ, không phải gọi thêm 1 lượt sang Supabase
  // như getUser() (middleware đã làm mới phiên trước đó)
  const { data: claimData } = await supabase.auth.getClaims();
  const c = claimData?.claims as
    | { sub?: string; email?: string; phone?: string; user_metadata?: Record<string, unknown> }
    | undefined;
  const user: SessionUser | null = c?.sub
    ? { id: c.sub, email: c.email || null, phone: c.phone || null, user_metadata: c.user_metadata ?? {} }
    : null;
  if (!user) return { supabase, user: null, profile: null };
  // cột phone của profiles không đọc trực tiếp được (bảo mật SĐT) – lấy từ tài khoản đăng nhập
  const { data: row } = await supabase
    .from("profiles")
    .select("id, full_name, role, branch_id, extra_roles, active_role")
    .eq("id", user.id)
    .maybeSingle<{ id: string; full_name: string | null; role: Role; branch_id: string | null; extra_roles: Role[] | null; active_role: Role | null }>();
  const meta = (user.user_metadata ?? {}) as { phone?: string };
  let profile: Profile | null = null;
  if (row) {
    const roles = [row.role, ...(row.extra_roles ?? []).filter((r) => r !== row.role)];
    const active = row.active_role && roles.includes(row.active_role) ? row.active_role : row.role;
    profile = {
      id: row.id,
      full_name: row.full_name,
      branch_id: row.branch_id,
      role: active,
      primary_role: row.role,
      roles,
      phone: user.phone || meta.phone || null,
    };
  }
  return { supabase, user, profile };
});

export function isStaffRole(role: string | undefined | null): boolean {
  return role === "owner" || role === "manager" || role === "receptionist" || role === "technician" || role === "warehouse" || role === "marketing";
}
