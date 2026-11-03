import { getCurrentUser } from "@/lib/supabase/server";
import { fetchTechnicians } from "@/lib/staff";
import StaffBookingForm, { type StaffService } from "./StaffBookingForm";

export const metadata = { title: "Tạo lịch hẹn – Moana Beauty" };

export default async function StaffBookingPage({ searchParams }: { searchParams: Promise<{ sdt?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  const sp = await searchParams;
  const [{ data: branches }, { data: categories }, { data: services }, technicians] = await Promise.all([
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
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
      defaultBranchId={profile?.branch_id ?? branches?.[0]?.id ?? ""}
      initialPhone={sp.sdt ?? ""}
      branches={branches ?? []}
      categories={categories ?? []}
      services={(services ?? []) as StaffService[]}
      technicians={technicians}
    />
  );
}
