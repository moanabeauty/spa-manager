import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { fetchSellers, canCheckout } from "@/lib/staff";
import { fetchWallet, type Wallet } from "@/lib/billing";
import { fetchDefaultDiscountPct, fetchStock } from "@/lib/inventory";
import { fetchCustomerPromos, type CustomerPromo } from "@/lib/promotions";
import CheckoutForm, {
  type ApptInfo,
  type CheckoutPackage,
  type CheckoutService,
  type CustomerInfo,
  type DiscountRequest,
  type RetailProduct,
} from "./CheckoutForm";

export const metadata = { title: "Thu tiền – Moana Beauty" };

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ lich?: string; kh?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  if (!canCheckout(profile?.role)) {
    return <p className="card text-sm">Tài khoản của bạn chưa được phép thu tiền.</p>;
  }
  const sp = await searchParams;

  let appt: ApptInfo | null = null;
  let customer: CustomerInfo | null = null;

  if (sp.lich) {
    const { data } = await supabase
      .from("appointments")
      .select(
        "id, branch_id, start_at, status, customer_id, customers(id, full_name, phone, note), appointment_services(id, service_id, technician_id, start_at, customer_package_item_id)",
      )
      .eq("id", sp.lich)
      .maybeSingle();
    if (!data) return <p className="card text-sm">Không tìm thấy lịch hẹn.</p>;
    const { data: inv } = await supabase
      .from("invoices")
      .select("id, code")
      .eq("appointment_id", sp.lich)
      .neq("status", "cancelled")
      .maybeSingle();
    if (inv) {
      return (
        <div className="card text-sm">
          Lịch hẹn này đã thanh toán:{" "}
          <Link href={`/quan-ly/hoa-don/${inv.id}`} className="font-semibold text-navy underline">{inv.code}</Link>
        </div>
      );
    }
    if (data.status === "cancelled" || data.status === "no_show") {
      return <p className="card text-sm">Lịch hẹn đã huỷ / khách không đến, không thu tiền được.</p>;
    }
    const d = data as unknown as {
      id: string;
      branch_id: string;
      start_at: string;
      status: string;
      customers: CustomerInfo;
      appointment_services: ApptInfo["services"];
    };
    appt = {
      id: d.id,
      branch_id: d.branch_id,
      start_at: d.start_at,
      status: d.status,
      services: [...d.appointment_services].sort((a, b) => a.start_at.localeCompare(b.start_at)),
    };
    customer = d.customers;
  } else if (sp.kh) {
    const { data } = await supabase.from("customers").select("id, full_name, phone, note").eq("id", sp.kh).maybeSingle();
    customer = (data as CustomerInfo) ?? null;
  }

  // yêu cầu giảm giá gần nhất (chưa dùng) của lịch / khách này
  let dq = supabase
    .from("discount_requests")
    .select("id, amount, reason, status, review_note")
    .neq("status", "used")
    .order("created_at", { ascending: false })
    .limit(1);
  dq = appt ? dq.eq("appointment_id", appt.id) : customer ? dq.eq("customer_id", customer.id).is("appointment_id", null) : dq.eq("id", "00000000-0000-0000-0000-000000000000");
  const { data: lastRequest } = await dq.maybeSingle();

  const [{ data: retail }, { data: retailWh }, retailPct] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, brand, capacity, unit, barcode, retail_price, max_staff_discount_pct")
      .eq("is_active", true)
      .eq("for_retail", true)
      .not("retail_price", "is", null)
      .order("name"),
    supabase.from("warehouses").select("id, branch_id").eq("type", "retail"),
    fetchDefaultDiscountPct(supabase),
  ]);
  const whList = (retailWh ?? []) as { id: string; branch_id: string }[];
  const stock = await fetchStock(supabase, whList.map((w) => w.id));
  const retailStock: Record<string, Record<string, number>> = Object.fromEntries(
    whList.map((w) => [w.branch_id, Object.fromEntries(stock.get(w.id) ?? new Map())]),
  );

  const [{ data: branches }, { data: services }, { data: packages }, { data: tiers }, sellers, wallet, promos] = await Promise.all([
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("services")
      .select("id, name, name_en, price, member_price, card_allowed, duration_minutes, branch_id, is_active")
      .order("name"),
    supabase
      .from("packages")
      .select("id, name, price, validity_days, package_items(label, quantity, sort_order)")
      .eq("is_active", true)
      .order("name"),
    supabase.from("card_topup_tiers").select("id, topup_amount, bonus_amount").eq("is_active", true).order("topup_amount"),
    fetchSellers(supabase),
    customer ? fetchWallet(supabase, customer.id) : Promise.resolve<Wallet>({ cards: [], packages: [] }),
    customer ? fetchCustomerPromos(supabase, customer.id) : Promise.resolve<CustomerPromo[]>([]),
  ]);

  return (
    <CheckoutForm
      appt={appt}
      initialCustomer={customer}
      initialWallet={wallet}
      initialPromos={promos}
      defaultBranchId={appt?.branch_id ?? profile?.branch_id ?? branches?.[0]?.id ?? ""}
      branches={branches ?? []}
      services={(services ?? []) as CheckoutService[]}
      packages={(packages ?? []) as unknown as CheckoutPackage[]}
      tiers={(tiers ?? []) as { id: string; topup_amount: number; bonus_amount: number }[]}
      sellers={sellers}
      canDiscount={profile?.role === "owner" || profile?.role === "manager"}
      initialRequest={(lastRequest as DiscountRequest | null) ?? null}
      retailProducts={(retail ?? []) as RetailProduct[]}
      retailStock={retailStock}
      retailPct={retailPct}
      meId={profile!.id}
    />
  );
}
