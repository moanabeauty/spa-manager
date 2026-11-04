"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatShortDate, formatVnd, todayVn, vnError } from "@/lib/format";

export type Lapsed = {
  customer_id: string; full_name: string; phone: string | null; last_visit: string; days_since: number; last_services: string | null;
  last_branch_id: string | null; visit_count: number; sessions_left: number; card_balance: number; next_appointment: string | null;
  open_reminder_id: string | null;
};

// nhóm theo số tuần chưa quay lại (tính từ lần làm dịch vụ gần nhất)
export const WEEK_GROUPS = [
  { key: "1", label: "1 tuần", min: 7, max: 13 },
  { key: "2", label: "2 tuần", min: 14, max: 27 },
  { key: "4", label: "4 tuần", min: 28, max: 55 },
  { key: "8", label: "8 tuần", min: 56, max: 83 },
  { key: "12", label: "12 tuần trở lên", min: 84, max: 100000 },
];

export default function LapsedList({ rows, branches, cn, week, showBooked }: {
  rows: Lapsed[]; branches: { id: string; name: string }[]; cn: string; week: string; showBooked: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const g = WEEK_GROUPS.find((x) => x.key === week) ?? WEEK_GROUPS[0];
  const visible = rows.filter((r) => showBooked || !r.next_appointment);
  const counts = WEEK_GROUPS.map((x) => visible.filter((r) => r.days_since >= x.min && r.days_since <= x.max).length);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return visible
      .filter((r) => r.days_since >= g.min && r.days_since <= g.max)
      .filter((r) => !t || r.full_name.toLowerCase().includes(t) || (r.phone ?? "").includes(t));
  }, [visible, g, q]);
  const link = (p: Record<string, string>) =>
    `/quan-ly/cham-soc?${new URLSearchParams({ tab: "chua-quay-lai", tuan: week, ...(cn ? { cn } : {}), ...(showBooked ? { lich: "1" } : {}), ...p }).toString()}`;
  const bname = (id: string | null) => branches.find((b) => b.id === id)?.name.replace("Moana ", "") ?? "";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-5 gap-1.5">
        {WEEK_GROUPS.map((x, i) => (
          <Link
            key={x.key}
            href={link({ tuan: x.key })}
            className={`rounded-xl px-1 py-2 text-center ${x.key === g.key ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}
          >
            <span className="block text-lg font-bold leading-tight">{counts[i]}</span>
            <span className="block text-[11px] leading-tight">{x.label}</span>
          </Link>
        ))}
      </div>
      <div className="card flex flex-wrap items-center gap-2 p-3 text-sm">
        <select
          className="input w-auto py-2 text-sm"
          value={cn || "all"}
          onChange={(e) => router.push(link({ cn: e.target.value === "all" ? "all" : e.target.value }))}
        >
          <option value="all">Cả 2 chi nhánh</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input className="input min-w-0 flex-1 py-2 text-sm" placeholder="Tìm tên / SĐT" value={q} onChange={(e) => setQ(e.target.value)} />
        <Link href={link({ lich: showBooked ? "" : "1" })} className="text-xs text-navy underline">
          {showBooked ? "Ẩn khách đã có lịch hẹn sắp tới" : "Hiện cả khách đã đặt lịch sắp tới"}
        </Link>
      </div>
      <p className="text-xs text-ink/60">
        Khách có lần làm dịch vụ gần nhất cách đây {g.label}
        {g.max < 1000 ? ` (${g.min}–${g.max} ngày)` : ` (từ ${g.min} ngày)`}. {list.length} khách.
      </p>
      {list.length === 0 && <p className="card text-sm text-ink/60">Không có khách nào trong nhóm này.</p>}
      <ul className="space-y-2">
        {list.map((r) => (
          <li key={r.customer_id} className="card p-4 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link href={`/quan-ly/khach-hang?id=${r.customer_id}`} className="font-semibold text-navy underline-offset-2 hover:underline">
                {r.full_name}
              </Link>
              {r.phone && (
                <a href={`tel:${r.phone}`} className="rounded-full bg-[#D6EDD8] px-3 py-1 text-sm font-semibold text-[#22612A]">📞 {r.phone}</a>
              )}
            </div>
            <p className="mt-1 text-xs text-ink/65">
              Lần cuối {formatShortDate(`${r.last_visit}T12:00:00+07:00`)} ({r.days_since} ngày) · {bname(r.last_branch_id)} · {r.visit_count} lần đến
            </p>
            {r.last_services && <p className="text-xs text-ink/65">Làm: {r.last_services}</p>}
            <p className="mt-1 flex flex-wrap gap-1 text-xs">
              {r.sessions_left > 0 && <span className="rounded-full bg-[#DCE3F5] px-2 py-0.5 text-navy">Còn {r.sessions_left} buổi gói</span>}
              {Number(r.card_balance) > 0 && <span className="rounded-full bg-[#DCE3F5] px-2 py-0.5 text-navy">Thẻ còn {formatVnd(Number(r.card_balance))}</span>}
              {r.next_appointment && <span className="rounded-full bg-[#D6EDD8] px-2 py-0.5 text-[#22612A]">Đã có lịch {formatShortDate(r.next_appointment)}</span>}
            </p>
            <CallLog customerId={r.customer_id} name={r.full_name} phone={r.phone} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CallLog({ customerId, name, phone }: { customerId: string; name: string; phone: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("add_care_reminder", {
      p_customer: customerId, p_due: todayVn(), p_title: `Gọi mời ${name} quay lại`, p_note: note.trim() || null, p_done: true,
    });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    setDone(true);
    setOpen(false);
    router.refresh();
  }
  return (
    <div className="mt-2 text-xs">
      <div className="flex flex-wrap gap-2">
        {phone && <Link href={`/quan-ly/tao-lich?sdt=${phone}`} className="btn-outline px-3 py-1.5">Tạo lịch hẹn</Link>}
        {!done ? (
          <button className="btn-ghost px-3 py-1.5" onClick={() => setOpen(!open)}>Ghi lại cuộc gọi</button>
        ) : (
          <span className="self-center text-[#22612A]">✓ Đã ghi cuộc gọi</span>
        )}
      </div>
      {open && (
        <div className="mt-2 flex gap-2">
          <input className="min-w-0 flex-1 rounded-lg border border-beige-dark px-2 py-1.5" placeholder="Kết quả: hẹn thứ 7, bận, không nghe…" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn-primary px-3 py-1.5" disabled={busy} onClick={save}>Lưu</button>
        </div>
      )}
      {error && <p className="mt-1 text-[#8A2323]">{error}</p>}
    </div>
  );
}
