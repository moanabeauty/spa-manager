"use client";

import { useRouter } from "next/navigation";

/** Quay lại màn trước (vd. Hôm nay của KTV sau khi tìm liệu trình) */
export default function BackLink() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push("/quan-ly"))}
      className="flex min-h-8 items-center text-sm font-semibold text-navy"
    >
      ‹ Quay lại
    </button>
  );
}
