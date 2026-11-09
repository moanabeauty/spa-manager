"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";
import { personName, type MkPerson } from "@/lib/marketing";

export type MkComment = { id: string; author_id: string; body: string; created_at: string };

const when = (iso: string) =>
  new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(new Date(iso));

/** Khung trao đổi dưới mỗi bài viết / kế hoạch */
export default function CommentThread({ target, id, comments, people, me, isOwner }: {
  target: "post" | "plan"; id: string; comments: MkComment[]; people: MkPerson[]; me: string; isOwner: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    setErr("");
    const { error } = await createClient()
      .from("marketing_comments")
      .insert({ [target === "post" ? "post_id" : "plan_id"]: id, body: text.trim() });
    setBusy(false);
    if (error) return setErr(vnError(error.message));
    setText("");
    router.refresh();
  }

  async function remove(cid: string) {
    if (!confirm("Xoá tin nhắn này?")) return;
    const { error } = await createClient().from("marketing_comments").delete().eq("id", cid);
    if (error) return setErr(vnError(error.message));
    router.refresh();
  }

  return (
    <div className="card space-y-3">
      <h2 className="font-semibold text-navy">Trao đổi ({comments.length})</h2>
      {comments.length === 0 && <p className="text-sm text-ink/60">Chưa có trao đổi. Góp ý, gửi link, hỏi đáp về nội dung ở đây.</p>}
      <ul className="space-y-2">
        {comments.map((c) => {
          const mine = c.author_id === me;
          return (
            <li key={c.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-navy text-white" : "bg-cream text-ink"}`}>
                <p className={`text-[11px] ${mine ? "text-white/70" : "text-ink/60"}`}>
                  {mine ? "Tôi" : personName(people, c.author_id)} · {when(c.created_at)}
                  {(mine || isOwner) && (
                    <button onClick={() => remove(c.id)} className="ml-2 underline opacity-70 hover:opacity-100">xoá</button>
                  )}
                </p>
                <p className="whitespace-pre-wrap break-words">{linkify(c.body, mine)}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex items-end gap-2">
        <textarea
          className="input min-h-[44px] flex-1 py-2"
          rows={2}
          placeholder="Nhập góp ý / trao đổi…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
          }}
        />
        <button className="btn-primary" disabled={busy || !text.trim()} onClick={send}>Gửi</button>
      </div>
      {err && <p className="text-sm text-[#8A2323]">{err}</p>}
    </div>
  );
}

/** Biến link trong tin nhắn thành link bấm được */
function linkify(s: string, light: boolean) {
  const parts = s.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noreferrer" className={`underline ${light ? "text-white" : "text-navy"}`}>
        {p}
      </a>
    ) : (
      p
    ),
  );
}
