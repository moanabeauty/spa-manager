"use client";

import { useEffect, useState } from "react";
import { ANGLE_LABEL, type Photo } from "@/lib/photos";

/** Xem ảnh toàn màn hình: vuốt/bấm ‹ › chuyển ảnh, chụm 2 ngón để phóng to, mở ảnh gốc ở tab mới */
export default function PhotoViewer({
  photos,
  index,
  onClose,
  actions,
}: {
  photos: Photo[];
  index: number;
  onClose: () => void;
  actions?: (p: Photo) => React.ReactNode;
}) {
  const [i, setI] = useState(index);
  const [touchX, setTouchX] = useState<number | null>(null);
  const p = photos[i];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((x) => Math.min(photos.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [photos.length, onClose]);

  if (!p) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <p className="text-sm">
          <b>{p.phase === "before" ? "TRƯỚC" : "SAU"}</b> · {ANGLE_LABEL[p.angle]} · {i + 1}/{photos.length}
        </p>
        <button className="min-h-10 min-w-10 rounded-full bg-white/15 text-lg" onClick={onClose} aria-label="Đóng">
          ✕
        </button>
      </div>
      <div
        className="relative flex flex-1 items-center justify-center overflow-auto"
        onTouchStart={(e) => e.touches.length === 1 && setTouchX(e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX === null) return;
          const dx = e.changedTouches[0].clientX - touchX;
          setTouchX(null);
          if (Math.abs(dx) > 60) setI((x) => Math.max(0, Math.min(photos.length - 1, x + (dx < 0 ? 1 : -1))));
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.url} alt={`${p.phase === "before" ? "Trước" : "Sau"} – ${ANGLE_LABEL[p.angle]}`} className="max-h-full max-w-full object-contain" />
        {i > 0 && (
          <button className="absolute left-2 top-1/2 h-11 w-11 -translate-y-1/2 rounded-full bg-black/50 text-2xl" onClick={() => setI(i - 1)} aria-label="Ảnh trước">
            ‹
          </button>
        )}
        {i < photos.length - 1 && (
          <button className="absolute right-2 top-1/2 h-11 w-11 -translate-y-1/2 rounded-full bg-black/50 text-2xl" onClick={() => setI(i + 1)} aria-label="Ảnh sau">
            ›
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        <a href={p.url} target="_blank" rel="noreferrer" className="rounded-xl bg-white/15 px-4 py-2.5 text-sm font-semibold">
          Mở ảnh gốc để phóng to
        </a>
        {actions?.(p)}
      </div>
    </div>
  );
}
