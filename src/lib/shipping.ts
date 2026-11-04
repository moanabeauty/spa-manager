// Trạng thái giao hàng của đơn online
export const SHIP_STATUS: Record<string, { label: string; cls: string }> = {
  preparing: { label: "Đang chuẩn bị", cls: "bg-[#FFE8BA] text-[#7A5600]" },
  shipping: { label: "Đang giao", cls: "bg-[#DCE3F5] text-navy" },
  delivered: { label: "Đã giao", cls: "bg-[#D6EDD8] text-[#22612A]" },
  returned: { label: "Hoàn hàng", cls: "bg-[#F6D5D5] text-[#8A2323]" },
};
