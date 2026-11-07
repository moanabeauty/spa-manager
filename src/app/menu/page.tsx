import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, isStaffRole } from "@/lib/supabase/server";
import { formatDuration, formatVnd } from "@/lib/format";

export const metadata = { title: "Menu dịch vụ – Moana Beauty" };

type Svc = {
  id: string;
  category_id: string | null;
  name: string;
  name_en: string | null;
  description: string | null;
  duration_minutes: number;
  price: number | null;
  member_price: number | null;
  branch_id: string | null;
  menu_tier: string;
};

export default async function MenuPage() {
  const { supabase, user, profile } = await getCurrentUser();
  // Menu chỉ dành cho người đã có tài khoản
  if (!user) redirect("/dang-nhap?next=/menu");
  const [{ data: cats }, { data: svcData }, { data: branchData }] = await Promise.all([
    supabase.from("service_categories").select("id, name, sort_order").order("sort_order"),
    // Public: mọi khách đã đăng nhập; Private: chỉ nhân viên (cơ sở dữ liệu tự lọc)
    supabase
      .from("services")
      .select("id, category_id, name, name_en, description, duration_minutes, price, member_price, branch_id, menu_tier")
      .eq("is_active", true)
      .order("name"),
    supabase.from("branches").select("id, name").eq("is_active", true),
  ]);
  const services = (svcData ?? []) as Svc[];
  const branches = (branchData ?? []) as { id: string; name: string }[];
  const staff = isStaffRole(profile?.role);

  const groups = (cats ?? [])
    .map((c: { id: string; name: string }) => ({ ...c, items: services.filter((s) => s.category_id === c.id) }))
    .filter((g) => g.items.length);

  return (
    <div className="space-y-5">
      <section className="rounded-3xl bg-beige px-6 py-8 text-center">
        <p className="text-xs uppercase tracking-[0.35em] text-brown">Moana Beauty</p>
        <h1 className="mt-2 text-2xl font-bold text-navy">Menu dịch vụ</h1>
        {staff ? (
          <p className="mx-auto mt-2 max-w-md text-sm text-ink/80">
            Bạn đang xem bằng tài khoản nhân viên nên thấy toàn bộ menu. Dịch vụ có nhãn 🔒 Nội bộ (Private) khách không nhìn thấy.
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

      {groups.map((g) => (
        <details key={g.id} className="card p-0" open={groups.length <= 4}>
          <summary className="flex cursor-pointer items-center justify-between gap-2 rounded-2xl px-5 py-4">
            <span className="font-semibold text-navy">{g.name}</span>
            <span className="text-xs text-ink/50">
              {g.items.length} dịch vụ
            </span>
          </summary>
          <ul className="divide-y divide-beige border-t border-beige">
            {g.items.map((s) => (
              <li key={s.id} className="px-5 py-3">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {s.name}
                      {staff && s.menu_tier !== "public" && <span className="ml-1 rounded-full bg-[#DCE3F5] px-2 text-[10px] text-navy">🔒 Nội bộ</span>}
                    </p>
                    {s.name_en && <p className="text-xs italic text-ink/50">{s.name_en}</p>}
                    {s.description && <p className="mt-0.5 text-xs text-ink/70">{s.description}</p>}
                    <p className="mt-0.5 text-xs text-ink/50">
                      {formatDuration(s.duration_minutes)}
                      {s.branch_id && ` · chỉ ${branches.find((b) => b.id === s.branch_id)?.name ?? ""}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold text-navy">{formatVnd(s.price === null ? null : Number(s.price))}</p>
                    {s.member_price !== null && s.price !== null && Number(s.member_price) < Number(s.price) && (
                      <p className="text-xs text-[#22612A]">Thành viên {formatVnd(Number(s.member_price))}</p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ))}


      {groups.length === 0 && <p className="card text-sm text-ink/60">Menu đang được cập nhật.</p>}
    </div>
  );
}
