import { getCurrentUser } from "@/lib/supabase/server";
import type { MkPerson } from "@/lib/marketing";

/** Người dùng được vào tab Marketing (chủ spa + Marketing) + danh sách người phụ trách */
export async function loadMarketingContext() {
  const { supabase, profile } = await getCurrentUser();
  const allowed = !!profile && (profile.role === "owner" || profile.role === "marketing");
  if (!allowed) return { allowed: false as const, supabase, profile, people: [] as MkPerson[] };
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .in("role", ["owner", "marketing"])
    .eq("is_active", true)
    .order("full_name");
  return { allowed: true as const, supabase, profile: profile!, people: (data ?? []) as MkPerson[] };
}

export const DENIED_TEXT = "Trang dành cho chủ spa và nhân viên Marketing.";
