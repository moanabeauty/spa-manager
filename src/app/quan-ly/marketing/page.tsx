import Link from "next/link";
import { todayVn, vnDateTime } from "@/lib/format";
import { shiftMonth, monthLabel, addDays } from "@/lib/calendar";
import { POST_COLS, PLAN_COLS, isYm, lastDay, type MkPlan, type MkPost } from "@/lib/marketing";
import { DENIED_TEXT, loadMarketingContext } from "./shared";
import MarketingBoard from "./MarketingBoard";

export const metadata = { title: "Marketing – Moana Beauty" };

export default async function MarketingPage({ searchParams }: { searchParams: Promise<{ thang?: string }> }) {
  const ctx = await loadMarketingContext();
  if (!ctx.allowed) return <p className="card text-sm">{DENIED_TEXT}</p>;
  const { supabase, profile, people } = ctx;
  const sp = await searchParams;
  const today = todayVn();
  const month = isYm(sp.thang) ? sp.thang : today.slice(0, 7);
  const from = `${month}-01`;
  const to = lastDay(month);
  const isOwner = profile.role === "owner";

  const [{ data: posts }, { data: plans }, { data: inbox }] = await Promise.all([
    supabase
      .from("marketing_posts")
      .select(POST_COLS)
      .or(
        `and(publish_date.gte.${from},publish_date.lte.${to}),and(due_date.gte.${from},due_date.lte.${to}),and(publish_date.is.null,due_date.is.null,status.not.in.(published,cancelled))`,
      )
      .order("publish_date", { nullsFirst: false })
      .order("due_date", { nullsFirst: false }),
    supabase
      .from("marketing_plans")
      .select(PLAN_COLS)
      .gte("start_at", vnDateTime(from, "00:00").toISOString())
      .lt("start_at", vnDateTime(addDays(to, 1), "00:00").toISOString())
      .order("start_at"),
    // chủ: bài chờ duyệt · Marketing: bài cần sửa (mọi tháng)
    supabase
      .from("marketing_posts")
      .select(POST_COLS)
      .eq("status", isOwner ? "review" : "revise")
      .order("publish_date", { nullsFirst: false }),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-navy">Lịch bài viết</h1>
          <p className="text-sm text-ink/70">Timeline bài trong tháng: người phụ trách, deadline nộp, ngày đăng.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/quan-ly/marketing/ke-hoach/moi" className="btn-outline py-2">+ Quay / chụp / họp</Link>
          <Link href="/quan-ly/marketing/bai/moi" className="btn-primary py-2">+ Bài viết</Link>
        </div>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <span className="text-sm font-semibold text-navy">{monthLabel(month)}</span>
        <Link href={`/quan-ly/marketing?thang=${shiftMonth(month, -1)}`} className="btn-ghost">‹ Trước</Link>
        <Link href={`/quan-ly/marketing?thang=${shiftMonth(month, 1)}`} className="btn-ghost">Sau ›</Link>
        {month !== today.slice(0, 7) && <Link href="/quan-ly/marketing" className="btn-ghost">Tháng này</Link>}
      </div>

      <MarketingBoard
        key={month}
        month={month}
        today={today}
        me={profile.id}
        isOwner={isOwner}
        people={people}
        posts={(posts ?? []) as MkPost[]}
        plans={(plans ?? []) as MkPlan[]}
        inbox={(inbox ?? []) as MkPost[]}
      />
    </div>
  );
}
