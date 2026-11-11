"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";
import { productLabel, type Product } from "@/lib/inventory";

// Xoá mã sản phẩm tạo nhầm / trùng. Chỉ chủ spa & quản lý thấy nút này.
// Sản phẩm đã có nhập/xuất, phiếu nhập, hoá đơn… thì hệ thống không cho xoá (báo lý do) → dùng "Ngừng lưu hành".
export default function DeleteProduct({ product }: { product: Product }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    const label = [product.sku, productLabel(product)].filter(Boolean).join(" · ");
    if (!window.confirm(`Xoá hẳn mã sản phẩm "${label}"?\nKhông khôi phục lại được.`)) return;
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
