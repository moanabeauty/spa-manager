import { getCurrentUser } from "@/lib/supabase/server";
import { DEFAULT_CAPACITY } from "@/lib/calendar";
import type { PickService } from "../ServicePicker";
import KtvBookingForm from "./KtvBookingForm";

export const metadata = { title: "Đặt lịch cho khách – Moana Beauty" };

/** KTV đặt lịch: chỉ thấy khung giờ trống / kín của chi nhánh mình, không thấy lịch KTV khác */
export default async function KtvBookingPage() {
  const { supabase, profile } = await getCurrentUser();
  if (!profile) return null;
  const [{ data: branches }, { data: svcs }] = await Promise.all([
    supabase.from("branches").select("id, name, max_per_slot").eq("is_active", true).order("name"),
    supabase.from("services").select("id, name, name_en, duration_minutes, branch_id, service_categories(name, sort_order)").eq("is_active", true),
  ]);
  const list = (branches ?? []) as { id: string; name: string; max_per_slot: number | null }[];
  const branch = list.find((b) => b.id === profile.branch_id) ?? (profile.role === "technician" ? null : list[0]);
  if (!branch) {
    return <div className="card text-sm">Tài khoản của bạn chưa được gắn chi nhánh. Vui lòng nhờ chủ spa cấp chi nhánh.</div>;
  }
  type Raw = Omit<PickService, "category"> & { service_categories: { name: string; sort_order: number } | null };
  const services: PickService[] = ((svcs ?? []) as unknown as Raw[])
    .sort((a, b) => (a.service_categories?.sort_order ?? 99) - (b.service_categories?.sort_order ?? 99) || (a.name_en ?? a.name).localeCompare(b.name_en ?? b.name))
    .map(({ service_categories, ...s }) => ({ ...s, category: service_categories?.name ?? null }));

  return (
    <KtvBookingForm
      branchId={branch.id}
      branchName={branch.name}
      capacity={branch.max_per_slot ?? DEFAULT_CAPACITY}
      services={services}
    />
  );
}
