import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { canCheckout } from "@/lib/staff";
import { formatDate, formatTime } from "@/lib/format";
import {
  PROMO_SELECT,
  REG_STATUS_LABEL,
  REG_STATUS_STYLE,
  canRedeem,
  dmy,
  fetchTakenCounts,
  isOpen,
  regDeadline,
  sortedItems,
  type Promotion,
} from "@/lib/promotions";
import ConfirmRegForm from "./ConfirmRegForm";
import CancelRegButton from "@/app/khuyen-mai/CancelRegButton";
import StaffRegisterForm from "./StaffRegisterForm";
import ExtendRegForm from "./ExtendRegForm";
import { todayVn } from "@/lib/format";

export const metadata = { title: "Đăng ký khuyến mãi – Moana Beauty" };

type Reg = {
  id: string;
  status: string;
  source: string;
  note: string | null;
  staff_note: string | null;
  cancel_reason: string | null;
  preferred_at: string | null;
  created_at: string;
  handled_at: string | null;
  invoice_id: string | null;
  branch_id: string | null;
  extended_until: string | null;
  extend_reason: string | null;
  customers: { id: string; full_name: string; phone: string | null } | null;
  promotions: { id: string; name: string; end_date: string | null; redeem_until: string | null; branch_id: string | null } | null;
  handler: { full_name: string | null } | null;
};

const TABS = [
  { key: "pending", label: "Chờ xác nhận" },
  { key: "confirmed", label: "Đã xác nhận" },
  { key: "used", label: "Đã dùng" },
  { key: "cancelled", label: "Đã huỷ" },
];

