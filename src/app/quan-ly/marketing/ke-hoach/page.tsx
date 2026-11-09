import Link from "next/link";
import { formatTime, todayVn, vnDateTime } from "@/lib/format";
import { addDays, monthLabel, shiftMonth, vnDayOf } from "@/lib/calendar";
import { PLAN_COLS, PLAN_KIND, PLAN_STATUS, dayLabel, isYm, lastDay, personName, type MkPlan } from "@/lib/marketing";
import { DENIED_TEXT, loadMarketingContext } from "../shared";

export const metadata = { title: "Quay · chụp · họp – Marketing" };

export default async function PlansPage({ searchParams }: { searchParams: Promise<{ thang?: string }> }) {
  const ctx = await loadMarketingContext();
  if (!ctx.allowed) return <p className="card text-sm">{DENIED_TEXT}</p>;
  const { supabase, people } = ctx;
  const sp = await searchParams;
  const today = todayVn();
  const month = isYm(sp.thang) ? sp.thang : today.slice(0, 7);
  const from = vnDateTime(`${month}-01`, "00:00").toISOString();
  const to = vnDateTime(addDays(lastDay(month), 1), "00:00").toISOString();

  const [{ data }, { data: counts }] = await Promise.all([
    supabase.from("marketing_plans").select(PLAN_COLS).gte("start_at", from).lt("start_at", to).order("start_at"),
    supabase.from("marketing_comments").select("plan_id").not("plan_id", "is", null),
  ]);
  const plans = (data ?? []) as MkPlan[];
  const talk = new Map<string, number>();
  for (const c of (counts ?? []) as { plan_id: string }[]) talk.set(c.plan_id, (talk.get(c.plan_id) ?? 0) + 1);

  const groups = new Map<string, MkPlan[]>();
  for (const p of plans) {
    const d = vnDayOf(p.start_at);
    groups.set(d, [...(groups.get(d) ?? []), p]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-navy">Quay · chụp · họp content</h1>
          <p className="text-sm text-ink/70">Lên kế hoạch nội bộ và trao đổi ngay trên từng buổi.</p>
        </div>
        <Link href="/quan-ly/marketing/ke-hoach/moi" className="btn-primary py-2">+ Kế hoạch</Link>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <span className="text-sm font-semibold text-navy">{monthLabel(month)}</span>
        <Link href={`/quan-ly/marketing/ke-hoach?thang=${shiftMonth(month, -1)}`} className="btn-ghost">‹ Trước</Link>
        <Link href={`/quan-ly/marketing/ke-hoach?thang=${shiftMonth(month, 1)}`} className="btn-ghost">Sau ›</Link>
        {month !== today.slice(0, 7) && <Link href="/quan-ly/marketing/ke-hoach" className="btn-ghost">Tháng này</Link>}
      </div>

      {plans.length === 0 && <p className="card text-center text-sm text-ink/60">Tháng này chưa có lịch quay / chụp / họp.</p>}

      {[...groups.entries()].map(([d, list]) => (
        <div key={d} className={`card p-0 ${d === today ? "ring-2 ring-navy" : ""} ${d < today ? "opacity-80" : ""}`}>
          <p className="border-b border-beige px-4 py-2 text-sm font-semibold capitalize text-navy">
            {dayLabel(d)}{d === today && " · hôm nay"}
          </p>
          <ul className="divide-y divide-beige">
            {list.map((p) => {
              const k = PLAN_KIND[p.kind] ?? PLAN_KIND.other;
              const s = PLAN_STATUS[p.status] ?? PLAN_STATUS.planned;
              const n = talk.get(p.id) ?? 0;
              return (
                <li key={p.id}>
                  <Link href={`/quan-ly/marketing/ke-hoach/${p.id}`} className="flex items-start justify-between gap-2 px-4 py-2.5 hover:bg-cream">
                    <span className="min-w-0">
                      <span className={`block font-medium ${p.status === "cancelled" ? "text-ink/40 line-through" : ""}`}>
                        {k.icon} {p.title}
                      </span>
                      <span className="block text-xs text-ink/60">
                        <span className={`mr-1 rounded px-1.5 font-semibold ${k.c}`}>{k.t}</span>
                        {formatTime(p.start_at)}{p.end_at && `–${formatTime(p.end_at)}`}
                        {p.location && ` · 📍 ${p.location}`} · 👤 {personName(people, p.pic_id)}
                        {n > 0 && ` · 💬 ${n}`}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.c}`}>{s.t}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
