import { getCurrentUser } from "@/lib/supabase/server";
import { POST_COLUMNS, type Post } from "@/lib/posts";
import PostEditor from "./PostEditor";

export const metadata = { title: "Bài viết web khách – Moana Beauty" };

export default async function PostsAdminPage() {
  const { supabase, profile } = await getCurrentUser();
  if (profile?.role !== "owner" && profile?.role !== "manager") return <p className="card text-sm">Trang dành cho chủ spa / quản lý.</p>;
  const { data } = await supabase.from("posts").select(POST_COLUMNS).order("updated_at", { ascending: false });
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Bài viết web khách</h1>
        <p className="text-sm text-ink/70">Viết bài giới thiệu liệu trình mới và chia sẻ kiến thức chăm da. Bài đã đăng hiện ở trang khách.</p>
      </div>
      <PostEditor posts={(data ?? []) as Post[]} />
    </div>
  );
}
