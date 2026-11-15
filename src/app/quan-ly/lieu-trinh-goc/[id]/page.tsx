import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatVnd } from "@/lib/format";
import ServiceGuideSections, { type ServiceGuide } from "@/components/ServiceGuideSections";
import BackLink from "./BackLink";

export const metadata = { title: "Hướng dẫn liệu trình – Moana Beauty" };

type Service = {
  id: string;
  name: string;
  name_en: string | null;
  price: number | null;
  member_price: number | null;
  duration_minutes: number | null;
  service_categories: { name: string } | null;
};
type StepCost = { step_no: number; product_name: string; qty: number; unit: string; avg_cost: number | null; cost: number | null };
type Step = { step_no: number; title: string; products: string[]; instructions: string | null; note: string | null };

/** Mở từ ô tìm kiếm: Chỉ định · Chỉ định mở rộng & cơ chế · Hướng dẫn tư vấn · Quy trình liệu trình */
export default async function ServiceGuidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, profile } = await getCurrentUser();
  if (!profile) return null;

  const [{ data: svc }, { data: guide }, { data: steps }] = await Promise.all([
    supabase
      .from("services")
      .select("id, name, name_en, price, member_price, duration_minutes, service_categories(name)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("service_guides").select("indication, indication_ext, consult_guide").eq("service_id", id).maybeSingle(),
    supabase.from("service_procedure_steps").select("step_no, title, products, instructions, note").eq("service_id", id).order("step_no"),
  ]);
  const s = svc as unknown as Service | null;
  if (!s) {
    return (
      <div className="card text-sm">
        Không tìm thấy liệu trình. <Link href="/quan-ly" className="font-semibold text-navy underline">Về trang chính</Link>
      </div>
    );
  }
  // Cost (giá vốn sản phẩm theo định mức × giá nhập trung bình) – chỉ Chủ nhìn thấy
  const isOwner = profile.role === "owner";
  const costs: StepCost[] = isOwner ? (((await supabase.rpc("service_step_costs", { p_service: id })).data ?? []) as StepCost[]) : [];
  const costOf = (stepNo: number, name: string) => costs.find((c) => c.step_no === stepNo && c.product_name === name);
  const stepCost = (stepNo: number) => costs.filter((c) => c.step_no === stepNo).reduce((t, c) => t + Number(c.cost ?? 0), 0);
  const totalCost = costs.reduce((t, c) => t + Number(c.cost ?? 0), 0);
  const missing = costs.filter((c) => c.cost == null).length;
  const g = (guide ?? null) as ServiceGuide | null;
  const list = (steps ?? []) as Step[];
  const title = s.name_en || s.name;

  return (
    <div className="space-y-4">
      <BackLink />
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-brown">{s.service_categories?.name ?? "Liệu trình"}</p>
        <h1 className="text-2xl font-bold text-navy">{title}</h1>
        {s.name_en && <p className="text-sm text-ink/70">{s.name}</p>}
        <p className="flex flex-wrap gap-x-4 text-sm">
          {s.price != null && (
            <span>
              Niêm yết <b className="text-navy">{formatVnd(Number(s.price))}</b>
            </span>
          )}
          {s.member_price != null && (
            <span>
              Member <b className="text-brown">{formatVnd(Number(s.member_price))}</b>
            </span>
          )}
          {s.duration_minutes ? <span>{s.duration_minutes} phút</span> : null}
        </p>
        {isOwner && costs.length > 0 && (
          <div className="mt-2 rounded-xl bg-[#FBEAEA] px-3 py-2 text-sm">
            <p className="flex flex-wrap items-baseline gap-x-3">
              <span>
                Cost liệu trình <b className="text-[#8A2323]">{formatVnd(totalCost)}</b>
              </span>
              {s.price ? <span className="text-xs text-ink/70">= {((totalCost / Number(s.price)) * 100).toFixed(1)}% giá niêm yết</span> : null}
              {s.member_price ? <span className="text-xs text-ink/70">· {((totalCost / Number(s.member_price)) * 100).toFixed(1)}% giá member</span> : null}
            </p>
            <p className="text-[11px] text-ink/55">
              Chỉ Chủ nhìn thấy · định lượng mỗi buổi × giá nhập trung bình hiện tại
              {missing > 0 ? ` · ${missing} sản phẩm chưa có giá nhập nên chưa tính` : ""}
            </p>
          </div>
        )}
      </div>

      <nav className="flex flex-wrap gap-2 text-sm">
        {[
          ["chi-dinh", "Chỉ định"],
          ["mo-rong", "Chỉ định mở rộng"],
          ["tu-van", "Hướng dẫn tư vấn"],
          ["quy-trinh", "Quy trình"],
        ].map(([a, l]) => (
          <a key={a} href={`#${a}`} className="rounded-full bg-white px-3 py-1.5 font-semibold text-navy ring-1 ring-beige-dark hover:bg-cream">
            {l}
          </a>
        ))}
      </nav>

      <ServiceGuideSections guide={g} />

      <section id="quy-trinh" className="card scroll-mt-4 space-y-3">
        <h2 className="text-lg font-bold text-navy">Quy trình liệu trình{list.length ? ` · ${list.length} bước` : ""}</h2>
        {list.length === 0 ? (
          <p className="text-sm text-ink/60">Liệu trình này chưa có quy trình trong hệ thống.</p>
        ) : (
          <ol className="space-y-2.5">
            {list.map((st) => (
              <li key={st.step_no} className="flex gap-3 rounded-xl bg-cream/60 px-3 py-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy text-[13px] font-bold text-white">{st.step_no}</span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex items-start justify-between gap-2 text-sm font-semibold">
                    <span>{st.title}</span>
                    {isOwner && costs.some((c) => c.step_no === st.step_no) && (
                      <span className="shrink-0 rounded-full bg-[#FBEAEA] px-2 py-0.5 text-xs font-bold text-[#8A2323]">{formatVnd(stepCost(st.step_no))}</span>
                    )}
                  </p>
                  {st.products.map((p) => {
                    const c = isOwner ? costOf(st.step_no, p) : undefined;
                    return (
                      <p key={p} className="flex justify-between gap-2 text-xs text-[#646464]">
                        <span className="min-w-0">SP: {p}</span>
                        {c && (
                          <span className="shrink-0 text-right text-[#8A2323]">
                            {Number(c.qty)} {c.unit} · {c.cost != null ? formatVnd(Number(c.cost)) : "chưa có giá"}
                          </span>
                        )}
                      </p>
                    );
                  })}
                  {st.instructions && <p className="whitespace-pre-line text-xs text-ink/80">{st.instructions}</p>}
                  {st.note && <p className="whitespace-pre-line text-xs text-[#8C1D18]">Lưu ý: {st.note}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

