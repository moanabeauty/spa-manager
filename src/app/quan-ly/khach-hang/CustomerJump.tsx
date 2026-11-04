"use client";

import { useRouter } from "next/navigation";
import CustomerSearch from "@/components/CustomerSearch";

/** Gõ SĐT / mã KH / tên → chọn gợi ý để mở thẳng hồ sơ khách */
export default function CustomerJump() {
  const router = useRouter();
  return (
    <CustomerSearch
      placeholder="Tìm nhanh: SĐT, mã KH (vd KH00012) hoặc tên khách…"
      onPick={(c) => router.push(`/quan-ly/khach-hang?id=${c.id}`)}
    />
  );
}
