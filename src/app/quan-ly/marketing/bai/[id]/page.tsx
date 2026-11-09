import Link from "next/link";
import { POST_COLS, POST_STATUS, type MkPost } from "@/lib/marketing";
import { DENIED_TEXT, loadMarketingContext } from "../../shared";
import PostForm from "../PostForm";
import CommentThread, { type MkComment } from "../../CommentThread";

export const metadata = { title: "Bài viết – Marketing" };

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await loadMarketingContext();
  if (!ctx.allowed) return <p className="card text-sm">{DENIED_TEXT}</p>;
  const { supabase, profile, people } = ctx;
  const { id } = await params;
  const [{ data: post }, { data: comments }] = await Promise.all([
    supabase.from("marketing_posts").select(POST_COLS).eq("id", id).maybeSingle<MkPost>(),
    supabase.from("marketing_comments").select("id, author_id, body, created_at").eq("post_id", id).order("created_at"),
  ]);
  if (!post) return <p className="card text-sm">Không tìm thấy bài viết (có thể đã bị xoá).</p>;
  const st = POST_STATUS[post.status] ?? POST_STATUS.idea;
  const isOwner = profile.role === "owner";

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/quan-ly/marketing${post.publish_date ? `?thang=${post.publish_date.slice(0, 7)}` : ""}`} className="text-sm text-navy underline">
          ‹ Lịch bài viết
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-navy">{post.title}</h1>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${st.c}`}>{st.t}</span>
        </div>
      </div>
      <PostForm post={post} people={people} me={profile.id} isOwner={isOwner} defaultPublish="" />
      <CommentThread target="post" id={post.id} comments={(comments ?? []) as MkComment[]} people={people} me={profile.id} isOwner={isOwner} />
    </div>
  );
}
