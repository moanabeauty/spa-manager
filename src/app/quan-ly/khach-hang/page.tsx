import Link from "next/link";
import CustomerJump from "./CustomerJump";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatTime, formatVnd, todayVn } from "@/lib/format";
import { CARD_TXN_LABEL, METHOD_LABEL, cardBalance, fetchWallet, isPackageUsable, itemLeft, itemText } from "@/lib/billing";
import { canCheckout } from "@/lib/staff";
import {
  REMINDER_KIND,
  SEGMENTS,
  SEGMENT_BY_KEY,
  daysSince,
  shortDate,
  toCrmCustomer,
  type CrmCustomer,
  type CrmProfile,
  type Group,
} from "@/lib/crm";
import RefundButton from "./RefundButton";
import CrmProfileForm from "./CrmProfileForm";
import MenuUnlockToggle from "./MenuUnlockToggle";
import ReminderActions, { AddReminderForm } from "../cham-soc/ReminderActions";

export const metadata = { title: "Khách hàng – Moana Beauty" };

type Sp = { q?: string; id?: string; seg?: string; nhom?: string; cn?: string };

function SegmentBadges({ segs }: { segs: string[] }) {
  return (
    <>
      {segs.map((s) => {
        const x = SEGMENT_BY_KEY.get(s);
        return x ? (
          <span key={s} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${x.style}`}>
            {x.label}
          </span>
        ) : null;
      })}
    </>
  );
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { supabase, profile } = await getCurrentUser();
  const sp = await searchParams;
  const role = profile?.role;
  if (role === "warehouse") return <p className="card text-sm">Trang này dành cho lễ tân, KTV, quản lý và chủ spa.</p>;
  const q = (sp.q ?? "").trim();
  const checkout = canCheckout(role);
  const manager = role === "owner" || role === "manager";
  const today = todayVn();

  const [{ data: groupData }, { data: branchData }] = await Promise.all([
    supabase.from("customer_groups").select("id, name, color, description, sort_order").order("sort_order").order("name"),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
  ]);
  const groups = (groupData ?? []) as Group[];
  const branches = (branchData ?? []) as { id: string; name: string }[];
  const groupById = new Map(groups.map((g) => [g.id, g]));

  // ---------- Chi tiết 1 khách ----------
  if (sp.id) {
    const [{ data: statRows }, { data: c }, { data: crm }, { data: rems }, { data: visits }] = await Promise.all([
      supabase.rpc("crm_customers", { p_id: sp.id, p_limit: 1 }),
      supabase.from("customers").select("id, code, full_name, phone, email, birthday, gender, note, home_branch_id, created_at").eq("id", sp.id).maybeSingle(),
      supabase.from("customer_crm").select("*").eq("customer_id", sp.id).maybeSingle<CrmProfile>(),
      supabase
        .from("care_reminders")
        .select("id, kind, title, note, due_date, status, result, done_at, doer:profiles!care_reminders_done_by_fkey(full_name)")
        .eq("customer_id", sp.id)
        .order("due_date", { ascending: false })
        .limit(40),
      supabase
        .from("appointments")
        .select(
          "id, start_at, status, branches(name), appointment_services(id, price, customer_package_item_id, services(name), technician:profiles!appointment_services_technician_id_fkey(full_name))",
        )
        .eq("customer_id", sp.id)
        .in("status", ["completed", "no_show", "cancelled"])
        .order("start_at", { ascending: false })
        .limit(40),
    ]);
    if (!c) return <p className="card text-sm">Không tìm thấy khách.</p>;
    const st: CrmCustomer | null = (statRows ?? []).length ? toCrmCustomer((statRows as Record<string, unknown>[])[0]) : null;

    const wallet = await fetchWallet(supabase, c.id);
    const cardIds = wallet.cards.map((x) => x.card_id);
    const [{ data: txns }, { data: invs }, { data: refunds }] = await Promise.all([
      cardIds.length
        ? supabase.from("card_transactions").select("id, txn_type, amount, note, created_at").in("card_id", cardIds).order("created_at", { ascending: false }).limit(30)
        : Promise.resolve({ data: [] }),
      supabase
        .from("invoices")
        .select("id, code, status, paid_at, created_at, invoice_items(amount, description, item_type)")
        .eq("customer_id", c.id)
        .neq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("refunds")
        .select("id, kind, refund_amount, computed_amount, method, reason, created_at")
        .eq("customer_id", c.id)
        .order("created_at", { ascending: false }),
    ]);
    const balance = cardBalance(wallet);
    type Rem = { id: string; kind: string; title: string; note: string | null; due_date: string; status: string; result: string | null; done_at: string | null; doer: { full_name: string | null } | null };
    const reminders = (rems ?? []) as unknown as Rem[];
    const openRems = reminders.filter((r) => r.status === "open").sort((a, b) => a.due_date.localeCompare(b.due_date));
    const doneRems = reminders.filter((r) => r.status !== "open");
    type Visit = {
      id: string;
      start_at: string;
      status: string;
      branches: { name: string } | null;
      appointment_services: { id: string; price: number | null; customer_package_item_id: string | null; services: { name: string } | null; technician: { full_name: string | null } | null }[];
    };
    const visitList = (visits ?? []) as unknown as Visit[];
    type Inv = { id: string; code: string; status: string; paid_at: string | null; created_at: string; invoice_items: { amount: number; description: string | null; item_type: string }[] };
    const invList = (invs ?? []) as Inv[];
    const purchases = invList.filter((i) => i.status === "paid" && i.invoice_items.some((x) => x.item_type === "package" || x.item_type === "card_topup"));
    const idle = daysSince(st?.last_visit ?? null, today);

    return (
      <div className="space-y-4">
        <Link href="/quan-ly/khach-hang" className="text-sm font-semibold text-navy">← Danh sách khách</Link>

        <div className="card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-navy">
                {c.full_name} <span className="ml-1 align-middle font-mono text-sm font-semibold text-brown">{c.code}</span>
              </h1>
              <p className="text-sm text-ink/70">
                {c.phone ? <a href={`tel:${c.phone}`} className="font-medium text-navy underline">{c.phone}</a> : "(chưa có SĐT)"} {c.email && `· ${c.email}`}
              </p>
              <p className="text-xs text-ink/50">
                Khách từ {shortDate(c.created_at)}
                {c.birthday && ` · Sinh nhật ${shortDate(c.birthday).slice(0, 5)}`}
                {c.home_branch_id && ` · ${branches.find((b) => b.id === c.home_branch_id)?.name ?? ""}`}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                <SegmentBadges segs={st?.segments ?? []} />
                {(st?.group_ids ?? []).map((g) => (
                  <span key={g} className="rounded-full px-2 py-0.5 text-[11px] font-medium text-ink" style={{ background: groupById.get(g)?.color }}>
                    {groupById.get(g)?.name}
                  </span>
                ))}
              </div>
              {c.note && <p className="mt-2 rounded-lg bg-[#FFE8BA]/60 px-2 py-1 text-xs">{c.note}</p>}
              {crm?.health_note && <p className="mt-2 rounded-lg bg-[#F6D5D5]/70 px-2 py-1 text-xs"><b>Lưu ý sức khoẻ / dị ứng:</b> {crm.health_note}</p>}
            </div>
            <div className="text-right">
              <p className="text-xs text-ink/60">Số dư thẻ tài khoản</p>
              <p className="text-2xl font-bold text-navy">{wallet.cards.length ? formatVnd(balance) : "Chưa có thẻ"}</p>
              {wallet.cards.length > 0 && <p className="text-xs text-ink/50">Mã thẻ {wallet.cards.map((x) => x.code).join(", ")}</p>}
              {manager && wallet.cards.map((x) => <RefundButton key={x.card_id} kind="card" id={x.card_id} label={`thẻ ${x.code}`} />)}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-beige pt-3 text-center text-sm sm:grid-cols-4">
            <div className="rounded-xl bg-cream p-2">
              <p className="text-xs text-ink/60">Số lần đến</p>
              <p className="font-bold text-navy">{st?.visit_count ?? 0}</p>
            </div>
            <div className="rounded-xl bg-cream p-2">
              <p className="text-xs text-ink/60">Lần cuối</p>
              <p className="font-bold text-navy">{st?.last_visit ? shortDate(st.last_visit) : "—"}</p>
              {idle !== null && <p className="text-[11px] text-ink/50">{idle} ngày trước</p>}
            </div>
            <div className="rounded-xl bg-cream p-2">
              <p className="text-xs text-ink/60">Chi tiêu 12 tháng</p>
              <p className="font-bold text-navy">{formatVnd(st?.spent_12m ?? 0)}</p>
              <p className="text-[11px] text-ink/50">Tổng {formatVnd(st?.spent_total ?? 0)}</p>
            </div>
            <div className="rounded-xl bg-cream p-2">
              <p className="text-xs text-ink/60">Buổi gói còn lại</p>
              <p className="font-bold text-navy">{st?.sessions_left ?? 0}</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-beige pt-3">
            {checkout && <Link href={`/quan-ly/thu-tien?kh=${c.id}`} className="btn-primary py-2">Bán gói / nạp thẻ</Link>}
            {c.phone && <Link href={`/quan-ly/tao-lich?sdt=${c.phone}`} className="btn-outline py-2">Tạo lịch</Link>}
          </div>
          <MenuUnlockToggle
            customerId={c.id}
            fullMenu={!!st?.full_menu}
            manual={!!crm?.menu_unlocked}
            auto={!!st?.has_package || !!st?.has_card}
            canEdit={manager}
          />
        </div>

        <CrmProfileForm
          customer={{
            id: c.id,
            full_name: c.full_name,
            phone: c.phone,
            email: c.email,
            birthday: c.birthday,
            gender: c.gender,
            note: c.note,
            home_branch_id: c.home_branch_id,
          }}
          crm={crm ?? null}
          groups={groups}
          memberOf={st?.group_ids ?? []}
          branches={branches}
        />

        <div className="card">
          <h2 className="mb-2 font-semibold text-navy">Nhắc chăm sóc</h2>
          {openRems.length === 0 && <p className="text-sm text-ink/60">Không có nhắc nào đang mở.</p>}
          <ul className="space-y-2">
            {openRems.map((r) => (
              <li key={r.id} className={`rounded-xl border p-3 text-sm ${r.due_date <= today ? "border-[#E8B4B4] bg-[#FFF6F6]" : "border-beige-dark"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${REMINDER_KIND[r.kind]?.style}`}>{REMINDER_KIND[r.kind]?.label}</span>
                  <span className="text-xs text-ink/60">{r.due_date <= today ? "Đến hạn" : "Hẹn"} {shortDate(r.due_date)}</span>
                </div>
                <p className="mt-1 font-medium">{r.title}</p>
                {r.note && <p className="text-xs text-ink/60">{r.note}</p>}
                <ReminderActions id={r.id} />
              </li>
            ))}
          </ul>
          <AddReminderForm customerId={c.id} />
          {doneRems.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-navy">Lịch sử chăm sóc ({doneRems.length})</summary>
              <ul className="mt-2 divide-y divide-beige text-sm">
                {doneRems.map((r) => (
                  <li key={r.id} className="py-2">
                    <span className="text-ink/50">{shortDate(r.done_at ?? r.due_date)}</span>{" "}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${REMINDER_KIND[r.kind]?.style}`}>{REMINDER_KIND[r.kind]?.label}</span>{" "}
                    {r.title}
                    <span className="block text-xs text-ink/60">
                      {r.status === "skipped" ? "Bỏ qua" : "Xong"}
                      {r.result && `: ${r.result}`}
                      {r.doer?.full_name && ` · ${r.doer.full_name}`}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="card">
          <h2 className="mb-2 font-semibold text-navy">Lịch sử dịch vụ</h2>
          {visitList.length === 0 && <p className="text-sm text-ink/60">Khách chưa có lượt đến nào.</p>}
          <ul className="divide-y divide-beige text-sm">
            {visitList.map((v) => (
              <li key={v.id} className={`py-2 ${v.status === "completed" ? "" : "opacity-60"}`}>
                <p className="text-ink/60">
                  {shortDate(v.start_at)} {formatTime(v.start_at)} · {v.branches?.name.replace("Moana ", "")}
                  {v.status === "no_show" && <span className="ml-1 text-[#8A2323]">· Không đến</span>}
                  {v.status === "cancelled" && <span className="ml-1">· Đã huỷ</span>}
                </p>
                <ul>
                  {v.appointment_services.map((s) => (
                    <li key={s.id} className="flex justify-between gap-3">
                      <span>
                        {s.services?.name ?? "Dịch vụ"}
                        {s.customer_package_item_id && <span className="ml-1 rounded bg-[#D6EDD8] px-1 text-[10px] text-[#22612A]">trừ gói</span>}
                      </span>
                      <span className="shrink-0 text-xs text-ink/60">{s.technician?.full_name ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h2 className="mb-2 font-semibold text-navy">Gói combo</h2>
          {wallet.packages.length === 0 && <p className="text-sm text-ink/60">Khách chưa mua gói nào.</p>}
          <div className="space-y-3">
            {wallet.packages.map((p) => {
              const usable = isPackageUsable(p);
              const left = p.items.reduce((a, i) => a + itemLeft(i), 0);
              return (
                <div key={p.id} className={`rounded-xl border border-beige-dark p-3 text-sm ${usable && left > 0 ? "" : "opacity-60"}`}>
                  <div className="flex justify-between gap-2">
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-xs text-ink/60">
                      Mua {shortDate(p.purchased_at)}
                      {p.expires_at && ` · hạn ${shortDate(p.expires_at)}`}
                      {!p.is_active ? " · đã huỷ" : !usable ? " · hết hạn" : left === 0 ? " · đã dùng hết" : ""}
                    </p>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {p.items.map((i) => (
                      <li key={i.id} className="flex justify-between gap-3">
                        <span>
                          {i.label}
                          {i.services.length > 1 && <span className="block text-xs text-ink/50">{i.services.map((x) => x.name).join(", ")}</span>}
                        </span>
                        <span className="shrink-0">{itemText(i)}</span>
                      </li>
                    ))}
                  </ul>
                  {manager && p.is_active && left > 0 && (
                    <div className="mt-2 text-right">
                      <RefundButton kind="package" id={p.id} label={`gói ${p.name}`} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {purchases.length > 0 && (
          <div className="card">
            <h2 className="mb-2 font-semibold text-navy">Lịch sử mua gói / nạp thẻ</h2>
            <ul className="divide-y divide-beige text-sm">
              {purchases.map((i) =>
                i.invoice_items
                  .filter((x) => x.item_type === "package" || x.item_type === "card_topup")
                  .map((x, k) => (
                    <li key={`${i.id}-${k}`} className="flex justify-between gap-3 py-1.5">
                      <span>
                        <span className="text-ink/50">{shortDate(i.paid_at ?? i.created_at)}</span> {x.item_type === "package" ? "Mua gói" : "Nạp thẻ"}: {x.description}
                      </span>
                      <span className="shrink-0 font-medium">{formatVnd(Number(x.amount))}</span>
                    </li>
                  )),
              )}
            </ul>
          </div>
        )}

        {wallet.cards.length > 0 && (
          <div className="card">
            <h2 className="mb-2 font-semibold text-navy">Lịch sử thẻ tài khoản</h2>
            <ul className="divide-y divide-beige text-sm">
              {(txns ?? []).map((t: { id: string; txn_type: string; amount: number; note: string | null; created_at: string }) => (
                <li key={t.id} className="flex justify-between gap-3 py-1.5">
                  <span>
                    <span className="text-ink/50">{shortDate(t.created_at)} {formatTime(t.created_at)}</span> {CARD_TXN_LABEL[t.txn_type] ?? t.txn_type}
                    {t.note && <span className="text-xs text-ink/50"> · {t.note}</span>}
                  </span>
                  <span className={`shrink-0 font-medium ${Number(t.amount) < 0 ? "text-[#8A2323]" : "text-[#22612A]"}`}>
                    {Number(t.amount) > 0 ? "+" : ""}
                    {formatVnd(Number(t.amount))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(refunds ?? []).length > 0 && (
          <div className="card">
            <h2 className="mb-2 font-semibold text-navy">Đã huỷ & hoàn tiền</h2>
            <ul className="divide-y divide-beige text-sm">
              {((refunds ?? []) as { id: string; kind: string; refund_amount: number; method: string; reason: string; created_at: string }[]).map((r) => (
                <li key={r.id} className="flex justify-between gap-3 py-1.5">
                  <span>
                    <span className="text-ink/50">{shortDate(r.created_at)}</span> Huỷ {r.kind === "card" ? "thẻ nạp sẵn" : "gói combo"}
                    <span className="text-xs text-ink/50"> · {r.reason}</span>
                  </span>
                  <span className="shrink-0 font-medium text-[#8A2323]">−{formatVnd(Number(r.refund_amount))} ({METHOD_LABEL[r.method]})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="card">
          <h2 className="mb-2 font-semibold text-navy">Hoá đơn</h2>
          {invList.length === 0 && <p className="text-sm text-ink/60">Chưa có hoá đơn.</p>}
          <ul className="divide-y divide-beige text-sm">
            {invList.map((i) => (
              <li key={i.id}>
                <Link href={`/quan-ly/hoa-don/${i.id}`} className="flex justify-between gap-3 py-2 hover:bg-cream">
                  <span className="min-w-0">
                    <span className="text-ink/50">{shortDate(i.paid_at ?? i.created_at)}</span> {i.code}
                    <span className="block truncate text-xs text-ink/60">{i.invoice_items.map((x) => x.description).join(", ")}</span>
                  </span>
                  <span className="shrink-0">
                    {i.status === "cancelled" ? <span className="text-xs text-[#8A2323]">Đã huỷ</span> : formatVnd(i.invoice_items.reduce((a, x) => a + Number(x.amount), 0))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  // ---------- Danh sách + lọc ----------
  const seg = sp.seg && SEGMENT_BY_KEY.has(sp.seg) ? sp.seg : null;
  const grp = sp.nhom && groupById.has(sp.nhom) ? sp.nhom : null;
  const cn = sp.cn && branches.some((b) => b.id === sp.cn) ? sp.cn : null;
  const { data: rows, error } = await supabase.rpc("crm_customers", {
    p_q: q || null,
    p_segment: seg,
    p_group: grp,
    p_branch: cn,
    p_limit: 300,
  });
  const list = ((rows ?? []) as Record<string, unknown>[]).map(toCrmCustomer);
  const link = (patch: Partial<Sp>) => {
    const p = new URLSearchParams();
    const merged = { q: q || undefined, seg: seg ?? undefined, nhom: grp ?? undefined, cn: cn ?? undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/quan-ly/khach-hang${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-bold text-navy">Khách hàng</h1>
        <div className="flex gap-2">
          <Link href="/quan-ly/cham-soc" className="btn-outline py-2">Chăm sóc lại</Link>
          {manager && <Link href="/quan-ly/khach-hang/nhom" className="btn-ghost py-2">Nhóm & cài đặt</Link>}
        </div>
      </div>

      <CustomerJump />

      <form action="/quan-ly/khach-hang" className="card space-y-3 p-3">
        <div className="flex gap-2">
          <input name="q" defaultValue={q} className="input py-2" placeholder="Lọc danh sách theo SĐT, mã KH hoặc tên" />
          <button className="btn-primary shrink-0">Tìm</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select name="nhom" defaultValue={grp ?? ""} className="input py-2 text-sm">
            <option value="">Mọi nhóm khách</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <select name="cn" defaultValue={cn ?? ""} className="input py-2 text-sm">
            <option value="">Cả 2 chi nhánh</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        {seg && <input type="hidden" name="seg" value={seg} />}
      </form>

      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        <Link href={link({ seg: undefined })} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${!seg ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}>
          Tất cả
        </Link>
        {SEGMENTS.map((s) => (
          <Link
            key={s.key}
            href={link({ seg: s.key })}
            title={s.hint}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${seg === s.key ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {error && <p className="card text-sm text-[#8A2323]">{error.message}</p>}
      <div className="card p-0">
        <p className="border-b border-beige px-4 py-2 text-xs text-ink/60">
          {list.length} khách{list.length >= 300 ? " (hiện 300 khách gần nhất, gõ tên / SĐT để tìm thêm)" : ""}
        </p>
        {list.length === 0 && <p className="p-4 text-sm text-ink/60">Không có khách phù hợp.</p>}
        <ul className="divide-y divide-beige">
          {list.map((c) => (
            <li key={c.id}>
              <Link href={`/quan-ly/khach-hang?id=${c.id}`} className="block px-4 py-3 text-sm hover:bg-cream">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">
                    {c.full_name}
                    {c.open_reminders > 0 && <span className="ml-1 rounded-full bg-[#F6D5D5] px-1.5 text-[10px] text-[#8A2323]">{c.open_reminders} nhắc</span>}
                  </span>
                  <span className="shrink-0 text-ink/60">{c.phone}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <SegmentBadges segs={c.segments} />
                  {c.group_ids.map((g) => (
                    <span key={g} className="rounded-full px-2 py-0.5 text-[11px] text-ink" style={{ background: groupById.get(g)?.color }}>
                      {groupById.get(g)?.name}
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-xs text-ink/50">
                  {c.visit_count} lần đến · lần cuối {c.last_visit ? shortDate(c.last_visit) : "—"} · 12 tháng {formatVnd(c.spent_12m)}
                  {c.sessions_left > 0 && ` · còn ${c.sessions_left} buổi`}
                  {c.card_balance > 0 && ` · thẻ ${formatVnd(c.card_balance)}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
