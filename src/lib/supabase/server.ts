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

export type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: "owner" | "manager" | "receptionist" | "technician" | "warehouse" | "marketing" | "customer";
  branch_id: string | null;
};

/** Người dùng đang đăng nhập + hồ sơ (null nếu chưa đăng nhập).
 *  Bọc cache(): Header, layout và trang gọi cùng lúc nhưng chỉ hỏi Supabase 1 lần mỗi lần tải trang. */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, profile: null };
  // cột phone của profiles không đọc trực tiếp được (bảo mật SĐT) – lấy từ tài khoản đăng nhập
  const { data: row } = await supabase
    .from("profiles")
    .select("id, full_name, role, branch_id")
    .eq("id", user.id)
    .maybeSingle<Omit<Profile, "phone">>();
  const meta = (user.user_metadata ?? {}) as { phone?: string };
  const profile: Profile | null = row ? { ...row, phone: user.phone || meta.phone || null } : null;
  return { supabase, user, profile };
});

export function isStaffRole(role: string | undefined | null): boolean {
  return role === "owner" || role === "manager" || role === "receptionist" || role === "technician" || role === "warehouse" || role === "marketing";
}
