import { activeBranches } from "@/lib/refData";
import Link from "next/link";
import { PLAN_COLS, PLAN_KIND, PLAN_STATUS, type MkPlan } from "@/lib/marketing";
import { vnDayOf } from "@/lib/calendar";
import { DENIED_TEXT, loadMarketingContext } from "../../shared";
import PlanForm from "../PlanForm";
import CommentThread, { type MkComment } from "../../CommentThread";

export const metadata = { title: "Kế hoạch – Marketing" };

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await loadMarketingContext();
  if (!ctx.allowed) return <p className="card text-sm">{DENIED_TEXT}</p>;
  const { supabase, profile, people } = ctx;
  const { id } = await params;
  const [{ data: plan }, { data: comments }, { data: branches }] = await Promise.all([
    supabase.from("marketing_plans").select(PLAN_COLS).eq("id", id).maybeSingle<MkPlan>(),
    supabase.from("marketing_comments").select("id, author_id, body, created_at").eq("plan_id", id).order("created_at"),
    activeBranches(),
  ]);
  if (!plan) return <p className="card text-sm">Không tìm thấy kế hoạch (có thể đã bị xoá).</p>;
  const k = PLAN_KIND[plan.kind] ?? PLAN_KIND.other;
  const s = PLAN_STATUS[plan.status] ?? PLAN_STATUS.planned;
  const isOwner = profile.role === "owner";

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/quan-ly/marketing/ke-hoach?thang=${vnDayOf(plan.start_at).slice(0, 7)}`} className="text-sm text-navy underline">
          ‹ Quay · chụp · họp
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-navy">{k.icon} {plan.title}</h1>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${s.c}`}>{s.t}</span>
        </div>
      </div>
      <PlanForm
        plan={plan}
        people={people}
        me={profile.id}
        isOwner={isOwner}
        defaultDate=""
        places={((branches ?? []) as { name: string }[]).map((b) => b.name)}
      />
      <CommentThread target="plan" id={plan.id} comments={(comments ?? []) as MkComment[]} people={people} me={profile.id} isOwner={isOwner} />
    </div>
  );
}
