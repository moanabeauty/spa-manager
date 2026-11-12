import { activeBranches } from "@/lib/refData";
import Link from "next/link";
import { isDate } from "@/lib/reports";
import { DENIED_TEXT, loadMarketingContext } from "../../shared";
import PlanForm from "../PlanForm";

export const metadata = { title: "Kế hoạch mới – Marketing" };

export default async function NewPlanPage({ searchParams }: { searchParams: Promise<{ ngay?: string }> }) {
  const ctx = await loadMarketingContext();
  if (!ctx.allowed) return <p className="card text-sm">{DENIED_TEXT}</p>;
  const sp = await searchParams;
  const { data: branches } = await activeBranches();
  return (
    <div className="space-y-4">
      <div>
        <Link href="/quan-ly/marketing/ke-hoach" className="text-sm text-navy underline">‹ Quay · chụp · họp</Link>
        <h1 className="text-2xl font-bold text-navy">Kế hoạch mới</h1>
      </div>
      <PlanForm
        plan={null}
        people={ctx.people}
        me={ctx.profile.id}
        isOwner={ctx.profile.role === "owner"}
        defaultDate={isDate(sp.ngay) ? sp.ngay : ""}
        places={((branches ?? []) as { name: string }[]).map((b) => b.name)}
      />
    </div>
  );
}
