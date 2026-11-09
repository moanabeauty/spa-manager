"use client";

import { useState } from "react";
import { formatShortDate } from "@/lib/format";
import { ANGLES, ANGLE_LABEL, type Photo, type PhotoSession } from "@/lib/photos";
import PhotoViewer from "./PhotoViewer";

const PAGE = 4;

/** Hồ sơ ảnh Trước – Sau của khách theo từng buổi (mới nhất trước). Mỗi buổi: hàng TRƯỚC / SAU × 3 góc. */
export default function PhotoHistory({ sessions, title = "Hình ảnh Trước – Sau", empty }: { sessions: PhotoSession[]; title?: string; empty?: string }) {
  const [shown, setShown] = useState(PAGE);
  const [view, setView] = useState<{ list: Photo[]; i: number } | null>(null);
  const [cmp, setCmp] = useState<string>("front"); // so sánh nhanh 1 góc qua các buổi

  if (sessions.length === 0) {
    return (
      <div className="space-y-1 rounded-[14px] bg-white p-3.5">
        <p className="text-[15px] font-bold">{title}</p>
        <p className="text-[13px] text-[#646464]">{empty ?? "Chưa có ảnh buổi nào."}</p>
      </div>
    );
  }

  // so sánh tiến triển: ảnh SAU (hoặc TRƯỚC nếu thiếu) của cùng 1 góc qua các buổi, cũ -> mới
  const progress = [...sessions]
    .reverse()
    .map((s) => s.photos.find((p) => p.angle === cmp && p.phase === "before") ?? s.photos.find((p) => p.angle === cmp))
    .filter(Boolean) as Photo[];

  return (
    <div className="space-y-3 rounded-[14px] bg-white p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[15px] font-bold">{title}</p>
        <span className="text-xs text-[#646464]">{sessions.length} buổi</span>
      </div>

      {sessions.length > 1 && progress.length > 1 && (
        <div className="space-y-1.5 rounded-[12px] bg-cream p-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-semibold">Tiến triển qua các buổi (ảnh TRƯỚC)</p>
            <select className="rounded-lg border border-[#E6DDCC] bg-white px-2 py-1 text-xs" value={cmp} onChange={(e) => setCmp(e.target.value)}>
              {ANGLES.map((a) => (
                <option key={a.key} value={a.key}>{a.label}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {progress.map((p, i) => (
              <button key={p.id} type="button" className="w-20 shrink-0 space-y-0.5 text-left" onClick={() => setView({ list: progress, i })}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumbUrl} alt="" loading="lazy" className="aspect-[3/4] w-full rounded-[8px] bg-black object-cover" />
                <span className="block text-[10px] text-[#646464]">{formatShortDate(sessions.find((s) => s.appointmentId === p.appointmentId)?.startAt ?? p.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {sessions.slice(0, shown).map((s) => {
        const ordered = [
          ...ANGLES.map((a) => s.photos.find((p) => p.phase === "before" && p.angle === a.key)),
          ...s.photos.filter((p) => p.phase === "before" && p.angle === "extra"),
          ...ANGLES.map((a) => s.photos.find((p) => p.phase === "after" && p.angle === a.key)),
        ].filter(Boolean) as Photo[];
        const row = (phase: "before" | "after") => (
          <div className="grid grid-cols-[2.6rem_repeat(3,minmax(0,1fr))] items-center gap-1.5">
            <span className="text-[11px] font-semibold text-[#646464]">{phase === "before" ? "TRƯỚC" : "SAU"}</span>
            {ANGLES.map((a) => {
              const p = s.photos.find((x) => x.phase === phase && x.angle === a.key);
              return p ? (
                <button key={a.key} type="button" onClick={() => setView({ list: ordered, i: ordered.indexOf(p) })} aria-label={`${phase === "before" ? "Trước" : "Sau"} ${a.label}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumbUrl} alt="" loading="lazy" className="aspect-[3/4] w-full rounded-[8px] bg-black object-cover" />
                </button>
              ) : (
                <span key={a.key} className="flex aspect-[3/4] items-center justify-center rounded-[8px] bg-cream text-[10px] text-[#A0A0A0]">—</span>
              );
            })}
          </div>
        );
        const extras = s.photos.filter((p) => p.phase === "before" && p.angle === "extra");
        return (
          <div key={s.appointmentId} className="space-y-1.5 border-t border-[#EFE8DA] pt-2.5 first:border-0 first:pt-0">
            <p className="text-[13px]">
              <b>{formatShortDate(s.startAt)}</b>
              {s.services ? <span className="text-[#646464]"> · {s.services}</span> : null}
            </p>
            <div className="grid grid-cols-[2.6rem_repeat(3,minmax(0,1fr))] gap-1.5 text-center text-[10px] text-[#646464]">
              <span />
              {ANGLES.map((a) => <span key={a.key}>{ANGLE_LABEL[a.key]}</span>)}
            </div>
            {row("before")}
            {row("after")}
            {extras.length > 0 && (
              <button type="button" className="text-xs font-semibold text-navy" onClick={() => setView({ list: ordered, i: ordered.indexOf(extras[0]) })}>
                + {extras.length} ảnh thêm ›
              </button>
            )}
          </div>
        );
      })}
      {sessions.length > shown && (
        <button className="w-full rounded-xl border border-[#E6DDCC] py-2 text-sm font-semibold text-navy" onClick={() => setShown(shown + PAGE)}>
          Xem thêm {Math.min(PAGE, sessions.length - shown)} buổi
        </button>
      )}

      {view && <PhotoViewer photos={view.list} index={view.i} onClose={() => setView(null)} />}
    </div>
  );
}
