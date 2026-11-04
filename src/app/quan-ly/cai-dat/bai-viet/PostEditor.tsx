"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";
import { POST_KIND, postDate, slugify, type Post, type PostKind } from "@/lib/posts";

type Draft = { id?: string; kind: PostKind; title: string; slug: string; summary: string; body: string; cover_url: string; is_published: boolean };
const empty = (): Draft => ({ kind: "new_treatment", title: "", slug: "", summary: "", body: "", cover_url: "", is_published: false });

export default function PostEditor({ posts }: { posts: Post[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [filter, setFilter] = useState<"" | PostKind>("");
  const list = posts.filter((p) => !filter || p.kind === filter);

  if (draft) return <Form initial={draft} onDone={() => setDraft(null)} />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {(
          [
            ["", "Tất cả"],
            ["new_treatment", POST_KIND.new_treatment.label],
            ["skincare", POST_KIND.skincare.label],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`rounded-full px-3 py-1.5 font-semibold ${filter === k ? "bg-navy text-white" : "bg-cream text-navy"}`}>
            {l}
          </button>
        ))}
        <button className="btn-primary ml-auto py-1.5" onClick={() => setDraft({ ...empty(), kind: filter || "new_treatment" })}>+ Bài viết mới</button>
      </div>
      {list.length === 0 && <p className="card text-sm text-ink/60">Chưa có bài viết nào.</p>}
      <ul className="space-y-2">
        {list.map((p) => (
          <li key={p.id} className="card flex items-start justify-between gap-3 p-4 text-sm">
            <div className="min-w-0">
              <p className="font-semibold text-navy">{p.title}</p>
              <p className="text-xs text-ink/60">
                {POST_KIND[p.kind].label} · {p.is_published ? `Đã đăng ${postDate(p.published_at)}` : "Bản nháp"} ·{" "}
                <Link href={`/bai-viet/${p.slug}`} className="underline" target="_blank">xem</Link>
              </p>
            </div>
            <button
              className="btn-ghost shrink-0 py-1.5"
              onClick={() =>
                setDraft({ id: p.id, kind: p.kind, title: p.title, slug: p.slug, summary: p.summary ?? "", body: p.body, cover_url: p.cover_url ?? "", is_published: p.is_published })
              }
            >
              Sửa
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Form({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const router = useRouter();
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [upBusy, setUpBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  async function upload(file: File) {
    setUpBusy(true);
    setError(null);
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${Date.now()}-${slugify(d.title || "anh")}.${ext}`;
    const supabase = createClient();
    const { error } = await supabase.storage.from("post-images").upload(path, file, { contentType: file.type, upsert: false });
    setUpBusy(false);
    if (error) return setError(vnError(error.message));
    set({ cover_url: supabase.storage.from("post-images").getPublicUrl(path).data.publicUrl });
  }

  async function save(publish?: boolean) {
    setBusy(true);
    setError(null);
    const row = {
      kind: d.kind,
      title: d.title.trim(),
      slug: d.slug.trim() || slugify(d.title),
      summary: d.summary.trim() || null,
      body: d.body,
      cover_url: d.cover_url || null,
      is_published: publish ?? d.is_published,
    };
    const supabase = createClient();
    const { error } = d.id ? await supabase.from("posts").update(row).eq("id", d.id) : await supabase.from("posts").insert(row);
    setBusy(false);
    if (error) return setError(error.message.includes("duplicate") ? "Đường dẫn bài đã trùng với bài khác, hãy sửa đường dẫn." : vnError(error.message));
    router.refresh();
    onDone();
  }
  async function remove() {
    if (!d.id || !confirm("Xoá bài viết này?")) return;
    setBusy(true);
    const { error } = await createClient().from("posts").delete().eq("id", d.id);
    setBusy(false);
    if (error) return setError(vnError(error.message));
    router.refresh();
    onDone();
  }

  return (
    <div className="card space-y-3 p-4 text-sm">
      <div className="flex gap-1 rounded-full bg-cream p-1">
        {(Object.keys(POST_KIND) as PostKind[]).map((k) => (
          <button key={k} onClick={() => set({ kind: k })} className={`flex-1 rounded-full px-3 py-1.5 font-semibold ${d.kind === k ? "bg-navy text-white" : "text-navy"}`}>
            {POST_KIND[k].label}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="label">Tiêu đề *</span>
        <input className="input" value={d.title} onChange={(e) => set({ title: e.target.value, ...(d.id ? {} : { slug: slugify(e.target.value) }) })} />
      </label>
      <label className="block">
        <span className="label">Đường dẫn</span>
        <input className="input font-mono text-xs" value={d.slug} onChange={(e) => set({ slug: slugify(e.target.value) })} placeholder="tu-tao-tu-tieu-de" />
      </label>
      <label className="block">
        <span className="label">Tóm tắt (hiện ở danh sách)</span>
        <textarea className="input" rows={2} value={d.summary} onChange={(e) => set({ summary: e.target.value })} />
      </label>
      <div>
        <span className="label">Ảnh bìa</span>
        {d.cover_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.cover_url} alt="" className="mb-2 aspect-[16/9] w-full rounded-xl object-cover" />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className="btn-outline cursor-pointer py-2">
            {upBusy ? "Đang tải ảnh…" : d.cover_url ? "Đổi ảnh" : "Tải ảnh lên"}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={upBusy}
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          {d.cover_url && <button className="text-xs text-[#8A2323] underline" onClick={() => set({ cover_url: "" })}>Bỏ ảnh</button>}
          <span className="text-xs text-ink/50">JPG / PNG / WEBP, tối đa 5MB</span>
        </div>
      </div>
      <label className="block">
        <span className="label">Nội dung</span>
        <textarea className="input font-normal" rows={14} value={d.body} onChange={(e) => set({ body: e.target.value })} />
        <span className="mt-1 block text-xs text-ink/55">
          Cách viết: để 1 dòng trống giữa các đoạn · dòng bắt đầu bằng <code>## </code> là tiêu đề nhỏ · dòng bắt đầu bằng <code>- </code> là gạch đầu
          dòng · <code>**chữ**</code> để in đậm.
        </span>
      </label>
      {error && <p className="text-[#8A2323]">{error}</p>}
      <div className="flex flex-wrap justify-between gap-2">
        <span className="flex gap-2">
          <button className="btn-ghost" onClick={onDone}>Huỷ</button>
          {d.id && <button className="btn-ghost text-[#8A2323]" disabled={busy} onClick={remove}>Xoá bài</button>}
        </span>
        <span className="flex gap-2">
          {d.is_published ? (
            <>
              <button className="btn-outline" disabled={busy || !d.title.trim()} onClick={() => save(false)}>Gỡ xuống (nháp)</button>
              <button className="btn-primary" disabled={busy || !d.title.trim()} onClick={() => save(true)}>Lưu</button>
            </>
          ) : (
            <>
              <button className="btn-outline" disabled={busy || !d.title.trim()} onClick={() => save(false)}>Lưu nháp</button>
              <button className="btn-primary" disabled={busy || !d.title.trim()} onClick={() => save(true)}>Đăng bài</button>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
