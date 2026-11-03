import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatVnd } from "@/lib/format";
import {
  KIND_LABEL,
  PROMO_SELECT,
  REG_STATUS_LABEL,
  REG_STATUS_STYLE,
  dmy,
  fetchTakenCounts,
  isOpen,
  periodText,
  promoTotals,
  sortedItems,
  type Promotion,
} from "@/lib/promotions";
import RegisterForm from "./RegisterForm";

export const metadata = { title: "Khuyến mãi – Moana Beauty" };

type MyReg = { id: string; promotion_id: string; status: string };

export default async function PromotionsPage() {
  const { supabase, user } = await getCurrentUser();
  const [{ data }, { data: branches }, taken] = await Promise.all([
    supabase
      .from("promotions")
      .select(PROMO_SELECT)
      .eq("is_active", true)
      .eq("show_online", true)
      .order("sort_order")
      .order("created_at", { ascending: false }),
    supabase.from("branches").select("id, name, address").eq("is_active", true).order("name"),
    fetchTakenCounts(supabase),
  ]);
  const promos = ((data ?? []) as unknown as Promotion[]).filter((p) => isOpen(p));
  const branchList = (branches ?? []) as { id: string; name: string; address: string }[];
  const branchName = new Map(branchList.map((b) => [b.id, b.name]));

  let myRegs: MyReg[] = [];
  let hasCustomer = false;
  if (user) {
    const { data: c } = await supabase.from("customers").select("id").eq("profile_id", user.id).maybeSingle();
    if (c) {
      hasCustomer = true;
      const { data: r } = await supabase
        .from("promotion_registrations")
        .select("id, promotion_id, status")
        .eq("customer_id", c.id)
        .neq("status", "cancelled");
      myRegs = (r ?? []) as MyReg[];
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">Khuyến mãi</h1>
          <p className="text-sm text-ink/70">Đăng ký online, Moana sẽ gọi xác nhận và hẹn lịch với bạn.</p>
        </div>
        {user && (
          <Link href="/lich-hen" className="btn-outline shrink-0">Ưu đãi của tôi</Link>
        )}
      </div>

      {promos.length === 0 && <p className="card text-sm text-ink/60">Hiện chưa có chương trình khuyến mãi nào. Hẹn bạn dịp sau nhé!</p>}

      {promos.map((p) => {
        const items = sortedItems(p);
        const totals = promoTotals(p);
        const used = taken.get(p.id) ?? 0;
        const left = p.max_slots === null ? null : Math.max(0, p.max_slots - used);
        const mine = myRegs.filter((r) => r.promotion_id === p.id);
        const reachedLimit = mine.length >= p.per_customer_limit;
        return (
          <article key={p.id} className="card space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <span className="rounded-full bg-beige px-3 py-1 text-xs font-semibold text-brown">{KIND_LABEL[p.kind]}</span>
                <h2 className="mt-2 text-xl font-bold text-navy">{p.name}</h2>
                <p className="text-xs text-ink/60">
                  Đăng ký {periodText(p)}
                  {p.branch_id ? ` · chỉ tại ${branchName.get(p.branch_id) ?? ""}` : " · cả 2 chi nhánh"}
                </p>
              </div>
              {left !== null && (
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${left > 0 ? "bg-[#FFE8BA] text-[#7A5600]" : "bg-[#ECECEC] text-[#666]"}`}>
                  {left > 0 ? `Còn ${left} suất` : "Hết suất"}
                </span>
              )}
            </div>
            {p.description && <p className="whitespace-pre-line text-sm">{p.description}</p>}

            <ul className="divide-y divide-beige rounded-xl border border-beige-dark text-sm">
              {items.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>
                    {i.label}
                    {i.quantity > 1 && <span className="text-ink/60"> × {i.quantity}</span>}
                  </span>
                  <span className="shrink-0 text-right">
                    {i.list_price !== null && Number(i.list_price) > Number(i.promo_price) && (
                      <span className="mr-2 text-xs text-ink/40 line-through">{formatVnd(Number(i.list_price))}</span>
                    )}
                    <b className={Number(i.promo_price) === 0 ? "text-[#22612A]" : "text-navy"}>
                      {Number(i.promo_price) === 0 ? "Tặng" : formatVnd(Number(i.promo_price))}
                    </b>
                  </span>
                </li>
              ))}
            </ul>
            {items.length > 1 && (
              <p className="flex justify-between text-sm">
                <span>Tổng ưu đãi</span>
                <span>
                  {totals.list !== null && totals.list > totals.promo && (
                    <span className="mr-2 text-xs text-ink/40 line-through">{formatVnd(totals.list)}</span>
                  )}
                  <b className="text-navy">{formatVnd(totals.promo)}</b>
                </span>
              </p>
            )}

            <ul className="list-inside list-disc text-xs text-ink/70">
              {p.new_customers_only && <li>Dành cho khách lần đầu đến Moana</li>}
              {p.per_customer_limit > 1 && <li>Mỗi khách đăng ký tối đa {p.per_customer_limit} lần</li>}
              {(p.redeem_until ?? p.end_date) && <li>Sử dụng ưu đãi đến hết {dmy(p.redeem_until ?? p.end_date)}</li>}
              {p.terms && <li className="whitespace-pre-line">{p.terms}</li>}
            </ul>

            <div className="border-t border-beige pt-3">
              {mine.length > 0 && (
                <p className="mb-2 text-sm">
                  Bạn đã đăng ký:{" "}
                  {mine.map((r) => (
                    <span key={r.id} className={`mr-1 rounded-full px-2 py-0.5 text-xs font-semibold ${REG_STATUS_STYLE[r.status]}`}>
                      {REG_STATUS_LABEL[r.status]}
                    </span>
                  ))}
                </p>
              )}
              {!user ? (
                <Link href="/dang-nhap?next=/khuyen-mai" className="btn-primary w-full">Đăng nhập để đăng ký</Link>
              ) : !hasCustomer ? (
                <p className="text-sm text-ink/60">Tài khoản chưa có hồ sơ khách hàng, vui lòng liên hệ lễ tân Moana.</p>
              ) : left === 0 ? (
                <p className="text-sm text-ink/60">Chương trình đã hết suất.</p>
              ) : reachedLimit ? null : (
                <RegisterForm
                  promotionId={p.id}
                  branches={p.branch_id ? branchList.filter((b) => b.id === p.branch_id) : branchList}
                />
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
