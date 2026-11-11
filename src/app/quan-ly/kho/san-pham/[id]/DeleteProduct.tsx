"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";
import { productLabel, type Product } from "@/lib/inventory";

// Xoá mã sản phẩm: chủ spa, quản lý, NV kho. Chỉ xoá được khi tổng tồn kho = 0 và không còn chứng từ đang chờ
// (phiếu nhập / yêu cầu xuất / kiểm kho chờ duyệt, hoá đơn chưa thanh toán, khuyến mãi đang chạy).
// Mã chưa từng dùng → xoá hẳn. Mã đã có lịch sử → ẩn khỏi app, lịch sử & giá vốn đã xuất (nhập trước xuất trước) giữ nguyên.
export default function DeleteProduct({ product }: { product: Product }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    const label = [product.sku, productLabel(product)].filter(Boolean).join(" · ");
    if (!window.confirm(`Xoá mã sản phẩm "${label}"?\n\nChỉ xoá được khi đã hết tồn kho. Lịch sử nhập / xuất và giá vốn cũ vẫn được giữ để tính sổ sách.\nSản phẩm sẽ biến mất khỏi danh sách, tìm kiếm và quét mã.`)) return;
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("delete_product", { p_id: product.id });
    setBusy(false);
    if (error) return setError(vnError(error.message));
    router.replace("/quan-ly/kho/san-pham");
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <button
        className="w-full rounded-xl border border-[#8A2323] py-2 text-sm font-semibold text-[#8A2323] disabled:opacity-50"
        disabled={busy}
        onClick={remove}
      >
        {busy ? "Đang xoá…" : "🗑️ Xoá mã sản phẩm"}
      </button>
      {error && <p className="rounded-lg bg-[#FBEAEA] px-3 py-2 text-sm text-[#8A2323]">{error}</p>}
    </div>
  );
}
