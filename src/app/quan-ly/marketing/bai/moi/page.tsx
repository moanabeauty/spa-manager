import Link from "next/link";
import { isDate } from "@/lib/reports";
import { DENIED_TEXT, loadMarketingContext } from "../../shared";
import PostForm from "../PostForm";

export const metadata = { title: "Bài viết mới – Marketing" };

export default async function NewPostPage({ searchParams }: { searchParams: Promise<{ ngay?: string }> }) {
  const ctx = await loadMarketingContext();
  if (!ctx.allowed) return <p className="card text-sm">{DENIED_TEXT}</p>;
  const sp = await searchParams;
  return (
    <div className="space-y-4">
      <div>
        <Link href="/quan-ly/marketing" className="text-sm text-navy underline">‹ Lịch bài viết</Link>
        <h1 className="text-2xl font-bold text-navy">Bài viết mới</h1>
      </div>
      <PostForm
        post={null}
        people={ctx.people}
        me={ctx.profile.id}
        isOwner={ctx.profile.role === "owner"}
        defaultPublish={isDate(sp.ngay) ? sp.ngay : ""}
      />
    </div>
  );
}
