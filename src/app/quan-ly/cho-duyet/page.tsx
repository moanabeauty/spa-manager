import { allBranches, payrollSettings } from "@/lib/refData";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatShortDate, formatTime, formatVnd, vnDateTime } from "@/lib/format";
import DiscountReview from "../duyet-giam-gia/ReviewButtons";
import { ReviewButtons } from "../theo-doi-ktv/Actions";
import { VoucherReview } from "../phieu-thu-chi/VoucherForm";
import { CountReview } from "../kho/kiem-kho/CountForm";
import RequestCard, { type StockRequest } from "../kho/xin-xuat/RequestCard";
import StockConfirmReview from "./StockConfirmReview";

export const metadata = { title: "Việc chờ duyệt – Moana Beauty" };

const STOCK_REQ_SELECT =
  "id, code, status, reason, review_note, created_at, reviewed_at, requested_by, warehouse_id, warehouses(name, branch_id), requester:profiles!stock_requests_requested_by_fkey(full_name), reviewer:profiles!stock_requests_reviewed_by_fkey(full_name), stock_request_items(quantity, product_id, products(name, capacity, unit))";

const none = Promise.resolve({ data: [] as unknown[] });
const when = (iso: string) => `${formatTime(iso)} ${formatShortDate(iso)}`;
const hhmm = (iso: string | null) => (iso ? formatTime(iso) : "—");

type Named = { full_name: string | null } | null;

/** Chủ spa / quản lý: mọi việc cần duyệt gom về 1 trang, duyệt / từ chối ngay tại chỗ.
 *  Các trang cũ (Duyệt giảm giá, Theo dõi KTV, Kho…) vẫn giữ nguyên. */
