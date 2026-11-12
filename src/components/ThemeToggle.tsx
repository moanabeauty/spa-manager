"use client";

import { useEffect, useState } from "react";

const KEY = "moana-theme";

/** Nút chuyển chế độ sáng / tối (lưu trên máy, chỉ áp dụng khu nhân viên) */
export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      // trình duyệt chặn lưu – chỉ đổi cho lần này
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-navy ring-1 ring-beige-dark/70 hover:bg-beige"
      aria-label={dark ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối"}
      title={dark ? "Chế độ sáng" : "Chế độ tối"}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {dark ? (
          <path d="M12 3v1.5M12 19.5V21M4.2 4.2l1 1M18.8 18.8l1 1M3 12h1.5M19.5 12H21M4.2 19.8l1-1M18.8 5.2l1-1M12 16.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9z" />
        ) : (
          <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
        )}
      </svg>
    </button>
  );
}

