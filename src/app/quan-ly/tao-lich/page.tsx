import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { fetchTechnicians } from "@/lib/staff";
import StaffBookingForm, { type StaffService } from "./StaffBookingForm";

export const metadata = { title: "Tạo lịch hẹn – Moana Beauty" };

export default async function StaffBookingPage({ searchParams }: { searchParams: Promise<{ sdt?: string; cn?: string; ngay?: string; gio?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  if (profile?.role === "technician") redirect("/quan-ly/ktv/dat-lich"); // KTV đặt lịch ở app riêng
  const sp = await searchParams;
  const [{ data: branches }, { data: categories }, { data: services }, technicians] = await Promise.all([
    supabase.from("branches").select("id, name, max_per_slot").eq("is_active", true).order("name"),
    supabase.from("service_categories").select("id, name, sort_order").order("sort_order"),
    supabase
      .from("services")
      .select("id, category_id, name, name_en, duration_minutes, price, branch_id")
      .eq("is_active", true)
      .order("name"),
    fetchTechnicians(supabase),
  ]);

  return (
    <StaffBookingForm
      defaultBranchId={sp.cn ?? profile?.branch_id ?? branches?.[0]?.id ?? ""}
      initialDate={sp.ngay && /^\d{4}-\d{2}-\d{2}$/.test(sp.ngay) ? sp.ngay : undefined}
      initialTime={sp.gio && /^\d{2}:\d{2}$/.test(sp.gio) ? sp.gio : undefined}
      canOverbook={profile?.role === "owner" || profile?.role === "manager"}
      initialPhone={sp.sdt ?? ""}
      branches={branches ?? []}
      categories={categories ?? []}
      services={(services ?? []) as StaffService[]}
      technicians={technicians}
    />
  );
}
