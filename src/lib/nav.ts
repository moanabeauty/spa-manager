// Cấu trúc điều hướng khu nhân viên: 7 nhóm, mỗi nhóm có các mục con. Mục nào không có quyền thì ẩn.
import type { Profile } from "@/lib/supabase/server";

type Role = Profile["role"];
export type NavItem = { href: string; label: string; badge?: number };
export type NavGroup = { key: string; label: string; icon: IconName; items: NavItem[]; badge: number };
export type IconName = "home" | "desk" | "users" | "box" | "staff" | "chart" | "settings";

/** Số việc đang chờ (hiện trên nhóm / mục) */
export type NavCounts = {
  discounts: number; // giảm giá + cho nợ chờ duyệt
  vouchers: number; // phiếu thu chi chờ duyệt
  promos: number; // khách đăng ký khuyến mãi chờ xác nhận
  care: number; // nhắc chăm sóc đến hạn
  stockRequests: number; // phiếu xin xuất chờ duyệt
  stockCounts: number; // phiếu kiểm kho lệch chờ chủ duyệt
  attendance: number; // chấm công + tăng ca chờ duyệt
  leaves: number; // đơn nghỉ phép chờ duyệt
};

export function buildNav(role: Role, c: NavCounts): NavGroup[] {
  const M = role === "owner" || role === "manager";
  const O = role === "owner";
  const W = role === "warehouse";
  const stockManage = M || W;
  const item = (ok: boolean, href: string, label: string, badge?: number): NavItem[] => (ok ? [{ href, label, badge: badge || undefined }] : []);

  const groups: Omit<NavGroup, "badge">[] = [
    { key: "tong-quan", label: "Tổng quan", icon: "home", items: item(true, "/quan-ly", "Tổng quan") },
    {
      key: "quan-ly",
      label: "Quản lý",
      icon: "desk",
      items: [
        ...item(!W, "/quan-ly/lich-hen", "Lịch hẹn"),
        ...item(!W, "/quan-ly/tao-lich", "+ Tạo lịch"),
        ...item(!W, "/quan-ly/thu-tien", "Thu tiền"),
        ...item(!W, "/quan-ly/hoa-don", "Hoá đơn"),
        ...item(true, "/quan-ly/phieu-thu-chi", "Phiếu thu / chi", M ? c.vouchers : 0),
        ...item(M, "/quan-ly/duyet-giam-gia", "Duyệt giảm giá & nợ", c.discounts),
      ],
    },
    {
      key: "khach-hang",
      label: "Khách hàng",
      icon: "users",
      items: [
        ...item(!W, "/quan-ly/khach-hang", "Danh sách khách"),
        ...item(!W, "/quan-ly/phieu-da", "Phiếu theo dõi da"),
        ...item(!W, "/quan-ly/cham-soc", "Chăm sóc lại", c.care),
        ...item(!W, "/quan-ly/khuyen-mai", "Đăng ký khuyến mãi", c.promos),
        ...item(M, "/quan-ly/khach-hang/nhom", "Nhóm khách"),
      ],
    },
    {
      key: "kho",
      label: "Kho",
      icon: "box",
      items: [
        ...item(true, "/quan-ly/kho", "Tồn kho"),
        ...item(stockManage, "/quan-ly/kho/nhap-hang", "Nhập hàng"),
        ...item(true, "/quan-ly/kho/xin-xuat", stockManage ? "Phiếu xin xuất" : "Xin xuất hàng", stockManage ? c.stockRequests : 0),
        ...item(stockManage, "/quan-ly/kho/kiem-kho", "Kiểm kho", O ? c.stockCounts : 0),
        ...item(stockManage, "/quan-ly/kho/chuyen-kho", "Chuyển kho"),
        ...item(true, "/quan-ly/kho/san-pham", "Sản phẩm"),
        ...item(true, "/quan-ly/kho/lich-su", "Lịch sử nhập / xuất"),
      ],
    },
    {
      key: "nhan-su",
      label: "Nhân sự",
      icon: "staff",
      items: [
        ...item(M, "/quan-ly/cham-cong", "Chấm công & tăng ca", c.attendance),
        ...item(true, "/quan-ly/nghi-phep", "Nghỉ phép", M ? c.leaves : 0),
        ...item(O, "/quan-ly/bang-luong", "Bảng lương"),
        ...item(O, "/quan-ly/nhan-vien", "Nhân viên & phân quyền"),
      ],
    },
    {
      key: "bao-cao",
      label: "Báo cáo",
      icon: "chart",
      items: [
        ...item(!W, "/quan-ly/doanh-so", M ? "Doanh số & hoa hồng" : "Doanh số của tôi"),
        ...item(M, "/quan-ly/bao-cao", "Doanh thu"),
        ...item(M, "/quan-ly/bao-cao/goi-the", "Gói & thẻ còn nợ khách"),
        ...item(M, "/quan-ly/bao-cao/cong-no", "Công nợ khách"),
        ...item(O, "/quan-ly/thu-chi", "Thu chi & lợi nhuận"),
      ],
    },
    {
      key: "cai-dat",
      label: "Cài đặt",
      icon: "settings",
      items: [
        ...item(M, "/quan-ly/dich-vu", "Menu dịch vụ"),
        ...item(M, "/quan-ly/goi-combo", "Gói combo"),
        ...item(M, "/quan-ly/khuyen-mai/chuong-trinh", "Chương trình khuyến mãi"),
        ...item(M, "/quan-ly/kho/san-pham", "Danh mục sản phẩm"),
        ...item(M, "/quan-ly/cai-dat/bai-viet", "Bài viết web khách"),
        ...item(O, "/quan-ly/cai-dat/crm", "Cài đặt CRM"),
        ...item(O, "/quan-ly/cai-dat/luong", "Lương nhân viên"),
        ...item(O, "/quan-ly/cai-dat/ngay-lam-viec", "Ngày làm việc & ngày lễ"),
      ],
    },
  ];
  const out = groups
    .filter((g) => g.items.length > 0)
    .map((g) => ({ ...g, badge: g.items.reduce((a, i) => a + (i.badge ?? 0), 0) }));
  // Tổng quan: tổng số việc chờ duyệt / xử lý
  const total = out.reduce((a, g) => a + (g.key === "tong-quan" ? 0 : g.badge), 0);
  out[0].badge = total;
  return out;
}

/** Mục đang mở = mục có đường dẫn khớp dài nhất (nhóm xuất hiện trước được ưu tiên khi trùng) */
export function activeNav(groups: NavGroup[], path: string): { group: NavGroup | null; item: NavItem | null } {
  let best: { group: NavGroup; item: NavItem } | null = null;
  for (const g of groups)
    for (const i of g.items) {
      const ok = i.href === "/quan-ly" ? path === "/quan-ly" : path === i.href || path.startsWith(i.href + "/");
      if (ok && (!best || i.href.length > best.item.href.length)) best = { group: g, item: i };
    }
  return best ?? { group: null, item: null };
}
