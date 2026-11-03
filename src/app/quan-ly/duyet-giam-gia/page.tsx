import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatTime, formatVnd } from "@/lib/format";
import ReviewButtons from "./ReviewButtons";

export const metadata = { title: "Duyệt giảm giá – Moana Beauty" };

type Req = {
  id: string;
  amount: number;
  reason: string;
  status: string;
  review_note: string | null;
  created_at: string;
  appointment_id: string | null;
  invoice_id: string | null;
  branches: { name: string } | null;
  customers: { id: string; full_name: string; phone: string | null } | null;
  requester: { full_name: string | null } | null;
};

const STATUS: Record<string, string> = { approved: "Đã duyệt", rejected: "Từ chối", used: "Đã dùng" };

function shortDate(iso: string) {
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit" }).format(new Date(iso));
}

export default async function DiscountApprovalPage() {
  const { supabase, profile } = await getCurrentUser();
  if (profile?.role !== "owner" && profile?.role !== "manager") {
    return <p className="card text-sm">Trang dành cho chủ spa.</p>;
  }
  const { data } = await supabase
    .from("discount_requests")
    .select(
      "id, amount, reason, status, review_note, created_at, appointment_id, invoice_id, branches(name), customers(id, full_name, phone), requester:profiles!discount_requests_requested_by_fkey(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(60);
  const rows = (data ?? []) as unknown as Req[];
  const pending = rows.filter((r) => r.status === "pending");
  const done = rows.filter((r) => r.status !== "pending");
  const isOwner = profile?.role === "owner";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Duyệt giảm giá</h1>
        <p className="text-sm text-ink/70">Lễ tân / KTV xin giảm giá cho khách, chủ spa duyệt rồi mới thu được.</p>
      </div>
      {pending.length === 0 && <p className="card text-sm text-ink/60">Không có yêu cầu nào đang chờ.</p>}
      {pending.map((r) => (
        <div key={r.id} className="card border-l-4 border-l-[#E0A526] p-4 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-lg font-bold text-navy">Giảm {formatVnd(Number(r.amount))}</p>
              <p>Lý do: {r.reason}</p>
              <p className="text-xs text-ink/60">
                {r.requester?.full_name ?? "?"} xin lúc {formatTime(r.created_at)} {shortDate(r.created_at)} · {r.branches?.name}
              </p>
            </div>
            {r.customers && (
              <Link href={`/quan-ly/khach-hang?id=${r.customers.id}`} className="text-right text-navy underline">
                {r.customers.full_name}
                <span className="block text-xs text-ink/60">{r.customers.phone}</span>
              </Link>
            )}
          </div>
          {isOwner ? <ReviewButtons id={r.id} amount={Number(r.amount)} /> : <p className="mt-2 text-xs text-ink/60">Chờ chủ spa duyệt.</p>}
        </div>
      ))}

      {done.length > 0 && (
        <div className="card p-0">
          <p className="px-4 pt-3 text-sm font-semibold text-navy">Đã xử lý gần đây</p>
          <ul className="divide-y divide-beige text-sm">
            {done.map((r) => (
              <li key={r.id} className="flex justify-between gap-3 px-4 py-2">
                <span className="min-w-0">
                  <span className="text-ink/50">{shortDate(r.created_at)}</span> {r.customers?.full_name ?? "Khách lẻ"} · {r.reason}
                  <span className="block text-xs text-ink/50">
                    {r.requester?.full_name}
                    {r.review_note ? ` · ${r.review_note}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {formatVnd(Number(r.amount))}
                  <span className={`block text-xs ${r.status === "rejected" ? "text-[#8A2323]" : "text-[#22612A]"}`}>
                    {r.invoice_id ? <Link href={`/quan-ly/hoa-don/${r.invoice_id}`} className="underline">{STATUS[r.status]}</Link> : STATUS[r.status]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
