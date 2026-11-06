import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { formatVnd } from "@/lib/format";

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
type Guide = { indication: string | null; indication_ext: string | null; consult_guide: string | null };
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
  const g = (guide ?? null) as Guide | null;
  const list = (steps ?? []) as Step[];
  const title = s.name_en || s.name;

  return (
    <div className="space-y-4">
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

      <Section id="chi-dinh" title="Chỉ định" text={g?.indication} />
      <Section id="mo-rong" title="Chỉ định mở rộng & cơ chế phối hợp sản phẩm" text={g?.indication_ext} />
      <Section id="tu-van" title="Hướng dẫn tư vấn" text={g?.consult_guide} />

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
                  <p className="text-sm font-semibold">{st.title}</p>
                  {st.products.map((p) => (
                    <p key={p} className="text-xs text-[#646464]">SP: {p}</p>
                  ))}
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

function Section({ id, title, text }: { id: string; title: string; text: string | null | undefined }) {
  return (
    <section id={id} className="card scroll-mt-4 space-y-2">
      <h2 className="text-lg font-bold text-navy">{title}</h2>
      {text ? <p className="whitespace-pre-line text-sm leading-relaxed text-ink/85">{text}</p> : <p className="text-sm text-ink/50">Chưa có nội dung.</p>}
    </section>
  );
}