function shortDt(iso: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export default async function PromotionRegistrationsPage({ searchParams }: { searchParams: Promise<{ tt?: string; cn?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  if (!canCheckout(profile?.role)) return <p className="card text-sm">Trang dành cho lễ tân, KTV, quản lý.</p>;
  const sp = await searchParams;
  const status = TABS.some((t) => t.key === sp.tt) ? sp.tt! : "pending";
  const isAdmin = profile?.role === "owner" || profile?.role === "manager";

  const [{ data: branches }, { data: promoData }, taken] = await Promise.all([
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    supabase.from("promotions").select(PROMO_SELECT).eq("is_active", true).order("sort_order").order("created_at", { ascending: false }),
    fetchTakenCounts(supabase),
  ]);
  const branchList = (branches ?? []) as { id: string; name: string }[];
  const branchName = new Map(branchList.map((b) => [b.id, b.name]));
  const branchId = sp.cn === "all" ? "" : sp.cn ?? (isAdmin ? "" : profile?.branch_id ?? "");

  let q = supabase
    .from("promotion_registrations")
    .select(
      "id, status, source, note, staff_note, cancel_reason, preferred_at, created_at, handled_at, invoice_id, branch_id, extended_until, extend_reason, customers(id, full_name, phone), promotions(id, name, end_date, redeem_until, branch_id), handler:profiles!promotion_registrations_handled_by_fkey(full_name)",
    )
    .eq("status", status)
    .order(status === "pending" ? "created_at" : "handled_at", { ascending: status === "pending", nullsFirst: false })
    .limit(100);
  if (branchId) q = q.eq("branch_id", branchId);
  const { data, error } = await q;
  const regs = (data ?? []) as unknown as Reg[];

  const counts = new Map<string, number>();
  for (const t of ["pending", "confirmed"]) {
    let cq = supabase.from("promotion_registrations").select("id", { count: "exact", head: true }).eq("status", t);
    if (branchId) cq = cq.eq("branch_id", branchId);
    const { count } = await cq;
    counts.set(t, count ?? 0);
  }

  // chủ / quản lý: đăng ký hộ được cả chương trình đã hết thời gian đăng ký
  const today = todayVn();
  const openPromos = ((promoData ?? []) as unknown as Promotion[]).filter(
    (p) => isOpen(p) || (isAdmin && p.is_active && !!p.end_date && p.end_date < today),
  );
  const link = (patch: { tt?: string; cn?: string }) => {
    const p = new URLSearchParams();
    p.set("tt", patch.tt ?? status);
    const cn = patch.cn ?? (sp.cn ?? "");
    if (cn) p.set("cn", cn);
    return `/quan-ly/khuyen-mai?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy">Đăng ký khuyến mãi</h1>
          <p className="text-sm text-ink/70">Gọi khách xác nhận, khi khách đến thì bấm Thu tiền để áp giá khuyến mãi.</p>
        </div>
        {isAdmin && (
          <Link href="/quan-ly/khuyen-mai/chuong-trinh" className="btn-outline">Chương trình khuyến mãi</Link>
        )}
      </div>

      {openPromos.length > 0 && (
        <StaffRegisterForm
          promotions={openPromos.map((p) => ({
            id: p.id,
            name: p.name,
            branch_id: p.branch_id,
            new_customers_only: p.new_customers_only,
            show_online: p.show_online,
            left: p.max_slots === null ? null : Math.max(0, p.max_slots - (taken.get(p.id) ?? 0)),
            summary: sortedItems(p).map((i) => i.label).join(", "),
            ended: !!p.end_date && p.end_date < today,
          }))}
          branches={branchList}
          defaultBranchId={branchId || profile?.branch_id || branchList[0]?.id || ""}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={link({ tt: t.key })}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${t.key === status ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}
          >
            {t.label}
            {counts.get(t.key) ? ` (${counts.get(t.key)})` : ""}
          </Link>
        ))}
        <span className="ml-auto flex gap-1 text-xs">
          {[{ id: "all", name: "Tất cả" }, ...branchList].map((b) => {
            const on = (b.id === "all" && !branchId) || b.id === branchId;
            return (
              <Link key={b.id} href={link({ cn: b.id })} className={`rounded-full px-2.5 py-1 ${on ? "bg-beige font-semibold text-navy" : "text-ink/60"}`}>
                {b.name}
              </Link>
            );
          })}
        </span>
      </div>

      {error && <p className="card text-sm text-[#8A2323]">{error.message}</p>}
      {regs.length === 0 && <p className="card text-sm text-ink/60">Không có đăng ký nào.</p>}

      {regs.map((r) => {
        const expired = !!r.promotions && r.status === "confirmed" && !canRedeem(r.promotions, today, r.extended_until);
        const deadline = r.promotions ? regDeadline(r.promotions, r.extended_until) : null;
        return (
          <div key={r.id} className={`card p-4 text-sm ${r.status === "pending" ? "border-l-4 border-l-[#E0A526]" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-navy">{r.promotions?.name}</p>
                {r.customers && (
                  <p>
                    <Link href={`/quan-ly/khach-hang?id=${r.customers.id}`} className="font-medium underline">{r.customers.full_name}</Link>
                    {r.customers.phone && (
                      <a href={`tel:${r.customers.phone}`} className="ml-2 text-navy underline">{r.customers.phone}</a>
                    )}
                  </p>
                )}
                <p className="text-xs text-ink/60">
                  {r.branch_id ? branchName.get(r.branch_id) : ""} · {r.source === "staff" ? "nhân viên đăng ký hộ" : "khách đăng ký online"} lúc {shortDt(r.created_at)}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${REG_STATUS_STYLE[r.status] ?? ""}`}>
                {expired ? "Hết hạn dùng" : REG_STATUS_LABEL[r.status]}
              </span>
            </div>
            {r.preferred_at && (
              <p className="mt-1">
                Muốn đến: <b>{formatTime(r.preferred_at)}</b> <span className="capitalize">{formatDate(r.preferred_at)}</span>
              </p>
            )}
            {r.note && <p className="mt-1 rounded-lg bg-[#FFE8BA]/60 px-2 py-1 text-xs">Khách ghi: {r.note}</p>}
            {r.staff_note && <p className="mt-1 text-xs text-ink/70">Ghi chú nhân viên: {r.staff_note}</p>}
            {r.status === "cancelled" && <p className="mt-1 text-xs text-ink/60">Lý do huỷ: {r.cancel_reason}</p>}
            {r.handler?.full_name && r.status !== "pending" && (
              <p className="mt-1 text-xs text-ink/50">
                Xử lý: {r.handler.full_name}
                {r.handled_at ? ` · ${shortDt(r.handled_at)}` : ""}
              </p>
            )}
            {r.status === "confirmed" && deadline && (
              <p className={`mt-1 text-xs ${expired ? "text-[#8A2323]" : "text-ink/60"}`}>
                Hạn dùng ưu đãi: {dmy(deadline)}
                {r.extended_until && ` (đã gia hạn: ${r.extend_reason})`}
                {expired && (isAdmin ? " – bấm Gia hạn nếu đồng ý cho khách dùng tiếp" : " – cần chủ spa / quản lý gia hạn")}
              </p>
            )}

            {r.status === "pending" && (
              <div className="mt-3 border-t border-beige pt-3">
                <ConfirmRegForm
                  id={r.id}
                  preferredAt={r.preferred_at}
                  branchId={r.branch_id}
                  branches={r.promotions?.branch_id ? branchList.filter((b) => b.id === r.promotions!.branch_id) : branchList}
                />
              </div>
            )}
            {r.status === "confirmed" && r.customers && (
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-beige pt-3">
                {r.customers.phone && (
                  <Link href={`/quan-ly/tao-lich?sdt=${r.customers.phone}`} className="btn-ghost py-1.5">Tạo lịch hẹn</Link>
                )}
                {isAdmin && <ExtendRegForm id={r.id} expired={expired} />}
                {!expired && (
                  <Link href={`/quan-ly/thu-tien?kh=${r.customers.id}`} className="btn-primary py-1.5">Thu tiền</Link>
                )}
                <CancelRegButton id={r.id} needReason />
              </div>
            )}
            {r.status === "pending" && (
              <div className="mt-2 text-right">
                <CancelRegButton id={r.id} needReason />
              </div>
            )}
            {r.status === "used" && r.invoice_id && (
              <p className="mt-2 text-right">
                <Link href={`/quan-ly/hoa-don/${r.invoice_id}`} className="text-navy underline">Xem hoá đơn</Link>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
