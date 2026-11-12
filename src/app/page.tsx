import { activeBranches } from "@/lib/refData";
import Link from "next/link";
import { getCurrentUser, isStaffRole } from "@/lib/supabase/server";
import { POST_KIND, PostCard, type Post } from "@/lib/posts";

export default async function Home() {
  const { supabase, user, profile } = await getCurrentUser();
  const [{ data: branches }, { data: postData }] = await Promise.all([
    activeBranches(),
    supabase
      .from("posts")
      .select("slug, title, summary, cover_url, published_at, kind")
      .eq("is_published", true)
      .order("published_at", { ascending: false })
      .limit(12),
  ]);
  const posts = (postData ?? []) as Post[];
  const sections = (["new_treatment", "skincare"] as const)
    .map((k) => ({ k, items: posts.filter((p) => p.kind === k).slice(0, 2) }))
    .filter((s) => s.items.length > 0);

  return (
    <div className="space-y-6">
      <section className="brand-sheen rounded-3xl px-6 py-10 text-center ring-1 ring-gold/30">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-moana.png" alt="Moana Beauty" width={212} height={74} className="mx-auto h-16 w-auto sm:h-20" />
        <h1 className="mt-5 text-3xl text-navy sm:text-4xl">Đặt lịch chăm sóc da</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-ink/80">
          Chọn chi nhánh, dịch vụ và giờ phù hợp. Moana sẽ xác nhận lịch với bạn sớm nhất.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/dat-lich" className="btn-primary">Đặt lịch ngay</Link>
          <Link href="/menu" className="btn-outline">Menu dịch vụ</Link>
          <Link href="/khuyen-mai" className="btn-outline">Xem khuyến mãi</Link>
          {user ? (
            <Link href="/tai-khoan" className="btn-outline">Tài khoản của tôi</Link>
          ) : (
            <Link href="/dang-nhap?tab=dang-ky" className="btn-outline">Tạo tài khoản</Link>
          )}
        </div>
        {user && profile && (
          <p className="mt-5 text-sm text-ink/70">
            Xin chào, <b>{profile.full_name}</b>
            {isStaffRole(profile.role) && (
              <>
                {" · "}
                <Link href="/quan-ly" className="font-semibold text-navy underline">Vào trang quản lý</Link>
              </>
            )}
          </p>
        )}
      </section>

      {sections.map((s) => (
        <section key={s.k} className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="sparkle font-display text-2xl font-bold text-navy">{POST_KIND[s.k].label}</h2>
            <Link href={POST_KIND[s.k].path} className="text-sm font-semibold text-navy underline">Xem tất cả</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {s.items.map((p) => <PostCard key={p.slug} p={p} />)}
          </div>
        </section>
      ))}

      <section className="grid gap-3 sm:grid-cols-2">
        {(branches ?? []).map((b) => (
          <div key={b.id} className="card">
            <p className="font-semibold text-navy">{b.name}</p>
            <p className="mt-1 text-sm text-ink/70">{b.address}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
