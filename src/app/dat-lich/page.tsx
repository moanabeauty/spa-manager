import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import BookingForm, { type Branch, type Category, type Service } from "./BookingForm";

export const metadata = { title: "Đặt lịch – Moana Beauty" };

export default async function BookingPage() {
  const { supabase, user } = await getCurrentUser();
  if (!user) redirect("/dang-nhap?next=/dat-lich");

  const [{ data: branches }, { data: categories }, { data: services }, { data: customer }] = await Promise.all([
    supabase.from("branches").select("id, name, address").eq("is_active", true).order("name"),
    supabase.from("service_categories").select("id, name, sort_order").order("sort_order"),
    supabase
      .from("services")
      .select("id, category_id, name, name_en, description, duration_minutes, price, branch_id")
      .eq("is_active", true)
      .order("name"),
    supabase.from("customers").select("id, full_name").eq("profile_id", user.id).maybeSingle(),
  ]);

  if (!customer) {
    return (
      <div className="card">
        <h1 className="text-lg font-bold text-navy">Chưa có hồ sơ khách hàng</h1>
        <p className="mt-2 text-sm">
          Tài khoản của bạn chưa được gắn với hồ sơ khách hàng. Vui lòng liên hệ lễ tân Moana để được hỗ trợ.
        </p>
      </div>
    );
  }

  return (
    <BookingForm
      customerId={customer.id}
      customerName={customer.full_name}
      branches={(branches ?? []) as Branch[]}
      categories={(categories ?? []) as Category[]}
      services={(services ?? []) as Service[]}
    />
  );
}
