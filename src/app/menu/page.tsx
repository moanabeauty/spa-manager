import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, isStaffRole } from "@/lib/supabase/server";
import { formatDuration, formatVnd } from "@/lib/format";
import ServiceTitle from "@/components/ServiceTitle";

export const metadata = { title: "Menu dịch vụ – Moana Beauty" };

type Svc = {
  id: string;
  category_id: string | null;
  name: string;
  name_en: string | null;
  internal_name: string | null;
  internal_note: string | null;
  duration_minutes: number;
  price: number | null;
  member_price: number | null;
  branch_id: string | null;
  menu_tier: string;
};

type Pkg = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  validity_days: number | null;
  category: string | null;
  sort_order: number;
  menu_tier: string;
  package_items: { id: string; label: string; quantity: number | null; sort_order: number }[];
};

export default async function MenuPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { user, profile } = await getCurrentUser();
  // Menu chỉ dành cho người đã có tài khoản
  if (!user) redirect("/dang-nhap?next=/menu");
  const tab = (await searchParams).tab === "combo" ? "combo" : "le";
  const staff = isStaffRole(profile?.role);

  return (
    <div className="space-y-5">
      <section className="rounded-3xl bg-beige px-6 py-8 text-center">
        <p className="text-xs uppercase tracking-[0.35em] text-brown">Moana Beauty</p>
        <h1 className="mt-2 text-2xl font-bold text-navy">Menu dịch vụ</h1>
        {staff ? (
          <p className="mx-auto mt-2 max-w-md text-sm text-ink/80">
            Bạn đang xem bằng tài khoản nhân viên nên thấy toàn bộ menu. Dòng có 🔒 chỉ nhân viên thấy, khách không nhìn thấy.
          </p>
        ) : (
          <p className="mx-auto mt-2 max-w-md text-sm text-ink/80">
            Các liệu trình chăm sóc da tại Moana. Chuyên viên sẽ soi da và tư vấn liệu trình phù hợp khi bạn đến spa.
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link href="/dat-lich" className="btn-primary">Đặt lịch</Link>
          <Link href="/khuyen-mai" className="btn-outline">Xem khuyến mãi</Link>
        </div>
      </section>

      <nav className="grid grid-cols-2 gap-1 rounded-full bg-beige p-1 text-sm font-semibold">
        <Link
          href="/menu"
          className={`rounded-full px-4 py-2 text-center transition ${tab === "le" ? "bg-navy text-white" : "text-navy hover:bg-cream"}`}
        >
          Menu dịch vụ lẻ
        </Link>
        <Link
          href="/menu?tab=combo"
          className={`rounded-full px-4 py-2 text-center transition ${tab === "combo" ? "bg-navy text-white" : "text-navy hover:bg-cream"}`}
        >
          Menu Combo
        </Link>
      </nav>

      {tab === "le" ? <SingleMenu staff={staff} /> : <ComboMenu staff={staff} />}
    </div>
  );
}

async function SingleMenu({ staff }: { staff: boolean }) {
  const { supabase } = await getCurrentUser();
  const [{ data: cats }, { data: svcData }, { data: branchData }] = await Promise.all([
    supabase.from("service_categories").select("id, name, sort_order").order("sort_order"),
    // Public: mọi khách đã đăng nhập; Private: chỉ nhân viên (cơ sở dữ liệu tự lọc)
    supabase
      .from("services")
      .select("id, category_id, name, name_en, internal_name, internal_note, duration_minutes, price, member_price, branch_id, menu_tier")
      .eq("is_active", true)
      .order("name_en"),
    supabase.from("branches").select("id, name").eq("is_active", true),
  ]);
  const services = (svcData ?? []) as Svc[];
  const branches = (branchData ?? []) as { id: string; name: string }[];
  const groups = (cats ?? [])
    .map((c: { id: string; name: string }) => ({ ...c, items: services.filter((s) => s.category_id === c.id) }))
    .filter((g) => g.items.length);

  if (groups.length === 0) return <p className="card text-sm text-ink/60">Menu đang được cập nhật.</p>;
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <details key={g.id} className="card p-0" open={groups.length <= 4}>
          <summary className="flex cursor-pointer items-center justify-between gap-2 rounded-2xl px-5 py-4">
            <span className="font-semibold text-navy">{g.name}</span>
            <span className="text-xs text-ink/50">{g.items.length} dịch vụ</span>
          </summary>
          <ul className="divide-y divide-beige border-t border-beige">
            {g.items.map((s) => (
              <li key={s.id} className="flex justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <ServiceTitle
                    nameEn={s.name_en}
                    name={s.name}
                    internalName={s.internal_name}
                    internalNote={s.internal_note}
                    showInternal={staff}
                    badge={
                      staff && s.menu_tier !== "public" ? (
                        <span className="ml-1.5 rounded-full bg-[#DCE3F5] px-2 align-middle text-[10px] font-normal normal-case tracking-normal text-navy">🔒 Nội bộ</span>
                      ) : null
                    }
                  />
                  <p className="mt-0.5 text-xs text-ink/50">
                    {formatDuration(s.duration_minutes)}
                    {s.branch_id && ` · chỉ ${branches.find((b) => b.id === s.branch_id)?.name ?? ""}`}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-navy">{formatVnd(s.price === null ? null : Number(s.price))}</p>
                  {s.member_price !== null && s.price !== null && Number(s.member_price) < Number(s.price) && (
                    <p className="text-xs text-[#22612A]">Thành viên {formatVnd(Number(s.member_price))}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

async function ComboMenu({ staff }: { staff: boolean }) {
  const { supabase } = await getCurrentUser();
  // Public: khách đã có tài khoản xem được; Private: chỉ nhân viên (cơ sở dữ liệu tự lọc)
  const { data } = await supabase
    .from("packages")
    .select("id, name, description, price, validity_days, category, sort_order, menu_tier, package_items(id, label, quantity, sort_order)")
    .eq("is_active", true)
    .order("sort_order")
    .order("name");
  const packages = (data ?? []) as Pkg[];

  // Thực tế chỉ định từng buổi: chỉ nhân viên đọc được (cơ sở dữ liệu tự chặn với khách)
  const notes = new Map<string, string>();
  if (staff) {
    const ids = packages.flatMap((p) => p.package_items.map((i) => i.id));
    if (ids.length) {
      const { data: n } = await supabase.from("package_item_notes").select("item_id, note").in("item_id", ids);
      for (const r of (n ?? []) as { item_id: string; note: string }[]) notes.set(r.item_id, r.note);
    }
  }

  const groups: { name: string; items: Pkg[] }[] = [];
  for (const p of packages) {
    const name = p.category ?? "Combo khác";
    const g = groups.find((x) => x.name === name);
    if (g) g.items.push(p);
    else groups.push({ name, items: [p] });
  }

  if (groups.length === 0) return <p className="card text-sm text-ink/60">Menu combo đang được cập nhật.</p>;
  return (
    <div className="space-y-3">
      {!staff && (
        <p className="px-1 text-xs text-ink/60">Mua combo tại quầy lễ tân hoặc nhờ chuyên viên tư vấn khi bạn đến spa.</p>
      )}
      {groups.map((g) => (
        <details key={g.name} className="card p-0" open>
          <summary className="flex cursor-pointer items-center justify-between gap-2 rounded-2xl px-5 py-4">
            <span className="font-semibold text-navy">{g.name}</span>
            <span className="text-xs text-ink/50">{g.items.length} combo</span>
          </summary>
          <ul className="divide-y divide-beige border-t border-beige">
            {g.items.map((p) => (
              <li key={p.id} className="px-5 py-3">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold uppercase tracking-wide text-navy">
                      {p.name}
                      {staff && p.menu_tier !== "public" && (
                        <span className="ml-1.5 rounded-full bg-[#DCE3F5] px-2 align-middle text-[10px] font-normal normal-case tracking-normal text-navy">🔒 Nội bộ</span>
                      )}
                    </p>
                    {p.description && <p className="mt-0.5 text-xs text-ink/70">{p.description}</p>}
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-navy">{formatVnd(Number(p.price))}</p>
                </div>
                <ul className="mt-2 space-y-1.5 rounded-xl bg-cream px-3 py-2">
                  {[...p.package_items]
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map((i) => {
                      const note = notes.get(i.id);
                      return (
                        <li key={i.id} className="flex gap-2 text-xs">
                          <span className="shrink-0 font-semibold text-navy">{i.quantity === null ? "∞" : `${i.quantity}×`}</span>
                          <span className="min-w-0">
                            <span className="block text-ink/80">{i.label}</span>
                            {note && note !== i.label && <span className="block text-[11px] text-ink/50">🔒 Thực tế: {note}</span>}
                          </span>
                        </li>
                      );
                    })}
                </ul>
                {p.validity_days && <p className="mt-1 text-[11px] text-ink/50">Hạn dùng {p.validity_days} ngày kể từ ngày mua</p>}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
