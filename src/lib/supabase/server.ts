import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";

export async function createClient() {
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
}

export type Profile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: "owner" | "manager" | "receptionist" | "technician" | "warehouse" | "customer";
  branch_id: string | null;
};

/** Người dùng đang đăng nhập + hồ sơ (null nếu chưa đăng nhập) */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, profile: null };
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role, branch_id")
    .eq("id", user.id)
    .maybeSingle<Profile>();
  return { supabase, user, profile };
}

export function isStaffRole(role: string | undefined | null): boolean {
  return role === "owner" || role === "manager" || role === "receptionist" || role === "technician";
}
