import Link from "next/link";
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
type Locked = { category_id: string | null; category_name: string | null; sort_order: number | null; hidden: number };

export default async function MenuPage() {
  const { supabase, user, profile } = await getCurrentUser();
  const [{ data: cats }, { data: svcData }, { data: lockedData }, { data: full }, { data: branchData }] = await Promise.all([
    supabase.from("service_categories").select("id, name, sort_order").order("sort_order"),
    // bảng dịch vụ tự lọc theo cấp của người xem (khách mới / đã mua gói / nhân viên)
    supabase
      .from("services")
      .select("id, category_id, name, name_en, description, duration_minutes, price, member_price, branch_id, menu_tier")
      .eq("is_active", true)
      .order("name"),
    supabase.rpc("menu_locked_summary"),
    supabase.rpc("can_view_full_menu"),
    supabase.from("branches").select("id, name").eq("is_active", true),
  ]);
  const services = (svcData ?? []) as Svc[];
  const locked = (lockedData ?? []) as Locked[];
  const branches = (branchData ?? []) as { id: string; name: string }[];
  const hiddenTotal = locked.reduce((a, l) => a + l.hidden, 0);
  const staff = isStaffRole(profile?.role);
  const fullMenu = full === true;

  const groups = (cats ?? [])
    .map((c: { id: string; name: string }) => ({ ...c, items: services.filter((s) => s.category_id === c.id) }))
    .filter((g) => g.items.length);
  const lockedById = new Map(locked.map((l) => [l.category_id, l.hidden]));
  const lockedOnly = locked.filter((l) => !groups.some((g) => g.id === l.category_id));

  return (
    <div className="space-y-5">
      <section className="rounded-3xl bg-beige px-6 py-8 text-center">
        <p className="text-xs uppercase tracking-[0.35em] text-brown">Moana Beauty</p>
        <h1 className="mt-2 text-2xl font-bold text-navy">Menu dịch vụ</h1>
        {staff ? (
          <p className="mx-auto mt-2 max-w-md text-sm text-ink/80">
            Bạn đang xem bằng tài khoản nhân viên nên thấy toàn bộ menu. Dịch vụ có nhãn 🔒 chỉ hiện với khách đã mua gói.
          </p>
        ) : fullMenu ? (
          <p className="mx-auto mt-2 max-w-md text-sm text-ink/80">Cảm ơn bạn đã là khách hàng thân thiết của Moana – bạn xem được toàn bộ menu.</p>
        ) : (
          <p className="mx-auto mt-2 max-w-md text-sm text-ink/80">
            Các liệu trình chăm sóc da dành cho khách mới. {hiddenTotal > 0 && <>Moana còn <b>{hiddenTotal} dịch vụ chuyên sâu</b> dành riêng cho khách đã mua gói liệu trình.</>}
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
              {!fullMenu && !staff && lockedById.get(g.id) ? ` · +${lockedById.get(g.id)} 🔒` : ""}
            </span>
          </summary>
          <ul className="divide-y divide-beige border-t border-beige">
            {g.items.map((s) => (
              <li key={s.id} className="px-5 py-3">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {s.name}
                      {staff && s.menu_tier !== "public" && <span className="ml-1 text-xs">🔒</span>}
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
          {!fullMenu && !staff && lockedById.get(g.id) ? (
            <p className="border-t border-beige px-5 py-3 text-xs text-ink/60">
              🔒 Còn {lockedById.get(g.id)} dịch vụ trong nhóm này dành cho khách đã mua gói.
            </p>
          ) : null}
        </details>
      ))}

      {!fullMenu && !staff && lockedOnly.length > 0 && (
        <section className="card">
          <h2 className="font-semibold text-navy">🔒 Dành cho khách đã mua gói</h2>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {lockedOnly.map((l) => (
              <li key={l.category_id ?? "none"} className="flex justify-between rounded-xl bg-cream px-3 py-2 text-sm">
                <span>{l.category_name ?? "Dịch vụ khác"}</span>
                <span className="text-ink/50">{l.hidden} dịch vụ</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-ink/70">
            Khách đã mua gói liệu trình tại Moana xem được toàn bộ menu và tự đặt lịch online
            {user ? "" : <> (<Link href="/dang-nhap" className="font-semibold text-navy underline">đăng nhập</Link> tài khoản đã gắn với hồ sơ khách)</>}. Cần tư vấn? Đặt lịch một buổi chăm sóc cơ bản, chuyên viên Moana sẽ soi da và tư vấn liệu trình phù hợp.
          </p>
        </section>
      )}

      {groups.length === 0 && <p className="card text-sm text-ink/60">Menu đang được cập nhật.</p>}
    </div>
  );
}
