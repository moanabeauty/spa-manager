import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { POST_KIND, PostCard, type Post, type PostKind } from "@/lib/posts";

export default async function PostListPage({ kind }: { kind: PostKind }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("posts")
    .select("slug, title, summary, cover_url, published_at, kind")
    .eq("kind", kind)
    .eq("is_published", true)
    .order("published_at", { ascending: false })
    .limit(60);
  const posts = (data ?? []) as Post[];
  const k = POST_KIND[kind];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">{k.label}</h1>
        <p className="text-sm text-ink/70">{k.intro}</p>
      </div>
      {posts.length === 0 && <p className="card text-sm text-ink/60">Moana đang chuẩn bị bài viết, bạn quay lại sau nhé.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {posts.map((p) => (
          <PostCard key={p.slug} p={p} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/dat-lich" className="btn-primary">Đặt lịch</Link>
        <Link href={kind === "skincare" ? "/lieu-trinh-moi" : "/goc-cham-da"} className="btn-outline">
          {kind === "skincare" ? "Xem liệu trình mới" : "Xem góc chăm da"}
        </Link>
      </div>
    </div>
  );
}
