import { getCurrentUser } from "@/lib/supabase/server";
import { PRODUCT_COLUMNS, canManageStock, type Product, type Warehouse } from "@/lib/inventory";
import { KhoNav, pickBranch } from "../shared";
import ReceiveForm, { type RecentReceipt } from "./ReceiveForm";
import ApproveReceipts, { type PendingReceipt } from "./ApproveReceipts";

export const metadata = { title: "Nhập hàng – Moana Beauty" };

export default async function ReceivePage({ searchParams }: { searchParams: Promise<{ cn?: string; kho?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  if (!canManageStock(profile?.role)) {
    return <p className="card text-sm">Chỉ quản lý kho, quản lý và chủ spa được nhập hàng.</p>;
  }
  const sp = await searchParams;
  const { data: branches } = await supabase.from("branches").select("id, name").eq("is_active", true).order("name");
  const { branchId, canSwitch } = pickBranch(profile, branches ?? [], sp.cn);

  const isOwner = profile!.role === "owner";
  const [{ data: whs }, { data: products }, { data: costs }, { data: receipts }, { data: pendingData }, { data: sups }, { data: ledger }] = await Promise.all([
    supabase.from("warehouses").select("id, branch_id, type, name"),
    supabase.from("products").select(PRODUCT_COLUMNS).order("name"),
    isOwner ? supabase.rpc("product_costs") : Promise.resolve({ data: [] }),
    supabase
      .from("stock_receipts")
      .select("id, code, supplier, created_at, status, warehouses(name), profiles!stock_receipts_created_by_fkey(full_name), stock_movements(quantity)")
      .order("created_at", { ascending: false })
      .limit(10),
    isOwner
      ? supabase
          .from("stock_receipts")
          .select("id, code, supplier, note, created_at, warehouses(name), profiles!stock_receipts_created_by_fkey(full_name), stock_movements(id, product_id, quantity, expiry_date)")
          .eq("status", "pending")
          .order("created_at")
      : Promise.resolve({ data: [] }),
    supabase.from("suppliers").select("name").order("name"),
    isOwner ? supabase.rpc("supplier_ledger") : Promise.resolve({ data: [] }),
  ]);
  // dư nợ hiện tại theo nhà cung cấp (tên viết thường)
  const debts: Record<string, number> = {};
  ((ledger ?? []) as { supplier: string | null; payable: number; paid: number }[]).forEach((r) => {
    if (!r.supplier) return;
    const k = r.supplier.toLowerCase();
    debts[k] = (debts[k] ?? 0) + Number(r.payable) - Number(r.paid);
  });
  const warehouses = ((whs ?? []) as Warehouse[]).filter((w) => (canSwitch ? true : w.branch_id === branchId));
  // chủ spa: phiếu chờ duyệt kèm chi phí kho đã ghi
  type PendingRow = {
    id: string; code: string; supplier: string | null; note: string | null; created_at: string;
    warehouses: { name: string } | null; profiles: { full_name: string | null } | null;
    stock_movements: { id: string; product_id: string; quantity: number; expiry_date: string | null }[];
  };
  const pendingRows = (pendingData ?? []) as unknown as PendingRow[];
  const { data: extraData } = pendingRows.length
    ? await supabase.rpc("receipt_costs", { p_receipt_ids: pendingRows.map((r) => r.id) })
    : { data: [] };
  const extraMap = new Map(((extraData ?? []) as { receipt_id: string; extra_costs: { label: string; amount: number }[] }[]).map((e) => [e.receipt_id, e.extra_costs]));
  const pending: PendingReceipt[] = pendingRows.map((r) => ({
    id: r.id,
    code: r.code,
    supplier: r.supplier,
    note: r.note,
    created_at: r.created_at,
    warehouse: r.warehouses?.name ?? "",
    creator: r.profiles?.full_name ?? "?",
    extra_costs: extraMap.get(r.id) ?? [],
    items: r.stock_movements.map((m) => ({ movement_id: m.id, product_id: m.product_id, quantity: Number(m.quantity), expiry_date: m.expiry_date })),
  }));
  const costMap = Object.fromEntries(((costs ?? []) as { product_id: string; cost_price: number | null }[]).map((c) => [c.product_id, c.cost_price]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">Nhập hàng</h1>
        <p className="text-sm text-ink/70">Quét mã vạch trên vỏ hộp (máy quét hoặc camera điện thoại), nhập số lượng, hạn sử dụng + tiền ship / chi phí khác rồi lưu phiếu. Chủ spa nhập giá và duyệt phiếu.</p>
      </div>
      <KhoNav active="nhap" role={profile!.role} />
      {isOwner && <ApproveReceipts receipts={pending} products={(products ?? []) as Product[]} costs={costMap} debts={debts} suppliers={((sups ?? []) as { name: string }[]).map((x) => x.name)} />}
      <ReceiveForm
        branches={(branches ?? []).filter((b) => canSwitch || b.id === branchId)}
        defaultBranchId={branchId}
        defaultType={sp.kho === "retail" ? "retail" : "treatment"}
        warehouses={warehouses}
        initialProducts={(products ?? []) as Product[]}
        recent={(receipts ?? []) as unknown as RecentReceipt[]}
        suppliers={((sups ?? []) as { name: string }[]).map((x) => x.name)}
      />
    </div>
  );
}

