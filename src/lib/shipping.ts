// Trạng thái giao hàng của đơn online
// Đã lên đơn = hàng đang GIỮ trong kho (chưa trừ tồn) · Đã ship khách = hàng đã rời kho (đã trừ tồn)
// Đã hoàn thành (delivered) = đã ship + khách đã trả đủ / đã thu được COD → app TỰ chuyển, không bấm tay
// Hoàn hàng: nếu hàng đã gửi đi thì tự nhập lại kho; nếu chưa gửi thì chỉ bỏ giữ hàng
export const SHIP_STATUS: Record<string, { label: string; cls: string }> = {
  preparing: { label: "Đã lên đơn", cls: "bg-[#FFE8BA] text-[#7A5600]" },
  shipping: { label: "Đã ship khách", cls: "bg-[#DCE3F5] text-navy" },
  delivered: { label: "Đã hoàn thành", cls: "bg-[#D6EDD8] text-[#22612A]" },
  returned: { label: "Hoàn hàng", cls: "bg-[#F6D5D5] text-[#8A2323]" },
};

/** Hàng của đơn online đang giữ: kho bán lẻ -> sản phẩm -> số lượng */
export type Reserved = { warehouse_id: string; branch_id: string; product_id: string; quantity: number };
