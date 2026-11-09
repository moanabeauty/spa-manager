"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";
import { CHANNELS, FORMATS, dayLabel, personName, type MkPerson, type MkPost } from "@/lib/marketing";

export default function PostForm({ post, people, me, isOwner, defaultPublish }: {
  post: MkPost | null; people: MkPerson[]; me: string; isOwner: boolean; defaultPublish: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(post?.title ?? "");
  const [pic, setPic] = useState(post ? post.pic_id ?? "" : me);
  const [format, setFormat] = useState(post?.format ?? "post");
  const [channels, setChannels] = useState<string[]>(post?.channels ?? ["facebook"]);
  const [due, setDue] = useState(post?.due_date ?? "");
  const [publish, setPublish] = useState(post?.publish_date ?? defaultPublish);
  const [brief, setBrief] = useState(post?.brief ?? "");
  const [draft, setDraft] = useState(post?.draft_url ?? "");
  const [pubUrl, setPubUrl] = useState(post?.published_url ?? "");
  const [reviseOpen, setReviseOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  const status = post?.status ?? "idea";
  const canDelete = !!post && (isOwner || post.created_by === me);

  function fields() {
    return {
      title: title.trim(),
      pic_id: pic || null,
      format,
      channels,
      due_date: due || null,
      publish_date: publish || null,
      brief: brief.trim() || null,
      draft_url: draft.trim() || null,
      published_url: pubUrl.trim() || null,
    };
  }

  function check(): string | null {
    if (!title.trim()) return "Vui lòng nhập tiêu đề bài viết.";
    if (channels.length === 0) return "Chọn ít nhất 1 kênh đăng.";
    if (due && publish && due > publish) return "Deadline nộp phải trước hoặc bằng ngày đăng.";
    return null;
  }

  async function save(extra: Record<string, unknown> = {}, ok = "Đã lưu.") {
    const bad = check();
    if (bad) return setMsg({ ok: false, t: bad });
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const row = { ...fields(), ...extra };
    let id = post?.id;
    if (post) {
      const { error } = await supabase.from("marketing_posts").update(row).eq("id", post.id);
      if (error) {
        setBusy(false);
        return setMsg({ ok: false, t: vnError(error.message) });
      }
    } else {
      const { data, error } = await supabase.from("marketing_posts").insert(row).select("id").single();
      if (error || !data) {
        setBusy(false);
        return setMsg({ ok: false, t: vnError(error?.message) });
      }
      id = data.id as string;
    }
    // gửi duyệt → báo điện thoại chủ spa (không chặn nếu lỗi)
    if (extra.status === "review" && !isOwner && id) {
      fetch("/api/thong-bao/marketing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ postId: id }) }).catch(() => {});
    }
    setBusy(false);
    setMsg({ ok: true, t: ok });
    if (!post && id) router.push(`/quan-ly/marketing/bai/${id}`);
    else router.refresh();
  }

  async function requestRevise() {
    if (!post) return;
    if (!note.trim()) return setMsg({ ok: false, t: "Ghi góp ý để Marketing biết cần sửa gì." });
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("marketing_posts").update({ status: "revise", review_note: note.trim() }).eq("id", post.id);
    if (!error) await supabase.from("marketing_comments").insert({ post_id: post.id, body: `Yêu cầu sửa: ${note.trim()}` });
    setBusy(false);
    if (error) return setMsg({ ok: false, t: vnError(error.message) });
    setReviseOpen(false);
    setNote("");
    setMsg({ ok: true, t: "Đã gửi yêu cầu sửa." });
    router.refresh();
  }

  async function remove() {
    if (!post || !confirm("Xoá hẳn bài viết này (cả phần trao đổi)?")) return;
    setBusy(true);
    const { error } = await createClient().from("marketing_posts").delete().eq("id", post.id);
    setBusy(false);
    if (error) return setMsg({ ok: false, t: vnError(error.message) });
    router.push("/quan-ly/marketing");
    router.refresh();
  }

  const toggle = (k: string) => setChannels(channels.includes(k) ? channels.filter((c) => c !== k) : [...channels, k]);

  return (
    <div className="space-y-4">
      {post?.status === "revise" && post.review_note && (
        <p className="card border-l-4 border-l-[#D9534F] p-3 text-sm">
          <b className="text-[#8A2323]">Chủ spa yêu cầu sửa:</b> {post.review_note}
        </p>
      )}
      {post?.status === "review" && (
        <p className="card border-l-4 border-l-[#E0A526] p-3 text-sm">
          Đã gửi duyệt{post.submitted_at && ` lúc ${new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(new Date(post.submitted_at))}`}
          {isOwner ? " – bấm Duyệt hoặc Yêu cầu sửa ở cuối trang." : " – đang chờ chủ spa duyệt."}
        </p>
      )}

      <div className="card space-y-4">
        <div>
          <label className="label">Tiêu đề bài viết *</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="VD: Review liệu trình Glow MN – khách thật" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Người phụ trách (PIC)</label>
            <select className="input" value={pic} onChange={(e) => setPic(e.target.value)}>
              <option value="">— Chưa giao —</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name ?? "(chưa có tên)"}{p.id === me ? " (tôi)" : ""}</option>
              ))}
              {post?.pic_id && !people.some((p) => p.id === post.pic_id) && <option value={post.pic_id}>{personName(people, post.pic_id)}</option>}
            </select>
          </div>
          <div>
            <label className="label">Loại nội dung</label>
            <select className="input" value={format} onChange={(e) => setFormat(e.target.value)}>
              {Object.entries(FORMATS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">◆ Deadline nộp bài</label>
            <input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
            {due && <p className="mt-1 text-xs capitalize text-ink/60">{dayLabel(due)}</p>}
          </div>
          <div>
            <label className="label">● Ngày cần đăng</label>
            <input type="date" className="input" value={publish} onChange={(e) => setPublish(e.target.value)} />
            {publish && <p className="mt-1 text-xs capitalize text-ink/60">{dayLabel(publish)}</p>}
          </div>
        </div>
        <div>
          <label className="label">Kênh đăng *</label>
          <div className="flex flex-wrap gap-2">
            {CHANNELS.map((c) => {
              const on = channels.includes(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => toggle(c.key)}
                  className={`rounded-full px-3 py-1.5 text-sm font-semibold ${on ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-beige-dark"}`}
                >
                  {on ? "✓ " : ""}{c.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="label">Nội dung / ý tưởng / caption</label>
          <textarea className="input min-h-[140px]" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Ý tưởng, thông điệp chính, caption, hashtag, liệu trình liên quan…" />
        </div>
        <div>
          <label className="label">Link bản nháp (Google Drive, Canva…)</label>
          <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://…" inputMode="url" />
          {post?.draft_url && (
            <a href={post.draft_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm text-navy underline">Mở bản nháp ↗</a>
          )}
        </div>
        {(status === "approved" || status === "published") && (
          <div>
            <label className="label">Link bài đã đăng</label>
            <input className="input" value={pubUrl} onChange={(e) => setPubUrl(e.target.value)} placeholder="https://facebook.com/…" inputMode="url" />
            {post?.published_url && (
              <a href={post.published_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm text-navy underline">Xem bài đã đăng ↗</a>
            )}
          </div>
        )}
        {status === "approved" && !isOwner && (
          <p className="text-xs text-ink/60">Bài đã duyệt: nếu sửa tiêu đề, nội dung hoặc bản nháp thì bài sẽ quay lại “Chờ duyệt”.</p>
        )}
      </div>

      {msg && <p className={`card p-3 text-sm ${msg.ok ? "text-[#22612A]" : "text-[#8A2323]"}`}>{msg.t}</p>}

      {/* thanh thao tác */}
      <div className="card flex flex-wrap items-center gap-2 p-3">
        {!post && (
          <>
            <button className="btn-primary" disabled={busy} onClick={() => save({ status: "doing" }, "Đã tạo bài.")}>Lưu bài (Đang làm)</button>
            <button className="btn-outline" disabled={busy} onClick={() => save({ status: "idea" }, "Đã lưu ý tưởng.")}>Lưu là Ý tưởng</button>
            {!isOwner && (
              <button className="btn-outline" disabled={busy} onClick={() => save({ status: "review" }, "Đã gửi duyệt.")}>Lưu & gửi duyệt</button>
            )}
          </>
        )}

        {post && (
          <>
            <button className="btn-primary" disabled={busy} onClick={() => save()}>Lưu thay đổi</button>

            {["idea", "doing", "revise"].includes(status) && !isOwner && (
              <button className="btn-primary bg-[#A0845E] hover:bg-[#8a704f]" disabled={busy} onClick={() => save({ status: "review" }, "Đã gửi duyệt, chủ spa sẽ nhận thông báo.")}>
                Gửi duyệt ›
              </button>
            )}
            {status === "idea" && (
              <button className="btn-outline" disabled={busy} onClick={() => save({ status: "doing" }, "Đã chuyển sang Đang làm.")}>Bắt đầu làm</button>
            )}

            {isOwner && !["approved", "published", "cancelled"].includes(status) && (
              <>
                <button className="btn-primary bg-[#22612A] hover:bg-[#1b4f22]" disabled={busy} onClick={() => save({ status: "approved", review_note: null }, "Đã duyệt bài.")}>
                  ✓ Duyệt
                </button>
                {status !== "revise" && (
                  <button className="btn-outline border-[#B3261E] text-[#B3261E]" disabled={busy} onClick={() => setReviseOpen(!reviseOpen)}>
                    Yêu cầu sửa
                  </button>
                )}
              </>
            )}

            {(status === "approved" || (isOwner && status !== "published" && status !== "cancelled")) && (
              <button className="btn-outline" disabled={busy} onClick={() => save({ status: "published" }, "Đã đánh dấu đã đăng.")}>
                Đánh dấu đã đăng
              </button>
            )}

            {status === "cancelled" ? (
              <button className="btn-ghost" disabled={busy} onClick={() => save({ status: "doing" }, "Đã khôi phục bài.")}>Khôi phục bài</button>
            ) : status !== "published" ? (
              <button className="btn-ghost" disabled={busy} onClick={() => save({ status: "cancelled" }, "Đã huỷ bài.")}>Huỷ bài</button>
            ) : null}
            {canDelete && (
              <button className="btn-ghost ml-auto text-[#B3261E]" disabled={busy} onClick={remove}>Xoá</button>
            )}
          </>
        )}
      </div>

      {reviseOpen && (
        <div className="card space-y-2 border-l-4 border-l-[#B3261E]">
          <label className="label">Góp ý cần sửa</label>
          <textarea className="input min-h-[90px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: Đổi ảnh bìa sáng hơn, caption ngắn lại, thêm giá member…" />
          <div className="flex gap-2">
            <button className="btn-primary bg-[#B3261E] hover:bg-[#8A2323]" disabled={busy} onClick={requestRevise}>Gửi yêu cầu sửa</button>
            <button className="btn-ghost" onClick={() => setReviseOpen(false)}>Thôi</button>
          </div>
        </div>
      )}
    </div>
  );
}
