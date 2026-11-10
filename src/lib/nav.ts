// Cấu trúc điều hướng khu nhân viên: 7 nhóm, mỗi nhóm có các mục con. Mục nào không có quyền thì ẩn.
import type { Profile } from "@/lib/supabase/server";

type Role = Profile["role"];
export type NavItem = { href: string; label: string; badge?: number };
export type NavGroup = { key: string; label: string; icon: IconName; items: NavItem[]; badge: number };
export type IconName = "home" | "desk" | "users" | "box" | "staff" | "chart" | "settings" | "megaphone" | "check";

/** Số việc đang chờ (hiện trên nhóm / mục) */
export type NavCounts = {
  discounts: number; // giảm giá + cho nợ chờ duyệt
  vouchers: number; // phiếu thu chi chờ duyệt
  promos: number; // khách đăng ký khuyến mãi chờ xác nhận
  care: number; // nhắc chăm sóc đến hạn
  stockRequests: number; // phiếu xin xuất chờ duyệt
  stockCounts: number; // phiếu kiểm kho lệch chờ chủ duyệt
  receipts: number; // phiếu nhập chờ chủ nhập giá & duyệt
  attendance: number; // chấm công + tăng ca chờ duyệt
  leaves: number; // đơn nghỉ phép chờ duyệt
  ktv: number; // KTV xin đổi sản phẩm + chấm vào sớm + xin sửa công
  marketing: number; // chủ: bài chờ duyệt · Marketing: bài cần sửa
};

/** Tổng số việc cần chủ / quản lý duyệt (gom ở trang Việc chờ duyệt) */
export function approvalTotal(role: Role, c: NavCounts): number {
  if (role !== "owner" && role !== "manager") return 0;
  return c.discounts + c.vouchers + c.attendance + c.leaves + c.ktv + c.stockRequests + (role === "owner" ? c.stockCounts + c.receipts + c.marketing : 0);
}

export function buildNav(role: Role, c: NavCounts): NavGroup[] {
  const M = role === "owner" || role === "manager";
  const O = role === "owner";
  const W = role === "warehouse";
  const MK = role === "marketing"; // Marketing: chỉ tab Marketing + phiếu thu/chi + nghỉ phép
  const L = W || MK; // không làm việc với khách hàng
  const stockManage = M || W;
  const item = (ok: boolean, href: string, label: string, badge?: number): NavItem[] => (ok ? [{ href, label, badge: badge || undefined }] : []);

  const marketingGroup: Omit<NavGroup, "badge"> = {
    key: "marketing",
    label: "Marketing",
    icon: "megaphone",
    items: [
      { href: "/quan-ly/marketing", label: "Lịch bài viết", badge: c.marketing || undefined },
      { href: "/quan-ly/marketing/ke-hoach", label: "Quay · chụp · họp" },
    ],
  };
  const groups: Omit<NavGroup, "badge">[] = [
    { key: "tong-quan", label: "Tổng quan", icon: "home", items: item(!MK, "/quan-ly", "Tổng quan") },
    { key: "cho-duyet", label: "Chờ duyệt", icon: "check", items: item(M, "/quan-ly/cho-duyet", "Việc chờ duyệt", approvalTotal(role, c)) },
    ...(MK ? [marketingGroup] : []),
    {
      key: "quan-ly",
      label: "Quản lý",
      icon: "desk",
      items: [
        ...item(!L, "/quan-ly/lich-hen", "Lịch hẹn"),
        ...item(!L, "/quan-ly/thu-tien", "Thu tiền"),
        ...item(!L, "/quan-ly/hoa-don", "Hoá đơn"),
        ...item(true, "/quan-ly/phieu-thu-chi", "Thu chi tiền mặt tại spa", M ? c.vouchers : 0),
        ...item(M, "/quan-ly/duyet-giam-gia", "Duyệt giảm giá & nợ", c.discounts),
        ...item(M, "/quan-ly/theo-doi-ktv", "Theo dõi KTV", c.ktv),
      ],
    },
    {
      key: "khach-hang",
      label: "Khách hàng",
      icon: "users",
      items: [
        ...item(!L, "/quan-ly/khach-hang", "Danh sách khách"),
        ...item(!L, "/quan-ly/phieu-da", "Phiếu theo dõi da"),
        ...item(!L, "/quan-ly/cham-soc", "Chăm sóc lại", c.care),
        ...item(!L, "/quan-ly/khuyen-mai", "Đăng ký khuyến mãi", c.promos),
        ...item(M, "/quan-ly/khach-hang/nhom", "Nhóm khách"),
      ],
    },
    {
      key: "kho",
      label: "Kho",
      icon: "box",
      items: [
        ...item(!MK, "/quan-ly/kho", "Tồn kho"),
        ...item(stockManage, "/quan-ly/kho/nhap-hang", "Nhập hàng", O ? c.receipts : 0),
        ...item(!MK, "/quan-ly/kho/xin-xuat", stockManage ? "Phiếu xin xuất" : "Xin xuất hàng", stockManage ? c.stockRequests : 0),
        ...item(stockManage, "/quan-ly/kho/kiem-kho", "Kiểm kho", O ? c.stockCounts : 0),
        ...item(stockManage, "/quan-ly/kho/chuyen-kho", "Chuyển kho"),
        ...item(!MK, "/quan-ly/kho/san-pham", "Sản phẩm"),
        ...item(!MK, "/quan-ly/kho/lich-su", "Lịch sử nhập / xuất"),
      ],
    },
    {
      key: "nhan-su",
      label: "Nhân sự",
      icon: "staff",
      items: [
        ...item(!O && !W, "/quan-ly/ca-nhan", "Của tôi"),
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
        ...item(!L, "/quan-ly/doanh-so", M ? "Doanh số & hoa hồng" : "Doanh số của tôi"),
        ...item(M, "/quan-ly/bao-cao", "Doanh thu"),
        ...item(M, "/quan-ly/bao-cao/goi-the", "Gói & thẻ còn nợ khách"),
        ...item(M, "/quan-ly/bao-cao/cong-no", "Công nợ khách"),
        ...item(O, "/quan-ly/kho/cong-no-ncc", "Công nợ nhà cung cấp"),
        ...item(O, "/quan-ly/thu-chi", "Sổ quỹ & lợi nhuận"),
      ],
    },
    ...(O ? [marketingGroup] : []),
    {
      key: "cai-dat",
      label: "Cài đặt",
      icon: "settings",
      items: [
        ...item(M, "/quan-ly/dich-vu", "Menu dịch vụ"),
        ...item(M, "/quan-ly/goi-combo", "Gói combo"),
        ...item(M, "/quan-ly/khuyen-mai/chuong-trinh", "Chương trình khuyến mãi"),
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
  // (không cộng nhóm Chờ duyệt vì các việc đó đã tính trong nhóm gốc)
  const total = out.reduce((a, g) => a + (g.key === "tong-quan" || g.key === "cho-duyet" ? 0 : g.badge), 0);
  const home = out.find((g) => g.key === "tong-quan");
  if (home) home.badge = total;
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
