// Trạng thái giao hàng của đơn online
// Đã lên đơn = hàng đang GIỮ trong kho (chưa trừ tồn) · Đang giao / Đã giao = hàng đã rời kho (đã trừ tồn)
// Hoàn hàng: nếu hàng đã gửi đi thì tự nhập lại kho; nếu chưa gửi thì chỉ bỏ giữ hàng
export const SHIP_STATUS: Record<string, { label: string; cls: string }> = {
  preparing: { label: "Đã lên đơn", cls: "bg-[#FFE8BA] text-[#7A5600]" },
  shipping: { label: "Đang giao", cls: "bg-[#DCE3F5] text-navy" },
  delivered: { label: "Đã giao", cls: "bg-[#D6EDD8] text-[#22612A]" },
  returned: { label: "Hoàn hàng", cls: "bg-[#F6D5D5] text-[#8A2323]" },
};

/** Hàng của đơn online đang giữ: kho bán lẻ -> sản phẩm -> số lượng */
export type Reserved = { warehouse_id: string; branch_id: string; product_id: string; quantity: number };
