import { createClient } from "@/lib/supabase/server";
import { todayVn } from "@/lib/format";
import type { NavCounts } from "@/lib/nav";

const head = { count: "exact" as const, head: true };

/** Đếm các việc đang chờ của từng nhóm (hiện số trên thanh điều hướng + trang Tổng quan) */
export async function loadNavCounts(role: string, branchId: string | null): Promise<NavCounts> {
  const supabase = await createClient();
  const M = role === "owner" || role === "manager";
  const O = role === "owner";
  const W = role === "warehouse";
  const MK = role === "marketing";
  const L = W || MK;
  const zero = Promise.resolve({ count: 0 });
  const today = todayVn();

  let stockQ = supabase.from("stock_requests").select("id, warehouses!inner(branch_id)", head).eq("status", "pending");
  if (W && branchId) stockQ = stockQ.eq("warehouses.branch_id", branchId);
  let careQ = supabase.from("care_reminders").select("id", head).eq("status", "open").lte("due_date", today);
  if (!M && branchId) careQ = careQ.or(`branch_id.eq.${branchId},branch_id.is.null`);
  let discQ = supabase.from("discount_requests").select("id", head).eq("status", "pending");
  if (!O) discQ = discQ.eq("kind", "debt");

  const [disc, vouchers, promos, care, stock, counts, att, ot, leaves, chg, early, fix, mk] = await Promise.all([
    M ? discQ : zero,
    M ? supabase.from("cashbook_entries").select("id", head).eq("source", "counter").eq("status", "pending") : zero,
    !L ? supabase.from("promotion_registrations").select("id", head).eq("status", "pending") : zero,
    !L ? careQ : zero,
    M || W ? stockQ : zero,
    O ? supabase.from("stock_counts").select("id", head).eq("status", "pending") : zero,
    O ? supabase.from("staff_attendance").select("staff_id", head).eq("approval_status", "pending") : zero,
    M ? supabase.from("staff_attendance").select("staff_id", head).eq("ot_status", "pending") : zero,
    M ? supabase.from("staff_leaves").select("id", head).eq("status", "pending") : zero,
    M ? supabase.from("procedure_change_requests").select("id", head).eq("status", "pending") : zero,
    M ? supabase.from("staff_attendance").select("staff_id", head).eq("in_status", "pending") : zero,
    M ? supabase.from("attendance_fix_requests").select("id", head).eq("status", "pending") : zero,
    O || MK ? supabase.from("marketing_posts").select("id", head).eq("status", O ? "review" : "revise") : zero,
  ]);
  return {
    discounts: disc.count ?? 0,
    vouchers: vouchers.count ?? 0,
    promos: promos.count ?? 0,
    care: care.count ?? 0,
    stockRequests: stock.count ?? 0,
    stockCounts: counts.count ?? 0,
    attendance: (att.count ?? 0) + (ot.count ?? 0),
    leaves: leaves.count ?? 0,
    ktv: (chg.count ?? 0) + (early.count ?? 0) + (fix.count ?? 0),
    marketing: mk.count ?? 0,
  };
}

