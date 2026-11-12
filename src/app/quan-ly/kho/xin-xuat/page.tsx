import { activeBranches } from "@/lib/refData";
import { getCurrentUser } from "@/lib/supabase/server";
import { PRODUCT_COLUMNS, canManageStock, fetchOpened, fetchStock, type Product, type Warehouse } from "@/lib/inventory";
import { KhoNav, pickBranch } from "../shared";
import RequestForm from "./RequestForm";
import RequestCard, { type StockRequest } from "./RequestCard";

export const metadata = { title: "Phiếu xin xuất hàng – Moana Beauty" };

const SELECT =
  "id, code, status, reason, review_note, created_at, reviewed_at, requested_by, warehouse_id, warehouses(name, branch_id), requester:profiles!stock_requests_requested_by_fkey(full_name), reviewer:profiles!stock_requests_reviewed_by_fkey(full_name), stock_request_items(quantity, product_id, products(name, capacity, unit))";

export default async function StockRequestPage({ searchParams }: { searchParams: Promise<{ cn?: string }> }) {
  const { supabase, profile } = await getCurrentUser();
  const sp = await searchParams;
  const { data: branches } = await activeBranches();
  const { branchId, canSwitch } = pickBranch(profile, branches ?? [], sp.cn);
  const manage = canManageStock(profile?.role);

  const { data: whs } = await supabase.from("warehouses").select("id, branch_id, type, name").eq("type", "treatment");
  const treatment = (whs ?? []) as Warehouse[];
  const wh = treatment.find((w) => w.branch_id === branchId);
  // quản lý kho chỉ duyệt kho chi nhánh mình; chủ / quản lý duyệt mọi kho
  const reviewWh = profile?.role === "warehouse" ? treatment.filter((w) => w.branch_id === profile!.branch_id) : treatment;

  const [{ data: products }, stock, opened, { data: mine }, { data: toReview }] = await Promise.all([
    supabase.from("products").select(PRODUCT_COLUMNS).eq("is_active", true).eq("for_treatment", true).order("name"),
    fetchStock(supabase, wh ? [wh.id] : []),
    fetchOpened(supabase, wh?.id ?? ""),
    supabase.from("stock_requests").select(SELECT).eq("requested_by", profile!.id).order("created_at", { ascending: false }).limit(20),
    manage
      ? supabase
          .from("stock_requests")
          .select(SELECT)
          .in("warehouse_id", reviewWh.map((w) => w.id))
          .order("created_at", { ascending: false })
          .limit(60)
      : Promise.resolve({ data: [] }),
  ]);
  const qty = Object.fromEntries(stock.get(wh?.id ?? "") ?? new Map());
  const pending = ((toReview ?? []) as unknown as StockRequest[]).filter((r) => r.status === "pending");
  const processed = ((toReview ?? []) as unknown as StockRequest[]).filter((r) => r.status !== "pending").slice(0, 20);
  const branchName = (id: string) => (branches ?? []).find((b) => b.id === id)?.name ?? "";
  const canRequest = profile?.role !== "warehouse";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-navy">{manage ? "Phiếu xin xuất hàng" : "Xin xuất hàng làm liệu trình"}</h1>
        <p className="text-sm text-ink/70">
          KTV gửi phiếu xin hàng từ kho liệu trình; quản lý kho duyệt thì hàng tự trừ khỏi kho và mỗi chai xuất ra hiện ở mục “Chai đang mở”. Từ chối thì ghi lý do.
        </p>
      </div>
      <KhoNav active="xuat" role={profile!.role} pending={pending.length} />

      {manage && (
        <section className="space-y-3">
          <h2 className="font-semibold text-navy">Chờ duyệt ({pending.length})</h2>
          {pending.length === 0 && <p className="card text-sm text-ink/60">Không có phiếu nào đang chờ.</p>}
          {pending.map((r) => (
            <RequestCard key={r.id} req={r} branchName={branchName(r.warehouses?.branch_id ?? "")} canReview canCancel={r.requested_by === profile!.id} />
          ))}
        </section>
      )}

      {canRequest && (
        <section className="space-y-3">
          <h2 className="font-semibold text-navy">Tạo phiếu xin xuất</h2>
          {!wh ? (
            <p className="card text-sm">Tài khoản chưa có chi nhánh hoặc chi nhánh chưa có kho liệu trình.</p>
          ) : (
            <RequestForm
              branches={canSwitch ? branches ?? [] : []}
              branchId={branchId}
              products={(products ?? []) as Product[]}
              qty={qty}
              opened={Object.fromEntries([...opened].map(([k, v]) => [k, v.map((o) => (o.source === "opening" ? o.remaining_pct : 100))]))}
            />
          )}
        </section>
      )}

      {canRequest && (mine ?? []).length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold text-navy">Phiếu của tôi</h2>
          {((mine ?? []) as unknown as StockRequest[]).map((r) => (
            <RequestCard key={r.id} req={r} branchName={branchName(r.warehouses?.branch_id ?? "")} canReview={false} canCancel={r.status === "pending"} />
          ))}
        </section>
      )}

      {manage && processed.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold text-navy">Đã xử lý gần đây</h2>
          {processed.map((r) => (
            <RequestCard key={r.id} req={r} branchName={branchName(r.warehouses?.branch_id ?? "")} canReview={false} canCancel={false} compact />
          ))}
        </section>
      )}
    </div>
  );
}
