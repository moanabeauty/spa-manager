"use client";

import { useState } from "react";
import type { Product } from "@/lib/inventory";
import { ProductForm } from "../ProductEditor";

export default function ProductEdit({ product, cost, defaultPct, canMerge }: { product: Product; cost: number | null | undefined; defaultPct: number; canMerge: boolean }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button className="btn-primary w-full" onClick={() => setOpen(true)}>
        ✏️ Sửa thông tin sản phẩm
      </button>
    );
  return (
    <div className="card p-3">
      <ProductForm product={product} cost={cost} defaultPct={defaultPct} onDone={() => setOpen(false)} canMerge={canMerge} />
    </div>
  );
}
