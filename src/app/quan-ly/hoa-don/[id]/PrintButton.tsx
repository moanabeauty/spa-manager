"use client";

export default function PrintButton() {
  return (
    <button className="btn-primary" onClick={() => window.print()}>
      In hoá đơn
    </button>
  );
}
