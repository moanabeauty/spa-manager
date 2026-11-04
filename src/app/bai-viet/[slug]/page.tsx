import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { POST_COLUMNS, POST_KIND, PostBody, postDate, type Post } from "@/lib/posts";

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("posts").select(POST_COLUMNS).eq("slug", slug).maybeSingle();
  if (!data) notFound();
  const p = data as Post;
  const k = POST_KIND[p.kind];
  return (
    <article className="space-y-4">
      <Link href={k.path} className="text-sm font-semibold text-navy">← {k.label}</Link>
      {!p.is_published && <p className="rounded-lg bg-[#FFE8BA] px-3 py-2 text-sm text-[#7A5600]">Bản nháp – khách chưa xem được bài này.</p>}
      <header>
        <p className="text-xs uppercase tracking-wider text-brown">{k.label} · {postDate(p.published_at ?? p.updated_at)}</p>
        <h1 className="mt-1 text-2xl font-bold text-navy">{p.title}</h1>
        {p.summary && <p className="mt-2 text-ink/75">{p.summary}</p>}
      </header>
      {p.cover_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.cover_url} alt="" className="w-full rounded-2xl object-cover" />
      )}
      <PostBody body={p.body} />
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">Bạn muốn được tư vấn và trải nghiệm tại Moana?</p>
        <Link href="/dat-lich" className="btn-primary">Đặt lịch ngay</Link>
      </div>
    </article>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("posts").select("title, summary").eq("slug", slug).maybeSingle();
  return { title: data ? `${data.title} – Moana Beauty` : "Bài viết – Moana Beauty", description: data?.summary ?? undefined };
}
