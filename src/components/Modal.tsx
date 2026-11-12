"use client";

import { useEffect } from "react";

/** Cửa sổ nổi (VD: form thêm sản phẩm). Bấm nền tối hoặc phím Esc để đóng. */
export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  size = "max-w-2xl",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-[#1f2050]/45 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[92vh] w-full ${size} flex-col overflow-hidden rounded-t-3xl bg-surface shadow-2xl sm:rounded-3xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-beige px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-navy">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-ink/55">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink/50 hover:bg-cream" aria-label="Đóng">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 sm:px-6">{children}</div>
      </div>
    </div>
  );
}
