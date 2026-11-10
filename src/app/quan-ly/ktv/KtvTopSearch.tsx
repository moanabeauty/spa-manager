"use client";

import { usePathname } from "next/navigation";
import KtvServiceSearch from "./KtvServiceSearch";

// Các màn có phần đầu trang màu navy riêng: Hôm nay (đã có ô tìm), Đặt lịch, Cá nhân, Chi tiết lịch, Quy trình, Ngoài giờ
const HERO = ["/quan-ly/ktv/dat-lich", "/quan-ly/ca-nhan", "/quan-ly/ktv/lich/", "/quan-ly/ktv/lieu-trinh/", "/quan-ly/ngoai-gio"];

/** Ô tìm liệu trình ở đầu các màn còn lại của app KTV (Bán hàng, Hoá đơn, Kho, Doanh số, Nghỉ phép…) */
export default function KtvTopSearch() {
  const path = usePathname();
  if (path === "/quan-ly" || HERO.some((h) => path.startsWith(h))) return null;
  return (
    <div className="rounded-xl ring-1 ring-beige-dark print:hidden">
      <KtvServiceSearch />
    </div>
  );
}
