import { getCurrentUser, isStaffRole } from "@/lib/supabase/server";
import { formatShortDate, formatTime, formatVnd } from "@/lib/format";
import { CASH_METHOD_LABEL } from "@/lib/reports";
import VoucherForm, { VoucherReview } from "./VoucherForm";

export const metadata = { title: "Thu chi tiền mặt tại spa – Moana Beauty" };

type Voucher = {
  id: string; code: string | null; kind: string; amount: number; method: string; description: string | null;
  status: string; review_note: string | null; created_at: string; branch_id: string | null;
  cashbook_categories: { name: string } | null;
  creator: { full_name: string | null } | null;
};
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Chờ duyệt", cls: "text-[#7A5600]" },
  approved: { label: "Đã duyệt", cls: "text-[#22612A]" },
  rejected: { label: "Từ chối", cls: "text-[#8A2323]" },
};

export default async function VoucherPage() {
  const { supabase, profile } = await getCurrentUser();
  if (!isStaffRole(profile?.role)) return <p className="card text-sm">Trang dành cho nhân viên.</p>;
  const manage = profile!.role === "owner" || profile!.role === "manager";
  const [{ data: branches }, { data: cats }, { data }] = await Promise.all([
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    supabase.from("cashbook_categories").select("id, kind, name").eq("is_active", true).eq("counter", true).order("sort_order"),
    supabase
      .from("cashbook_entries")
      .select("id, code, kind, amount, method, description, status, review_note, created_at, branch_id, cashbook_categories(name), creator:profiles!cashbook_entries_created_by_fkey(full_name)")
      .eq("source", "counter")
      .order("created_at", { ascending: false })
      .limit(80),
  ]);
  const rows = (data ?? []) as unknown as Voucher[];
  const pending = rows.filter((r) => r.status === "pending");
  const others = manage ? rows.filter((r) => r.status !== "pending") : rows;
  const bname = (id: string | null) => (branches ?? []).find((b) => b.id === id)?.name.replace("Moana ", "") ?? "";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Thu chi tiền mặt tại spa</h1>
        <p className="text-sm text-ink/70">
          Ghi các khoản tiền mặt thu / chi lặt vặt tại quầy: tiền ship, mua dụng cụ, đồ dùng… {manage ? "Phiếu của quản lý / chủ spa được duyệt luôn." : "Chủ spa / quản lý duyệt xong mới vào sổ thu chi."}
        </p>
      </div>
      <VoucherForm
        branches={(branches ?? []) as { id: string; name: string }[]}
        categories={(cats ?? []) as { id: string; kind: "income" | "expense"; name: string }[]}
        defaultBranch={profile!.branch_id ?? branches?.[0]?.id ?? ""}
      />

      {manage && pending.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-semibold text-navy">Chờ duyệt ({pending.length})</h2>
          {pending.map((v) => (
            <div key={v.id} className="card border-l-4 border-l-[#E0A526] p-4 text-sm">
              <Line v={v} bname={bname} />
              <VoucherReview id={v.id} />
            </div>
          ))}
        </div>
      )}

      <div className="card p-0">
        <p className="px-4 pt-3 text-sm font-semibold text-navy">{manage ? "Phiếu gần đây" : "Phiếu của tôi"}</p>
        {others.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink/60">Chưa có phiếu nào.</p>
        ) : (
          <ul className="divide-y divide-beige">
            {others.map((v) => (
              <li key={v.id} className="px-4 py-2 text-sm">
                <Line v={v} bname={bname} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Line({ v, bname }: { v: Voucher; bname: (id: string | null) => string }) {
  const st = STATUS[v.status];
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p>
          <b>{v.kind === "income" ? "Phiếu thu" : "Phiếu chi"}</b> · {v.cashbook_categories?.name}
          {v.description && <> · {v.description}</>}
        </p>
        <p className="text-xs text-ink/55">
          {v.code} · {formatShortDate(v.created_at)} {formatTime(v.created_at)} · {bname(v.branch_id)} · {v.creator?.full_name ?? "?"} ·{" "}
          {CASH_METHOD_LABEL[v.method] ?? v.method}
          {v.review_note && ` · ${v.review_note}`}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className={v.kind === "income" ? "font-semibold text-[#22612A]" : "font-semibold text-[#8A2323]"}>
          {v.kind === "income" ? "+" : "−"}
          {formatVnd(Number(v.amount))}
        </p>
        <p className={`text-xs font-semibold ${st?.cls}`}>{st?.label}</p>
      </div>
    </div>
  );
}
