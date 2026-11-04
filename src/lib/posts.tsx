// Bài viết cho khách: giới thiệu liệu trình mới, góc chăm da
import Link from "next/link";

export type PostKind = "new_treatment" | "skincare";
export const POST_KIND: Record<PostKind, { label: string; path: string; intro: string }> = {
  new_treatment: { label: "Liệu trình mới", path: "/lieu-trinh-moi", intro: "Những liệu trình mới nhất tại Moana Beauty." },
  skincare: { label: "Góc chăm da", path: "/goc-cham-da", intro: "Kiến thức chăm sóc da từ đội ngũ Moana." },
};
export type Post = {
  id: string; kind: PostKind; title: string; slug: string; summary: string | null; body: string; cover_url: string | null;
  service_id: string | null; is_published: boolean; published_at: string | null; updated_at: string;
};
export const POST_COLUMNS = "id, kind, title, slug, summary, body, cover_url, service_id, is_published, published_at, updated_at";

/** "Trị mụn an toàn mùa hè" -> "tri-mun-an-toan-mua-he" */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function postDate(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}

/** Nội dung bài: dòng trống tách đoạn; "## " = tiêu đề nhỏ; "- " = gạch đầu dòng; **chữ đậm** */
export function PostBody({ body }: { body: string }) {
  const blocks = body.replace(/\r/g, "").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const inline = (t: string) =>
    t.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <b key={i}>{part.slice(2, -2)}</b> : part));
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-ink/90">
      {blocks.map((b, i) => {
        if (b.startsWith("## ")) return <h2 key={i} className="pt-2 text-lg font-bold text-navy">{inline(b.slice(3))}</h2>;
        const lines = b.split("\n");
        if (lines.every((l) => l.trim().startsWith("- ")))
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => <li key={j}>{inline(l.trim().slice(2))}</li>)}
            </ul>
          );
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

export function PostCard({ p }: { p: Pick<Post, "slug" | "title" | "summary" | "cover_url" | "published_at" | "kind"> }) {
  return (
    <Link href={`/bai-viet/${p.slug}`} className="card block overflow-hidden p-0 hover:border-navy">
      {p.cover_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.cover_url} alt="" className="aspect-[16/9] w-full object-cover" loading="lazy" />
      )}
      <div className="p-4">
        <p className="text-xs uppercase tracking-wider text-brown">{POST_KIND[p.kind]?.label} · {postDate(p.published_at)}</p>
        <p className="mt-1 font-semibold text-navy">{p.title}</p>
        {p.summary && <p className="mt-1 line-clamp-3 text-sm text-ink/70">{p.summary}</p>}
      </div>
    </Link>
  );
}