export default async function ApprovalsPage() {
  const { supabase, profile } = await getCurrentUser();
  const role = profile?.role;
  if (role !== "owner" && role !== "manager") return <p className="card text-sm">Trang dành cho chủ spa và quản lý.</p>;
  const O = role === "owner";

  let discQ = supabase
    .from("discount_requests")
    .select("id, kind, amount, reason, created_at, branches(name), customers(id, full_name), requester:profiles!discount_requests_requested_by_fkey(full_name)")
    .eq("status", "pending")
    .order("created_at");
  if (!O) discQ = discQ.eq("kind", "debt");

  const [discR, vouR, attR, otR, earlyR, fixR, leaveR, chgR, reqR, branchR, countR, recR, mkR, staffR, cfgR, cfmR] = await Promise.all([
    discQ,
    supabase
      .from("cashbook_entries")
      .select("id, code, kind, amount, description, created_at, cashbook_categories(name), creator:profiles!cashbook_entries_created_by_fkey(full_name)")
      .eq("source", "counter")
      .eq("status", "pending")
      .order("created_at"),
    O
      ? supabase
          .from("staff_attendance")
          .select("staff_id, work_date, check_in, check_out, approval_reason, in_distance_m, out_distance_m, staff:profiles!staff_attendance_staff_id_fkey(full_name)")
          .eq("approval_status", "pending")
          .order("work_date")
      : none,
    supabase
      .from("staff_attendance")
      .select("staff_id, work_date, check_out, ot_reason, staff:profiles!staff_attendance_staff_id_fkey(full_name)")
      .eq("ot_status", "pending")
      .order("work_date"),
    supabase
      .from("staff_attendance")
      .select("staff_id, work_date, check_in, in_reason_kind, in_note, staff:profiles!staff_attendance_staff_id_fkey(full_name)")
      .eq("in_status", "pending")
      .order("work_date"),
    supabase
      .from("attendance_fix_requests")
      .select("id, work_date, check_in, check_out, reason, staff:profiles!attendance_fix_requests_staff_id_fkey(full_name)")
      .eq("status", "pending")
      .order("work_date"),
    supabase.from("staff_leaves").select("id, staff_id, leave_date, kind, half_day, work_shift, reason").eq("status", "pending").order("leave_date"),
    supabase
      .from("procedure_change_requests")
      .select(
        "id, step_no, from_product, to_product, reason, created_at, requester:profiles!procedure_change_requests_requested_by_fkey(full_name), appointment_services(services(name_en, name), appointments(customers(full_name)))",
      )
      .eq("status", "pending")
      .order("created_at"),
    supabase.from("stock_requests").select(STOCK_REQ_SELECT).eq("status", "pending").order("created_at"),
    allBranches(),
    O
      ? supabase
          .from("stock_counts")
          .select("id, code, kind, note, created_at, warehouses(name), creator:profiles!stock_counts_created_by_fkey(full_name), stock_count_opened(product_id), stock_count_items(product_id, system_qty, counted_qty, products(name, capacity))")
          .eq("status", "pending")
          .order("created_at")
      : none,
    O
      ? supabase
          .from("stock_receipts")
          .select("id, code, supplier, created_at, warehouses(name), profiles!stock_receipts_created_by_fkey(full_name), stock_receipt_items(quantity)")
          .eq("status", "pending")
          .order("created_at")
      : none,
    O ? supabase.from("marketing_posts").select("id, title, publish_date, due_date, channels").eq("status", "review").order("publish_date") : none,
    supabase.from("profiles").select("id, full_name"),
    payrollSettings(),
    O
      ? supabase
          .from("usage_stock_confirms")
          .select("id, note, created_at, warehouses(name), products(name, capacity), requester:profiles!usage_stock_confirms_requested_by_fkey(full_name), appointment_services(services(name_en, name), appointments(customers(full_name)))")
          .eq("status", "pending")
          .order("created_at")
      : none,
  ]);

  const disc = (discR.data ?? []) as unknown as {
    id: string; kind: string; amount: number; reason: string; created_at: string;
    branches: { name: string } | null; customers: { id: string; full_name: string } | null; requester: Named;
  }[];
  const vouchers = (vouR.data ?? []) as unknown as {
    id: string; code: string | null; kind: string; amount: number; description: string | null; created_at: string;
    cashbook_categories: { name: string } | null; creator: Named;
  }[];
  const att = (attR.data ?? []) as unknown as {
    staff_id: string; work_date: string; check_in: string; check_out: string | null; approval_reason: string | null;
    in_distance_m: number | null; out_distance_m: number | null; staff: Named;
  }[];
  const ot = (otR.data ?? []) as unknown as { staff_id: string; work_date: string; check_out: string | null; ot_reason: string | null; staff: Named }[];
  const early = (earlyR.data ?? []) as unknown as { staff_id: string; work_date: string; check_in: string; in_reason_kind: string | null; in_note: string | null; staff: Named }[];
  const fixes = (fixR.data ?? []) as unknown as { id: string; work_date: string; check_in: string | null; check_out: string | null; reason: string; staff: Named }[];
  const leaves = (leaveR.data ?? []) as unknown as { id: string; staff_id: string; leave_date: string; kind: string; half_day: boolean; work_shift: string | null; reason: string | null }[];
  const changes = (chgR.data ?? []) as unknown as {
    id: string; step_no: number; from_product: string | null; to_product: string; reason: string; created_at: string; requester: Named;
    appointment_services: { services: { name_en: string | null; name: string } | null; appointments: { customers: { full_name: string } | null } | null } | null;
  }[];
  const stockReqs = (reqR.data ?? []) as unknown as StockRequest[];
  const counts = (countR.data ?? []) as unknown as {
    id: string; code: string; kind: string; note: string | null; created_at: string; warehouses: { name: string } | null; creator: Named;
    stock_count_opened: { product_id: string }[];
    stock_count_items: { product_id: string; system_qty: number; counted_qty: number; products: { name: string; capacity: string | null } | null }[];
  }[];
  const receipts = (recR.data ?? []) as unknown as {
    id: string; code: string; supplier: string | null; created_at: string; warehouses: { name: string } | null;
    profiles: Named; stock_receipt_items: { quantity: number }[];
  }[];
  const posts = (mkR.data ?? []) as unknown as { id: string; title: string; publish_date: string | null; due_date: string | null; channels: string[] | null }[];
  const otStart = (cfgR.data?.value as { ot_start?: string } | null)?.ot_start ?? "18:30";
  const otHours = (date: string, out: string | null) =>
    out ? Math.max(0, Math.round(((new Date(out).getTime() - vnDateTime(date, otStart).getTime()) / 3600000) * 100) / 100) : 0;
  const bname = new Map(((branchR.data ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]));
  const pname = new Map(((staffR.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "?"]));

  const confirms = (cfmR.data ?? []) as unknown as {
    id: string; note: string | null; created_at: string; warehouses: { name: string } | null; products: { name: string; capacity: string | null } | null; requester: Named;
    appointment_services: { services: { name_en: string | null; name: string } | null; appointments: { customers: { full_name: string } | null } | null } | null;
  }[];

  const total =
    confirms.length +
    disc.length + vouchers.length + att.length + ot.length + early.length + fixes.length + leaves.length + changes.length + stockReqs.length + counts.length + receipts.length + posts.length;

  const jump = [
    { id: "giam-gia", label: O ? "Giảm giá & cho nợ" : "Cho nợ", n: disc.length },
    { id: "thu-chi", label: "Thu chi tiền mặt", n: vouchers.length },
    { id: "cham-cong", label: "Chấm công & tăng ca", n: att.length + ot.length },
    { id: "ktv", label: "Vào sớm · quên chấm công · đổi sản phẩm", n: early.length + fixes.length + changes.length },
    { id: "nghi-phep", label: "Nghỉ phép", n: leaves.length },
    { id: "con-hang", label: "Xác nhận còn hàng", n: confirms.length },
    { id: "xin-xuat", label: "Xin xuất kho", n: stockReqs.length },
    { id: "kiem-kho", label: "Kiểm kho lệch", n: counts.length },
    { id: "nhap-hang", label: "Phiếu nhập", n: receipts.length },
    { id: "marketing", label: "Bài Marketing", n: posts.length },
  ].filter((j) => j.n > 0);

  const item = "rounded-xl border border-[#F0DFB4] bg-[#FFF8E8] px-3 py-2.5 text-sm";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl font-semibold text-navy">Việc chờ duyệt</h1>
        <p className="text-sm text-ink/70">Mọi yêu cầu cần {O ? "chủ spa / quản lý" : "quản lý"} duyệt nằm ở đây. Duyệt xong, mục đó tự biến mất.</p>
      </div>

      {total === 0 ? (
        <p className="card text-sm text-[#22612A]">✓ Không có việc nào đang chờ duyệt.</p>
      ) : (
        <nav className="flex flex-wrap gap-1.5">
          {jump.map((j) => (
            <a key={j.id} href={`#${j.id}`} className="rounded-full bg-white px-3 py-1.5 text-sm text-navy ring-1 ring-beige-dark hover:bg-cream">
              {j.label} <b className="ml-0.5 rounded-full bg-[#C2410C] px-1.5 text-xs text-white">{j.n}</b>
            </a>
          ))}
        </nav>
      )}

      {disc.length > 0 && (
        <Section id="giam-gia" title={O ? "Giảm giá & cho nợ" : "Cho khách nợ"} more="/quan-ly/duyet-giam-gia">
          {disc.map((r) => (
            <div key={r.id} className={item}>
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-semibold text-navy">
                  {r.kind === "debt" ? "Cho nợ" : "Giảm"} {formatVnd(Number(r.amount))}
                  {r.customers && (
                    <Link href={`/quan-ly/khach-hang?id=${r.customers.id}`} className="ml-1 font-normal underline">
                      · {r.customers.full_name}
                    </Link>
                  )}
                </p>
                <span className="text-xs text-ink/60">{when(r.created_at)}</span>
              </div>
              <p className="text-xs">Lý do: {r.reason} · {r.requester?.full_name ?? "?"} · {r.branches?.name}</p>
              {O || r.kind === "debt" ? <DiscountReview id={r.id} amount={Number(r.amount)} /> : null}
            </div>
          ))}
        </Section>
      )}

      {vouchers.length > 0 && (
        <Section id="thu-chi" title="Thu chi tiền mặt tại spa" more="/quan-ly/phieu-thu-chi">
          {vouchers.map((v) => (
            <div key={v.id} className={item}>
              <div className="flex justify-between gap-2">
                <p>
                  <b>{v.kind === "income" ? "Phiếu thu" : "Phiếu chi"}</b> · {v.cashbook_categories?.name}
                  {v.description ? ` · ${v.description}` : ""}
                </p>
                <b className={v.kind === "income" ? "text-[#22612A]" : "text-[#8A2323]"}>
                  {v.kind === "income" ? "+" : "−"}
                  {formatVnd(Number(v.amount))}
                </b>
              </div>
              <p className="text-xs text-ink/60">{v.creator?.full_name ?? "?"} · {when(v.created_at)}</p>
              <VoucherReview id={v.id} />
            </div>
          ))}
        </Section>
      )}

      {att.length + ot.length > 0 && (
        <Section id="cham-cong" title="Chấm công & tăng ca" more="/quan-ly/cham-cong">
          {att.map((a) => (
            <div key={`a${a.staff_id}${a.work_date}`} className={item}>
              <p>
                <b>{a.staff?.full_name}</b> · ngày công {formatShortDate(a.work_date)} · vào {hhmm(a.check_in)} · ra {hhmm(a.check_out)}
              </p>
              <p className="text-xs">
                {a.approval_reason ?? "Chấm công cần duyệt"}
                {a.in_distance_m != null ? ` · vào cách ${a.in_distance_m}m` : ""}
                {a.out_distance_m != null ? ` · ra cách ${a.out_distance_m}m` : ""}
              </p>
              <ReviewButtons fn="review_attendance" args={{ p_staff: a.staff_id, p_date: a.work_date }} />
            </div>
          ))}
          {ot.map((a) => (
            <div key={`o${a.staff_id}${a.work_date}`} className={item}>
              <p>
                <b>{a.staff?.full_name}</b> · tăng ca {formatShortDate(a.work_date)} · ra {hhmm(a.check_out)} ·{" "}
                <b>khoảng {otHours(a.work_date, a.check_out).toLocaleString("vi-VN")} giờ</b>
              </p>
              {a.ot_reason && <p className="text-xs">{a.ot_reason}</p>}
              <ReviewButtons fn="review_overtime" args={{ p_staff: a.staff_id, p_date: a.work_date, p_hours: null }} />
            </div>
          ))}
          <p className="text-xs text-ink/55">Muốn duyệt số giờ tăng ca khác với giờ xin: vào trang Chấm công & tăng ca.</p>
        </Section>
      )}

      {early.length + fixes.length + changes.length > 0 && (
        <Section id="ktv" title="Vào sớm · quên chấm công · đổi sản phẩm" more="/quan-ly/theo-doi-ktv">
          {changes.map((c) => (
            <div key={c.id} className={item}>
              <p>
                <b>{c.requester?.full_name ?? "KTV"}</b> xin đổi sản phẩm · {c.appointment_services?.appointments?.customers?.full_name} ·{" "}
                {c.appointment_services?.services?.name_en || c.appointment_services?.services?.name} · bước {c.step_no}
              </p>
              <p className="text-xs">
                {c.from_product ? <s>{c.from_product}</s> : "Sản phẩm"} → <b>{c.to_product}</b> · lý do: {c.reason} · {when(c.created_at)}
              </p>
              <ReviewButtons fn="review_procedure_change" args={{ p_id: c.id }} withNote />
            </div>
          ))}
          {early.map((e) => (
            <div key={`e${e.staff_id}${e.work_date}`} className={item}>
              <p>
                <b>{e.staff?.full_name}</b> chấm vào sớm · {formatShortDate(e.work_date)} · {hhmm(e.check_in)}
              </p>
              <p className="text-xs">
                {e.in_reason_kind}
                {e.in_note ? ` · ${e.in_note}` : ""}
              </p>
              <ReviewButtons fn="review_early_checkin" args={{ p_staff: e.staff_id, p_date: e.work_date }} />
            </div>
          ))}
          {fixes.map((f) => (
            <div key={f.id} className={item}>
              <p>
                <b>{f.staff?.full_name}</b> quên chấm công · {formatShortDate(f.work_date)} · vào {f.check_in?.slice(0, 5) ?? "—"} · ra {f.check_out?.slice(0, 5) ?? "—"}
              </p>
              <p className="text-xs">{f.reason}</p>
              <ReviewButtons fn="review_attendance_fix" args={{ p_id: f.id }} />
            </div>
          ))}
        </Section>
      )}

      {leaves.length > 0 && (
        <Section id="nghi-phep" title="Nghỉ phép" more="/quan-ly/nghi-phep">
          {leaves.map((l) => (
            <div key={l.id} className={item}>
              <p>
                <b>{pname.get(l.staff_id) ?? "?"}</b> · nghỉ {formatShortDate(l.leave_date)}
                {l.half_day ? (l.work_shift === "afternoon" ? " · nửa ngày (chiều)" : " · nửa ngày (sáng)") : ""}
              </p>
              {l.reason && <p className="text-xs">{l.reason}</p>}
              <ReviewButtons fn="review_leave" args={{ p_id: l.id }} />
            </div>
          ))}
        </Section>
      )}

      {confirms.length > 0 && (
        <Section id="con-hang" title="Xác nhận còn hàng (KTV chưa hoàn thành được buổi)" more="/quan-ly/kho/chai-dang-mo">
          <p className="text-xs text-ink/60">Máy báo chi nhánh không còn đủ trong chai đang mở. Nếu thực tế vẫn còn chai, chọn mức còn để KTV hoàn thành buổi.</p>
          {confirms.map((c) => (
            <div key={c.id} className={item}>
              <p>
                <b>{c.requester?.full_name ?? "KTV"}</b> · {c.products ? [c.products.name, c.products.capacity].filter(Boolean).join(" · ") : "?"} · {c.warehouses?.name}
              </p>
              <p className="text-xs">
                Khách {c.appointment_services?.appointments?.customers?.full_name} · {c.appointment_services?.services?.name_en || c.appointment_services?.services?.name} · {when(c.created_at)}
                {c.note ? ` · ${c.note}` : ""}
              </p>
              <StockConfirmReview id={c.id} />
            </div>
          ))}
        </Section>
      )}

      {stockReqs.length > 0 && (
        <Section id="xin-xuat" title="Phiếu xin xuất kho" more="/quan-ly/kho/xin-xuat">
          {stockReqs.map((r) => (
            <RequestCard key={r.id} req={r} branchName={bname.get(r.warehouses?.branch_id ?? "") ?? ""} canReview canCancel={false} compact />
          ))}
        </Section>
      )}

      {counts.length > 0 && (
        <Section id="kiem-kho" title="Kiểm kho bị lệch" more="/quan-ly/kho/kiem-kho">
          {counts.map((c) => {
            const diffs = c.stock_count_items.filter((i) => i.counted_qty !== i.system_qty);
            return (
              <div key={c.id} className={item}>
                <p>
                  {c.kind === "opening" && <span className="mr-1 rounded bg-navy px-1.5 py-0.5 text-[10px] text-white">ĐẦU KỲ</span>}
                  <b>{c.code}</b> · {c.warehouses?.name} · {c.creator?.full_name ?? "?"} · {when(c.created_at)}
                </p>
                {c.note && <p className="text-xs">{c.kind === "opening" ? "Ghi chú" : "Lý do"}: {c.note}</p>}
                {c.kind === "opening" && (
                  <p className="text-xs text-ink/60">
                    Kiểm {c.stock_count_items.length} sản phẩm · {c.stock_count_opened?.length ?? 0} chai đang dở —{" "}
                    <a href="/quan-ly/kho/kiem-kho?loai=dau-ky" className="font-semibold text-navy underline">xem đủ chi tiết</a>
                  </p>
                )}
                <ul className="mt-1 space-y-0.5 text-xs">
                  {diffs.map((i) => (
                    <li key={i.product_id} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {i.products?.name}
                        {i.products?.capacity ? ` · ${i.products.capacity}` : ""}
                      </span>
                      <span className="shrink-0">
                        máy {i.system_qty} → đếm {i.counted_qty}{" "}
                        <b className={i.counted_qty > i.system_qty ? "text-[#22612A]" : "text-[#8A2323]"}>
                          ({i.counted_qty > i.system_qty ? "+" : ""}
                          {i.counted_qty - i.system_qty})
                        </b>
                      </span>
                    </li>
                  ))}
                </ul>
                <CountReview id={c.id} />
              </div>
            );
          })}
        </Section>
      )}

      {receipts.length > 0 && (
        <Section id="nhap-hang" title="Phiếu nhập chờ nhập giá & duyệt">
          {receipts.map((r) => (
            <Link key={r.id} href="/quan-ly/kho/nhap-hang" className={`${item} flex items-center justify-between gap-2 hover:ring-1 hover:ring-[#E0A526]`}>
              <span>
                <b>{r.code}</b> · {r.supplier ?? "NCC"} · {r.warehouses?.name}
                <span className="block text-xs text-ink/60">
                  {r.profiles?.full_name ?? "?"} · {when(r.created_at)} · {r.stock_receipt_items.reduce((a, m) => a + Number(m.quantity), 0)} sản phẩm
                </span>
              </span>
              <span className="shrink-0 font-semibold text-navy">Nhập giá ›</span>
            </Link>
          ))}
          <p className="text-xs text-ink/55">Phiếu nhập cần điền giá mua nên mở ở trang Nhập hàng để duyệt.</p>
        </Section>
      )}

      {posts.length > 0 && (
        <Section id="marketing" title="Bài Marketing chờ duyệt">
          {posts.map((p) => (
            <Link key={p.id} href={`/quan-ly/marketing/bai/${p.id}`} className={`${item} flex items-center justify-between gap-2 hover:ring-1 hover:ring-[#E0A526]`}>
              <span>
                <b>{p.title}</b>
                <span className="block text-xs text-ink/60">
                  {p.publish_date ? `Đăng ${formatShortDate(p.publish_date)}` : "Chưa có ngày đăng"}
                  {p.channels?.length ? ` · ${p.channels.join(", ")}` : ""}
                </span>
              </span>
              <span className="shrink-0 font-semibold text-navy">Xem & duyệt ›</span>
            </Link>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ id, title, more, children }: { id: string; title: string; more?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-24 space-y-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-navy">{title}</h2>
        {more && (
          <Link href={more} className="text-xs text-navy/70 underline">
            Trang đầy đủ
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
