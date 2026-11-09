"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";
import { compressPhoto, thumbPath } from "@/lib/photoCompress";
import { ANGLES, PHOTO_BUCKET, type Photo } from "@/lib/photos";
import PhotoViewer from "./PhotoViewer";

type Target = { phase: "before" | "after"; angle: Photo["angle"] };
const MAX_BEFORE = 5;

function CameraIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

/**
 * Chụp / gửi ảnh TRƯỚC – SAU của 1 buổi.
 * TRƯỚC (sau tẩy trang): 3 góc bắt buộc + tối đa 2 ảnh thêm. SAU (kết thúc liệu trình): 3 góc.
 */
export default function SessionPhotos({
  appointmentId,
  photos,
  editable,
  required,
  skipReason,
  highlight,
}: {
  appointmentId: string;
  photos: Photo[];
  editable: boolean;
  required: boolean;
  skipReason: string | null;
  highlight?: "before" | "after" | null;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "before-left"...
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<{ list: Photo[]; i: number } | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [reason, setReason] = useState("");

  const before = photos.filter((p) => p.phase === "before");
  const after = photos.filter((p) => p.phase === "after");
  const beforeMain = before.filter((p) => p.angle !== "extra");
  const extras = before.filter((p) => p.angle === "extra");

  function pick(t: Target) {
    if (!editable || busy) return;
    setTarget(t);
    setError(null);
    input.current?.click();
  }

  async function onFile(file: File | undefined) {
    const t = target;
    if (input.current) input.current.value = "";
    if (!file || !t) return;
    const key = `${t.phase}-${t.angle}`;
    setBusy(key);
    setError(null);
    const supabase = createClient();
    try {
      const c = await compressPhoto(file);
      const path = `${appointmentId}/${t.phase}-${t.angle}-${Date.now()}.${c.ext}`;
      const store = supabase.storage.from(PHOTO_BUCKET);
      const [a, b] = await Promise.all([
        store.upload(path, c.full, { contentType: c.type, cacheControl: "31536000", upsert: false }),
        store.upload(thumbPath(path), c.thumb, { contentType: c.thumb.type, cacheControl: "31536000", upsert: false }),
      ]);
      if (a.error || b.error) {
        await store.remove([path, thumbPath(path)]);
        throw new Error((a.error ?? b.error)?.message);
      }
      const { data: old, error: e } = await supabase.rpc("add_session_photo", {
        p_appt: appointmentId,
        p_phase: t.phase,
        p_angle: t.angle,
        p_path: path,
        p_bytes: c.full.size,
        p_width: c.width,
        p_height: c.height,
      });
      if (e) {
        await store.remove([path, thumbPath(path)]);
        throw new Error(e.message);
      }
      if (old) await store.remove([old as string, thumbPath(old as string)]);
      router.refresh();
    } catch (e) {
      setError(vnError(e instanceof Error ? e.message : undefined));
    } finally {
      setBusy(null);
      setTarget(null);
    }
  }

  async function remove(p: Photo) {
    if (!confirm("Xoá ảnh này?")) return;
    const supabase = createClient();
    const { data, error: e } = await supabase.rpc("delete_session_photo", { p_id: p.id });
    if (e) return setError(vnError(e.message));
    if (data) await supabase.storage.from(PHOTO_BUCKET).remove([data as string, thumbPath(data as string)]);
    setView(null);
    router.refresh();
  }

  async function saveSkip(r: string) {
    const { error: e } = await createClient().rpc("skip_session_photos", { p_appt: appointmentId, p_reason: r });
    if (e) return setError(vnError(e.message));
    setSkipping(false);
    setReason("");
    router.refresh();
  }

  function Tile({ phase, angle, label, photo, list }: { phase: Target["phase"]; angle: Photo["angle"]; label: string; photo?: Photo; list: Photo[] }) {
    const key = `${phase}-${angle}`;
    const loading = busy === key && angle !== "extra";
    return (
      <button
        type="button"
        className={`relative aspect-[3/4] overflow-hidden rounded-[10px] text-[11px] ${
          photo ? "bg-black" : "border-[1.5px] border-dashed border-[#A0845E] bg-cream text-[#5E4B30]"
        } ${!photo && !editable ? "opacity-50" : ""}`}
        onClick={() => (photo ? setView({ list, i: list.indexOf(photo) }) : pick({ phase, angle }))}
        disabled={!photo && !editable}
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.thumbUrl} alt={label} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full flex-col items-center justify-center gap-1">
            {loading ? <span className="animate-pulse">Đang gửi…</span> : <CameraIcon />}
            {!loading && <span className="font-semibold">{label}</span>}
          </span>
        )}
        {photo && <span className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-center text-white">{loading ? "Đang gửi…" : label}</span>}
      </button>
    );
  }

  const beforeList = [...ANGLES.map((a) => beforeMain.find((p) => p.angle === a.key)).filter(Boolean), ...extras] as Photo[];
  const afterList = ANGLES.map((a) => after.find((p) => p.angle === a.key)).filter(Boolean) as Photo[];
  const beforeOk = beforeMain.length >= 3;
  const afterOk = after.length >= 3;

  return (
    <div className="space-y-3 rounded-[14px] bg-white p-3.5">
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[15px] font-bold">Ảnh Trước – Sau buổi này</p>
        {required && !skipReason && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${beforeOk && afterOk ? "bg-[#E4F2E9] text-[#1F5E3A]" : "bg-beige text-[#5E4B30]"}`}>
            {beforeOk && afterOk ? "✓ Đủ ảnh" : "Bắt buộc"}
          </span>
        )}
      </div>

      {skipReason && (
        <div className="flex items-start justify-between gap-2 rounded-[10px] bg-beige px-3 py-2 text-xs text-[#5E4B30]">
          <span><b>Không chụp ảnh:</b> {skipReason}</span>
          {editable && <button className="shrink-0 font-semibold underline" onClick={() => saveSkip("")}>Bỏ</button>}
        </div>
      )}

      <div className={`space-y-1.5 rounded-[12px] p-2 ${highlight === "before" && !beforeOk ? "ring-2 ring-navy" : ""}`}>
        <p className="text-[13px] font-semibold">
          TRƯỚC · sau khi tẩy trang <span className="font-normal text-[#646464]">({before.length}/{MAX_BEFORE} · tối thiểu 3)</span>
        </p>
        <div className="grid grid-cols-3 gap-2">
          {ANGLES.map((a) => (
            <Tile key={a.key} phase="before" angle={a.key} label={a.label} photo={beforeMain.find((p) => p.angle === a.key)} list={beforeList} />
          ))}
          {extras.map((p, n) => (
            <Tile key={p.id} phase="before" angle="extra" label={`Thêm ${n + 1}`} photo={p} list={beforeList} />
          ))}
          {editable && before.length < MAX_BEFORE && beforeOk && (
            <button
              type="button"
              className="flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-[10px] border-[1.5px] border-dashed border-[#C9CADB] text-[11px] text-[#646464]"
              onClick={() => pick({ phase: "before", angle: "extra" })}
              disabled={!!busy}
            >
              {busy === "before-extra" ? <span className="animate-pulse">Đang gửi…</span> : <>+ <span>Ảnh thêm</span></>}
            </button>
          )}
        </div>
      </div>

      <div className={`space-y-1.5 rounded-[12px] p-2 ${highlight === "after" && !afterOk ? "ring-2 ring-navy" : ""}`}>
        <p className="text-[13px] font-semibold">
          SAU · khi kết thúc liệu trình <span className="font-normal text-[#646464]">({after.length}/3)</span>
        </p>
        <div className="grid grid-cols-3 gap-2">
          {ANGLES.map((a) => (
            <Tile key={a.key} phase="after" angle={a.key} label={a.label} photo={after.find((p) => p.angle === a.key)} list={afterList} />
          ))}
        </div>
      </div>

      {editable && (
        <p className="text-[11px] leading-snug text-[#646464]">
          Mẹo để soi rõ lỗ chân lông: chụp gần (mặt chiếm gần hết khung), đủ sáng, tắt đèn flash, giữ máy ngang tầm mặt và cùng khoảng cách ở ảnh trước và sau. Ảnh được nén trước khi gửi nên rất nhẹ.
        </p>
      )}
      {error && <p className="text-xs text-[#B3261E]">{error}</p>}

      {editable && required && !skipReason && (
        skipping ? (
          <div className="space-y-2">
            <input className="input py-2 text-sm" placeholder="Lý do (vd khách không đồng ý chụp)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setSkipping(false)}>Huỷ</button>
              <button className="btn-primary flex-1" disabled={!reason.trim()} onClick={() => saveSkip(reason)}>Lưu lý do</button>
            </div>
          </div>
        ) : (
          <button className="text-xs font-semibold text-[#7A6242] underline" onClick={() => setSkipping(true)}>
            Khách không đồng ý chụp / không chụp được?
          </button>
        )
      )}

      {view && (
        <PhotoViewer
          photos={view.list}
          index={view.i}
          onClose={() => setView(null)}
          actions={
            editable
              ? (p) => (
                  <>
                    <button
                      className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-navy"
                      onClick={() => {
                        setView(null);
                        pick({ phase: p.phase, angle: p.angle === "extra" ? "extra" : p.angle });
                      }}
                      hidden={p.angle === "extra"}
                    >
                      Chụp lại
                    </button>
                    <button className="rounded-xl bg-[#B3261E] px-4 py-2.5 text-sm font-semibold" onClick={() => remove(p)}>
                      Xoá
                    </button>
                  </>
                )
              : undefined
          }
        />
      )}
    </div>
  );
}
