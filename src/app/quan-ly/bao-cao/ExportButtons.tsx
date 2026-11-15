"use client";

// Xuất báo cáo ra file Excel (CSV, mở thẳng bằng Excel / Google Sheets) hoặc in / lưu PDF
export default function ExportButtons({ filename, rows }: { filename: string; rows: (string | number)[][] }) {
  function download() {
    const esc = (v: string | number) => {
      const s = String(v ?? "");
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const text = rows.map((r) => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <button type="button" className="btn-primary py-2 text-sm" onClick={download}>
        ⬇ Xuất Excel
      </button>
      <button type="button" className="btn-outline py-2 text-sm" onClick={() => window.print()}>
        In / lưu PDF
      </button>
    </div>
  );
}
