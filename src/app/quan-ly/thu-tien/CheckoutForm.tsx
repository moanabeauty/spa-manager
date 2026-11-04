"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatDate, formatTime, formatVnd, normalizePhone, normalizeText, vnError } from "@/lib/format";
import {
  allocateDiscount,
  cardBalance,
  fetchWallet,
  isPackageUsable,
  itemLeft,
  itemText,
  splitByShares,
  type Wallet,
} from "@/lib/billing";
import { techLabel, type Seller } from "@/lib/staff";
import MoneyInput from "@/components/MoneyInput";
import CameraScanner from "@/components/CameraScanner";
import { cleanBarcode, productLabel, retailMinPrice } from "@/lib/inventory";
import { dmy, fetchCustomerPromos, type CustomerPromo, type PromoItem } from "@/lib/promotions";

export type CheckoutService = {
  id: string;
  name: string;
  name_en: string | null;
  price: number | null;
  member_price: number | null;
  card_allowed: boolean;
  duration_minutes: number;
  branch_id: string | null;
  is_active: boolean;
};
export type CheckoutPackage = {
  id: string;
  name: string;
  price: number;
  is_active?: boolean;
  validity_days: number | null;
  package_items: { label: string; quantity: number | null; sort_order: number }[];
};
export type CustomerInfo = { id: string; full_name: string; phone: string | null; note: string | null };
export type DiscountRequest = {
  id: string;
  amount: number;
  reason: string;
  status: "pending" | "approved" | "rejected" | "used";
  review_note: string | null;
};
export type ApptInfo = {
  id: string;
  branch_id: string;
  start_at: string;
  status: string;
  services: { id: string; service_id: string; technician_id: string | null; start_at: string; customer_package_item_id: string | null }[];
};
type Tier = { id: string; topup_amount: number; bonus_amount: number };
/** Sản phẩm bán lẻ (kho bán lẻ) */
export type RetailProduct = {
  id: string;
  name: string;
  brand: string | null;
  capacity: string | null;
  unit: string;
  barcode: string | null;
  retail_price: number;
  max_staff_discount_pct: number | null;
};

type SellerShare = { staffId: string; share: number };
type Line = {
  key: number;
  type: "service" | "package" | "card_topup" | "product";
  apsId?: string;
  productId?: string;
  serviceId?: string;
  packageId?: string;
  tierId?: string;
  technicianId?: string;
  member: boolean;
  customPrice: number;
  qty: number;
  discount: number;
  card: boolean;
  pkgId: string; // phần gói của khách dùng để trừ buổi ("" = trả tiền)
  sellers: SellerShare[];
  // khuyến mãi khách đã đăng ký (giá cố định, không tính là giảm giá)
  promoRegId?: string;
  promoItemId?: string;
  promoPrice?: number;
  promoName?: string;
  promoLabel?: string;
  promoAdded?: boolean; // dòng do bấm "Áp dụng" thêm vào (bỏ KM thì xoá dòng)
};

export default function CheckoutForm({
  appt,
  initialCustomer,
  initialWallet,
  initialPromos,
  defaultBranchId,
  branches,
  services,
  packages,
  tiers,
  sellers,
  canDiscount,
  initialRequest,
  retailProducts,
  retailStock,
  retailPct,
  meId,
}: {
  appt: ApptInfo | null;
  initialCustomer: CustomerInfo | null;
  initialWallet: Wallet;
  initialPromos: CustomerPromo[];
  defaultBranchId: string;
  branches: { id: string; name: string }[];
  services: CheckoutService[];
  packages: CheckoutPackage[];
  tiers: Tier[];
  sellers: Seller[];
  canDiscount: boolean; // chủ / quản lý: tự giảm (ghi lý do); người khác: xin chủ spa duyệt
  initialRequest: DiscountRequest | null;
  retailProducts: RetailProduct[];
  retailStock: Record<string, Record<string, number>>; // chi nhánh -> sản phẩm -> tồn kho bán lẻ
  retailPct: number; // % giảm tối đa chung khi nhân viên bán lẻ
  meId: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const svcById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const pkgById = useMemo(() => new Map(packages.map((p) => [p.id, p])), [packages]);
  const tierById = useMemo(() => new Map(tiers.map((t) => [t.id, t])), [tiers]);
  const sellerById = useMemo(() => new Map(sellers.map((s) => [s.id, s])), [sellers]);
  const prodById = useMemo(() => new Map(retailProducts.map((p) => [p.id, p])), [retailProducts]);
  const minPrice = (p: RetailProduct) => retailMinPrice(Number(p.retail_price), p.max_staff_discount_pct, retailPct);

  const [branchId, setBranchId] = useState(defaultBranchId);
  const [customer, setCustomer] = useState<CustomerInfo | null>(initialCustomer);
  const [wallet, setWallet] = useState<Wallet>(initialWallet);
  const [promos, setPromos] = useState<CustomerPromo[]>(initialPromos);

  // ---- dòng hoá đơn ----
  const [nextKey, setNextKey] = useState(1000);
  const [lines, setLines] = useState<Line[]>(() =>
    (appt?.services ?? []).map((s, i) => ({
      key: i + 1,
      type: "service",
      apsId: s.id,
      serviceId: s.service_id,
      technicianId: s.technician_id ?? undefined,
      member: false,
      customPrice: 0,
      qty: 1,
      discount: 0,
      card: false,
      pkgId: s.customer_package_item_id ?? "",
      sellers: s.technician_id ? [{ staffId: s.technician_id, share: 100 }] : [],
    })),
  );
  const [query, setQuery] = useState("");
  const [pQuery, setPQuery] = useState("");
  const [pCamera, setPCamera] = useState(false);
  const [pMsg, setPMsg] = useState<string | null>(null);

  const [discountMode, setDiscountMode] = useState<"vnd" | "pct">("vnd");
  const [discountInput, setDiscountInput] = useState(0);
  const [discountReason, setDiscountReason] = useState("");
  const [request, setRequest] = useState<DiscountRequest | null>(initialRequest);
  const [reqAmount, setReqAmount] = useState(0);
  const [reqReason, setReqReason] = useState("");
  const [reqBusy, setReqBusy] = useState(false);
  const [reqError, setReqError] = useState<string | null>(null);
  const [cash, setCash] = useState(0);
  const [bank, setBank] = useState(0);
  const [pos, setPos] = useState(0);
  const [cashGiven, setCashGiven] = useState(0);
  const [note, setNote] = useState("");
  // kênh bán + giao hàng (đơn online)
  const [channel, setChannel] = useState<"store" | "online">("store");
  const [ship, setShip] = useState({ carrier: "", tracking_code: "", recipient_name: "", recipient_phone: "", address: "", shipping_fee: 0 });
  const [cod, setCod] = useState(0);
  // ghi nợ: khách trả thiếu
  const [debtOn, setDebtOn] = useState(false);
  const [debtReason, setDebtReason] = useState("");
  const [debtReq, setDebtReq] = useState<DiscountRequest | null>(null);
  const [debtReqBusy, setDebtReqBusy] = useState(false);
  const [debtReqError, setDebtReqError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!customer) return;
    setShip((x) => ({
      ...x,
      recipient_name: x.recipient_name || customer.full_name || "",
      recipient_phone: x.recipient_phone || customer.phone || "",
    }));
  }, [customer]);
  const [error, setError] = useState<string | null>(null);

  const balance = cardBalance(wallet);

  /** Thẻ nạp sẵn chỉ trả được dịch vụ có giá thành viên */
  function cardOk(s: CheckoutService) {
    return s.card_allowed && s.member_price !== null;
  }

  /** Khách còn số dư thẻ nạp sẵn: mặc định trừ thẻ (giá thành viên) cho dịch vụ dùng được thẻ, khi số dư còn đủ */
  function withCardDefaults(ls: Line[], w: Wallet): Line[] {
    let left = cardBalance(w);
    if (left <= 0) return ls;
    return ls.map((l) => {
      if (l.type !== "service" || l.pkgId || l.promoItemId) return l;
      const s = svcById.get(l.serviceId!);
      if (!s || !cardOk(s)) return l;
      const price = Number(s.member_price);
      if (price > left) return l;
      left -= price;
      return { ...l, card: true };
    });
  }
  const [cardDefaultsDone, setCardDefaultsDone] = useState(false);
  useEffect(() => {
    if (cardDefaultsDone) return;
    setCardDefaultsDone(true);
    setLines((ls) => withCardDefaults(ls, wallet));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const hasCard = wallet.cards.length > 0;

  function update(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine(l: Omit<Line, "key">) {
    setLines((ls) => [...ls, { ...l, key: nextKey }]);
    setNextKey((k) => k + 1);
  }
  function removeLine(l: Line) {
    if (l.apsId && !window.confirm("Khách không làm dịch vụ này? Dịch vụ sẽ bị bỏ khỏi lịch hẹn khi thu tiền.")) return;
    setLines((ls) => ls.filter((x) => x.key !== l.key));
  }

  // ---- tính tiền (giống hàm checkout_invoice) ----
  function unitPrice(l: Line): number {
    if (l.promoItemId) return l.promoPrice ?? 0;
    if (l.type === "service") {
      const s = svcById.get(l.serviceId!);
      if (!s) return 0;
      if (l.pkgId) return 0;
      if (s.price === null) return l.customPrice;
      if (l.card && s.member_price !== null) return Number(s.member_price); // trừ thẻ nạp sẵn = giá thành viên
      return Number(s.price);
    }
    if (l.type === "package") return Number(pkgById.get(l.packageId!)?.price ?? 0);
    if (l.type === "product") return l.customPrice;
    if (l.tierId) return Number(tierById.get(l.tierId)?.topup_amount ?? 0);
    return 0;
  }
  const rows = lines.map((l) => {
    const unit = unitPrice(l);
    const gross = unit * l.qty;
    const disc = !canDiscount || l.pkgId || l.promoItemId || l.type === "card_topup" ? 0 : Math.min(l.discount, gross);
    return { unit, gross, disc, net: gross - disc };
  });
  // giảm cả hoá đơn không áp dụng cho nạp thẻ và sản phẩm bán lẻ (sản phẩm chỉ giảm trong mức % cho phép)
  const commonOk = (l: Line) => l.type !== "card_topup" && l.type !== "product" && !l.promoItemId;
  const eligibleSum = rows.reduce((a, r, i) => a + (commonOk(lines[i]) ? r.net : 0), 0);
  const approved = !canDiscount && request?.status === "approved" ? Number(request.amount) : 0;
  const overall = Math.min(
    eligibleSum,
    canDiscount
      ? discountMode === "pct"
        ? Math.round((eligibleSum * Math.min(discountInput, 100)) / 100)
        : discountInput
      : approved,
  );
  const totalDiscount = overall + rows.reduce((a, r) => a + r.disc, 0);
  const alloc = allocateDiscount(
    rows.map((r, i) => ({ amount: r.net, eligible: commonOk(lines[i]) })),
    overall,
  );
  const finals = rows.map((r, i) => r.net - alloc[i]);
  const total = finals.reduce((a, b) => a + b, 0);
  const cardTotal = finals.reduce((a, f, i) => a + (lines[i].card && !lines[i].promoItemId ? f : 0), 0);
  const need = total - cardTotal;
  const paid = cash + bank + pos;
  const online = channel === "online" && !appt;
  const codPart = online ? cod : 0;
  const debt = (debtOn || codPart > 0) && paid + codPart <= need ? need - paid : 0; // phần khách chưa trả (gồm COD)
  const ownDebt = Math.max(0, debt - codPart); // phần nợ không phải ship thu hộ
  const diff = paid + debt - need;

  // số buổi còn lại theo từng gói (trừ các dòng khác trong hoá đơn này đang dùng)
  function packageOptions(l: Line) {
    if (l.type !== "service" || !l.serviceId) return [];
    const out: { id: string; name: string; left: number }[] = [];
    wallet.packages
      .filter((p) => isPackageUsable(p))
      .forEach((p) =>
        p.items
          .filter((i) => i.services.some((x) => x.id === l.serviceId))
          .forEach((i) => {
            const usedHere = lines.filter((o) => o.key !== l.key && o.pkgId === i.id).length;
            const left = itemLeft(i) - usedHere;
            if (left > 0 || i.id === l.pkgId)
              out.push({ id: i.id, name: p.items.length > 1 ? `${p.name} – ${i.label}` : p.name, left });
          }),
      );
    return out;
  }

  // ---- khách (khi bán gói / nạp thẻ không theo lịch) ----
  const [phone, setPhone] = useState("");
  const [matches, setMatches] = useState<CustomerInfo[] | null>(null);
  const digits = normalizePhone(phone);
  useEffect(() => {
    if (appt || digits.length < 4) {
      setMatches(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, full_name, phone, note")
        .ilike("phone", `%${digits}%`)
        .order("full_name")
        .limit(8);
      if (!cancelled) setMatches((data ?? []) as CustomerInfo[]);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [digits, appt, supabase]);

  async function chooseCustomer(c: CustomerInfo | null) {
    setCustomer(c);
    setPhone("");
    setMatches(null);
    const w: Wallet = c ? await fetchWallet(supabase, c.id) : { cards: [], packages: [] };
    const pr: CustomerPromo[] = c ? await fetchCustomerPromos(supabase, c.id) : [];
    setWallet(w);
    setPromos(pr);
    setLines((ls) =>
      withCardDefaults(
        ls.filter((l) => !l.promoAdded).map((l) => ({ ...clearPromo(l), card: false, pkgId: "" })),
        w,
      ),
    );
  }

  // ---- khuyến mãi ----
  function clearPromo(l: Line): Line {
    return { ...l, promoRegId: undefined, promoItemId: undefined, promoPrice: undefined, promoName: undefined, promoLabel: undefined, promoAdded: undefined };
  }
  const promoUsed = (itemId: string, exceptKey?: number) =>
    lines.filter((l) => l.promoItemId === itemId && l.key !== exceptKey).reduce((a, l) => a + l.qty, 0);
  function applyPromo(p: CustomerPromo, it: PromoItem) {
    if (promoUsed(it.id) >= it.quantity) return;
    const promo = { promoRegId: p.regId, promoItemId: it.id, promoPrice: Number(it.promo_price), promoName: p.name, promoLabel: it.label };
    if (it.item_type === "service") {
      // dịch vụ đã có trong hoá đơn (vd trong lịch hẹn) -> áp giá KM vào dòng đó
      const target = lines.find((l) => l.type === "service" && l.serviceId === it.service_id && !l.promoItemId && !l.pkgId);
      // không áp dụng 2 ưu đãi cùng lúc: món KM không trừ thẻ (giá thành viên), không giảm thêm
      if (target) return update(target.key, { ...promo, card: false, discount: 0 });
      const s = svcById.get(it.service_id!);
      return addLine({
        type: "service",
        serviceId: it.service_id!,
        member: false,
        customPrice: 0,
        qty: 1,
        discount: 0,
        card: false,
        pkgId: "",
        sellers: [],
        ...promo,
        promoAdded: true,
        promoLabel: s?.name ?? it.label,
      });
    }
    if (it.item_type === "package") {
      return addLine({ type: "package", packageId: it.package_id!, member: false, customPrice: 0, qty: 1, discount: 0, card: false, pkgId: "", sellers: [], ...promo, promoAdded: true });
    }
    const existing = lines.find((l) => l.type === "product" && l.productId === it.product_id && l.promoItemId === it.id);
    if (existing) return update(existing.key, { qty: existing.qty + 1 });
    addLine({ type: "product", productId: it.product_id!, member: false, customPrice: 0, qty: 1, discount: 0, card: false, pkgId: "", sellers: meSeller, ...promo, promoAdded: true });
  }
  function removePromo(l: Line) {
    if (l.promoAdded) setLines((ls) => ls.filter((x) => x.key !== l.key));
    else update(l.key, clearPromo(l));
  }

  const filtered = useMemo(() => {
    const q = normalizeText(query.trim());
    if (!q) return [];
    return services
      .filter((s) => s.is_active && (s.branch_id === null || s.branch_id === branchId))
      .filter((s) => normalizeText(`${s.name} ${s.name_en ?? ""}`).includes(q))
      .slice(0, 10);
  }, [query, services, branchId]);

  // ---- bán lẻ sản phẩm ----
  const meSeller = sellers.some((x) => x.id === meId) ? [{ staffId: meId, share: 100 }] : [];
  function addProduct(p: RetailProduct) {
    const existing = lines.find((l) => l.type === "product" && l.productId === p.id);
    if (existing) update(existing.key, { qty: existing.qty + 1 });
    else
      addLine({
        type: "product",
        productId: p.id,
        member: false,
        customPrice: Number(p.retail_price),
        qty: 1,
        discount: 0,
        card: false,
        pkgId: "",
        sellers: meSeller,
      });
    setPQuery("");
    setPMsg(null);
  }
  function scanProduct(raw: string) {
    const c = cleanBarcode(raw);
    const p = retailProducts.find((x) => x.barcode === c);
    if (p) addProduct(p);
    else setPMsg(`Không thấy sản phẩm bán lẻ có mã vạch ${c}.`);
  }
  const pFound = useMemo(() => {
    const q = normalizeText(pQuery.trim());
    if (!q) return [];
    return retailProducts
      .filter((p) => normalizeText(`${p.brand ?? ""} ${p.name} ${p.capacity ?? ""} ${p.barcode ?? ""}`).includes(q))
      .slice(0, 8);
  }, [pQuery, retailProducts]);

  // ---- kiểm tra trước khi gửi ----
  const problems: string[] = [];
  if (lines.length === 0) problems.push("Hoá đơn chưa có dòng nào.");
  lines.forEach((l, i) => {
    if (l.type === "service") {
      const s = svcById.get(l.serviceId!);
      if (s && s.price === null && !l.pkgId && l.customPrice <= 0) problems.push(`Nhập giá cho "${s.name}".`);
    }
    if (l.type === "card_topup" && rows[i].unit <= 0) problems.push("Nhập số tiền nạp thẻ.");
  });
  if (!customer && lines.some((l) => l.type === "package" || l.type === "card_topup"))
    problems.push("Bán gói / nạp thẻ cần chọn khách hàng.");
  const stockHere = retailStock[branchId] ?? {};
  lines.forEach((l) => {
    if (l.type !== "product") return;
    const p = prodById.get(l.productId!);
    if (!p) return;
    const used = lines.filter((o) => o.type === "product" && o.productId === l.productId).reduce((a, o) => a + o.qty, 0);
    if (used > (stockHere[p.id] ?? 0)) problems.push(`Kho bán lẻ chỉ còn ${stockHere[p.id] ?? 0} "${p.name}".`);
    if (l.promoItemId) return;
    if (l.customPrice > Number(p.retail_price)) problems.push(`Giá bán "${p.name}" cao hơn giá niêm yết.`);
    if (l.customPrice < minPrice(p)) problems.push(`Giá bán "${p.name}" thấp nhất ${formatVnd(minPrice(p))}.`);
  });
  promos.forEach((p) =>
    p.items.forEach((it) => {
      if (promoUsed(it.id) > it.quantity) problems.push(`"${it.label}" chỉ được ${it.quantity} suất khuyến mãi.`);
    }),
  );
  if (canDiscount && totalDiscount > 0 && !discountReason.trim()) problems.push("Ghi lý do giảm giá.");
  if (cardTotal > balance) problems.push(`Số dư thẻ không đủ (còn ${formatVnd(balance)}).`);
  if (lines.some((l) => l.card) && lines.some((l) => l.type === "card_topup"))
    problems.push("Tiền vừa nạp chỉ dùng được ở hoá đơn sau: hãy thu nạp thẻ riêng trước.");
  if (online && paid + codPart > need && lines.length > 0)
    problems.push(`Tiền đã trả + thu hộ (COD) đang thừa ${formatVnd(paid + codPart - need)}.`);
  else if (diff !== 0 && lines.length > 0)
    problems.push(diff < 0 ? `Còn thiếu ${formatVnd(-diff)} (hoặc bấm "Ghi nợ phần còn lại").` : `Đang nhập thừa ${formatVnd(diff)}.`);
  if (online && lines.some((l) => l.type !== "product" && l.type !== "package" && l.type !== "card_topup"))
    problems.push("Đơn online chỉ bán sản phẩm / gói / nạp thẻ, không có dịch vụ làm tại spa.");
  if (online && !ship.address.trim()) problems.push("Nhập địa chỉ giao hàng.");
  if (ownDebt > 0) {
    if (!customer) problems.push("Ghi nợ cần chọn khách hàng.");
    else if (canDiscount && !debtReason.trim()) problems.push("Ghi lý do cho khách nợ.");
    else if (!canDiscount && !(debtReq?.status === "approved" && Number(debtReq.amount) >= debt))
      problems.push(`Khách nợ ${formatVnd(debt)}: cần chủ spa / quản lý duyệt cho nợ.`);
  }

  async function submit() {
    if (problems.length) return;
    setSaving(true);
    setError(null);
    const items = lines.map((l) => ({
      type: l.type,
      appointment_service_id: l.apsId ?? null,
      service_id: l.serviceId ?? null,
      package_id: l.packageId ?? null,
      product_id: l.productId ?? null,
      topup_tier_id: l.tierId ?? null,
      technician_id: l.technicianId ?? null,
      unit_price: l.customPrice,
      quantity: l.qty,
      discount: !canDiscount || l.pkgId || l.promoItemId || l.type === "card_topup" ? 0 : l.discount,
      paid_with_card: l.promoItemId ? false : l.card,
      customer_package_item_id: l.pkgId || null,
      promotion_registration_id: l.promoRegId ?? null,
      promotion_item_id: l.promoItemId ?? null,
      sellers: l.sellers.filter((s) => s.staffId && s.share > 0).map((s) => ({ staff_id: s.staffId, share: s.share })),
    }));
    const payments = [
      { method: "cash", amount: cash },
      { method: "bank_transfer", amount: bank },
      { method: "pos", amount: pos },
    ].filter((p) => p.amount > 0);
    const { data, error } = await supabase.rpc("checkout_invoice_v3", {
      p_debt_amount: debt,
      p_debt_reason: ownDebt > 0 && canDiscount ? debtReason : null,
      p_debt_request_id: ownDebt > 0 && !canDiscount && debtReq?.status === "approved" ? debtReq.id : null,
      p_channel: online ? "online" : "store",
      p_shipment: online ? { ...ship, cod_amount: cod } : null,
      p_discount_reason: canDiscount ? discountReason : null,
      p_discount_request_id: approved > 0 ? request!.id : null,
      p_branch_id: branchId,
      p_customer_id: customer?.id ?? null,
      p_appointment_id: appt?.id ?? null,
      p_items: items,
      p_payments: payments,
      p_discount: overall,
      p_note: note,
    });
    if (error) {
      setSaving(false);
      return setError(vnError(error.message));
    }
    router.push(`/quan-ly/hoa-don/${data}?moi=1`);
  }

  async function sendRequest() {
    setReqBusy(true);
    setReqError(null);
    const { data, error } = await supabase.rpc("request_discount", {
      p_branch_id: branchId,
      p_appointment_id: appt?.id ?? null,
      p_customer_id: customer?.id ?? null,
      p_amount: reqAmount,
      p_reason: reqReason,
    });
    setReqBusy(false);
    if (error) return setReqError(vnError(error.message));
    setRequest({ id: data as string, amount: reqAmount, reason: reqReason, status: "pending", review_note: null });
    // báo lên điện thoại chủ spa (không chờ, lỗi cũng không ảnh hưởng việc thu tiền)
    fetch("/api/thong-bao/giam-gia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: data }),
    }).catch(() => {});
  }
  async function sendDebtRequest() {
    setDebtReqBusy(true);
    setDebtReqError(null);
    const { data, error } = await supabase.rpc("request_debt", {
      p_branch_id: branchId,
      p_customer_id: customer?.id ?? null,
      p_amount: debt,
      p_reason: debtReason,
    });
    setDebtReqBusy(false);
    if (error) return setDebtReqError(vnError(error.message));
    setDebtReq({ id: data as string, amount: debt, reason: debtReason, status: "pending", review_note: null });
    fetch("/api/thong-bao/giam-gia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: data }),
    }).catch(() => {});
  }
  async function refreshDebtRequest() {
    if (!debtReq) return;
    setDebtReqBusy(true);
    const { data } = await supabase.from("discount_requests").select("id, amount, reason, status, review_note").eq("id", debtReq.id).maybeSingle();
    setDebtReqBusy(false);
    if (data) setDebtReq(data as DiscountRequest);
  }
  async function refreshRequest() {
    if (!request) return;
    setReqBusy(true);
    const { data } = await supabase
      .from("discount_requests")
      .select("id, amount, reason, status, review_note")
      .eq("id", request.id)
      .maybeSingle();
    setReqBusy(false);
    if (data) setRequest(data as DiscountRequest);
  }

  function fillRemaining(method: "cash" | "bank" | "pos") {
    const others = (method === "cash" ? 0 : cash) + (method === "bank" ? 0 : bank) + (method === "pos" ? 0 : pos);
    const v = Math.max(0, need - codPart - others);
    if (method === "cash") setCash(v);
    if (method === "bank") setBank(v);
    if (method === "pos") setPos(v);
  }

  const lockedPackages = wallet.packages.filter((p) => isPackageUsable(p));

  return (
    <div className="space-y-4 pb-24">
      <div>
        <h1 className="text-2xl font-bold text-navy">Thu tiền</h1>
        {appt && (
          <p className="text-sm text-ink/70">
            Lịch hẹn {formatTime(appt.start_at)} · <span className="capitalize">{formatDate(appt.start_at)}</span>
          </p>
        )}
      </div>

      {!appt && (
        <div className="flex gap-1 rounded-full bg-white p-1 ring-1 ring-beige-dark">
          {(
            [
              ["store", "Bán tại quầy"],
              ["online", "Đơn online (giao hàng)"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setChannel(k)}
              className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold ${channel === k ? "bg-navy text-white" : "text-navy"}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ---- KHÁCH ---- */}
      <div className="card space-y-3">
        {!appt && (
          <label className="block">
            <span className="label">Chi nhánh</span>
            <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
        )}
        {customer ? (
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">{customer.full_name}</p>
              <p className="text-sm text-ink/60">{customer.phone ?? "(chưa có SĐT)"}</p>
              {customer.note && <p className="mt-1 rounded-lg bg-[#FFE8BA]/60 px-2 py-1 text-xs">{customer.note}</p>}
            </div>
            <div className="text-right text-sm">
              <p>
                Thẻ tài khoản: <b className="text-navy">{hasCard ? formatVnd(balance) : "chưa có"}</b>
              </p>
              <Link href={`/quan-ly/khach-hang?id=${customer.id}`} className="text-xs text-navy underline">Xem hồ sơ khách</Link>
              {!appt && (
                <button className="ml-3 text-xs text-[#8A2323] underline" onClick={() => chooseCustomer(null)}>Đổi khách</button>
              )}
            </div>
          </div>
        ) : (
          <div>
            <span className="label">Khách hàng (gõ SĐT) — bỏ trống nếu khách lẻ chỉ làm dịch vụ</span>
            <input className="input" inputMode="tel" placeholder="09…" value={phone} onChange={(e) => setPhone(e.target.value)} />
            {matches && (
              <ul className="mt-2 divide-y divide-beige rounded-xl border border-beige-dark">
                {matches.length === 0 && (
                  <li className="px-3 py-2 text-sm text-ink/60">
                    Chưa có khách này. Tạo hồ sơ ở trang{" "}
                    <Link href={`/quan-ly/tao-lich?sdt=${digits}`} className="text-navy underline">Tạo lịch</Link>.
                  </li>
                )}
                {matches.map((c) => (
                  <li key={c.id}>
                    <button className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-cream" onClick={() => chooseCustomer(c)}>
                      <span className="font-medium">{c.full_name}</span>
                      <span className="text-ink/60">{c.phone}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {customer && lockedPackages.length > 0 && (
          <div className="rounded-xl bg-cream px-3 py-2 text-xs">
            <p className="mb-1 font-semibold">Gói đang có</p>
            {lockedPackages.map((p) => (
              <p key={p.id}>
                {p.name}:{" "}
                {p.items.map((i) => `${i.label}: ${itemText(i)}`).join(" · ")}
              </p>
            ))}
          </div>
        )}
        {customer && promos.length > 0 && (
          <div className="space-y-2 rounded-xl border border-[#E0A526] bg-[#FFE8BA]/30 px-3 py-2 text-xs">
            <p className="font-semibold text-[#7A5600]">Ưu đãi khách đã đăng ký</p>
            {promos.map((p) => {
              const wrongBranch = !!p.branch_id && p.branch_id !== branchId;
              const blocked = wrongBranch || p.expired;
              return (
                <div key={p.regId}>
                  <p className="font-medium">
                    {p.name}
                    {p.deadline && <span className="font-normal text-ink/60"> · dùng đến {dmy(p.deadline)}</span>}
                    {wrongBranch && <span className="font-normal text-[#8A2323]"> · chỉ áp dụng ở chi nhánh khác</span>}
                    {p.expired && (
                      <span className="font-normal text-[#8A2323]">
                        {" "}· hết hạn dùng – cần chủ / quản lý gia hạn ở trang{" "}
                        <Link href="/quan-ly/khuyen-mai?tt=confirmed" className="underline">Khuyến mãi</Link>
                      </span>
                    )}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {p.items.map((it) => {
                      const used = promoUsed(it.id);
                      return (
                        <li key={it.id} className="flex items-center justify-between gap-2">
                          <span>
                            {it.label}: <b>{Number(it.promo_price) === 0 ? "tặng" : formatVnd(Number(it.promo_price))}</b>
                            {it.list_price !== null && Number(it.list_price) > Number(it.promo_price) && (
                              <span className="ml-1 text-ink/40 line-through">{formatVnd(Number(it.list_price))}</span>
                            )}
                            {it.quantity > 1 && <span className="text-ink/60"> · {used}/{it.quantity} suất</span>}
                          </span>
                          <button
                            className="shrink-0 rounded-full bg-navy px-3 py-1 font-semibold text-white disabled:opacity-40"
                            disabled={blocked || used >= it.quantity}
                            onClick={() => applyPromo(p, it)}
                          >
                            {used >= it.quantity ? "Đã áp dụng" : "Áp dụng"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
            <p className="text-ink/60">
              Không áp dụng 2 ưu đãi cùng lúc: món khuyến mãi không trừ thẻ nạp sẵn, không giảm thêm. Chốt hoá đơn thì đăng ký chuyển sang “đã dùng”
              (món chưa áp dụng cũng không dùng lại được; gói combo khuyến mãi vẫn dùng dần theo số buổi).
            </p>
          </div>
        )}
      </div>

      {/* ---- CÁC DÒNG ---- */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-navy">Nội dung thu</h2>
        {lines.length === 0 && <p className="text-sm text-ink/60">Chưa có dòng nào. Thêm dịch vụ, gói hoặc nạp thẻ bên dưới.</p>}
        {lines.map((l, i) => (
          <LineRow
            key={l.key}
            line={l}
            row={rows[i]}
            alloc={alloc[i]}
            final={finals[i]}
            svc={l.serviceId ? svcById.get(l.serviceId) : undefined}
            pkg={l.packageId ? pkgById.get(l.packageId) : undefined}
            tier={l.tierId ? tierById.get(l.tierId) : undefined}
            product={l.productId ? prodById.get(l.productId) : undefined}
            productMin={l.productId && prodById.get(l.productId) ? minPrice(prodById.get(l.productId)!) : 0}
            productStock={l.productId ? stockHere[l.productId] ?? 0 : 0}
            hasCard={hasCard}
            inAppt={!!appt}
            packageOptions={packageOptions(l)}
            sellers={sellers}
            sellerById={sellerById}
            branches={branches}
            canDiscount={canDiscount}
            onChange={(p) => update(l.key, p)}
            onRemove={() => removeLine(l)}
            onRemovePromo={() => removePromo(l)}
          />
        ))}

        {/* thêm */}
        <div className="space-y-2 border-t border-beige pt-3">
          <input
            className="input py-2"
            placeholder={appt ? "+ Thêm dịch vụ khách làm thêm (gõ tên)" : "+ Thêm dịch vụ (gõ tên)"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {filtered.length > 0 && (
            <ul className="divide-y divide-beige rounded-xl border border-beige-dark">
              {filtered.map((s) => (
                <li key={s.id}>
                  <button
                    className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-cream"
                    onClick={() => {
                      const p = Number(s.member_price ?? 0);
                      addLine({
                        type: "service",
                        serviceId: s.id,
                        member: false,
                        customPrice: 0,
                        qty: 1,
                        discount: 0,
                        card: hasCard && s.card_allowed && s.member_price !== null && balance - cardTotal >= p,
                        pkgId: "",
                        sellers: [],
                      });
                      setQuery("");
                    }}
                  >
                    <span>{s.name}</span>
                    <span className="shrink-0 text-ink/60">{formatVnd(s.price)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <select
              className="input w-auto flex-1 py-2"
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                addLine({ type: "package", packageId: e.target.value, member: false, customPrice: 0, qty: 1, discount: 0, card: false, pkgId: "", sellers: [] });
              }}
            >
              <option value="">+ Bán gói combo…</option>
              {packages
                .filter((p) => p.is_active !== false || canDiscount)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} – {formatVnd(p.price)}
                    {p.is_active === false ? " (ngừng bán – chủ / quản lý duyệt)" : ""}
                  </option>
                ))}
            </select>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (pFound.length === 1) addProduct(pFound[0]);
              else if (pQuery.trim()) scanProduct(pQuery);
            }}
          >
            <input
              className="input flex-1 py-2"
              placeholder="+ Bán sản phẩm lẻ (gõ tên hoặc quét mã vạch)"
              value={pQuery}
              onChange={(e) => {
                setPQuery(e.target.value);
                setPMsg(null);
              }}
              autoComplete="off"
            />
            <button type="button" className="btn-outline px-3 py-2" title="Quét bằng camera" onClick={() => setPCamera(true)}>
              📷
            </button>
          </form>
          {pMsg && <p className="text-xs text-[#8A2323]">{pMsg}</p>}
          {pFound.length > 0 && (
            <ul className="divide-y divide-beige rounded-xl border border-beige-dark">
              {pFound.map((p) => {
                const have = stockHere[p.id] ?? 0;
                return (
                  <li key={p.id}>
                    <button
                      className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-cream disabled:opacity-50"
                      disabled={have <= 0}
                      onClick={() => addProduct(p)}
                    >
                      <span className="min-w-0">
                        {productLabel(p)}
                        {p.brand && <span className="block text-xs text-ink/50">{p.brand}</span>}
                      </span>
                      <span className="shrink-0 text-right">
                        {formatVnd(p.retail_price)}
                        <span className={`block text-xs ${have <= 0 ? "text-[#8A2323]" : "text-ink/50"}`}>
                          {have <= 0 ? "hết hàng" : `còn ${have} ${p.unit}`}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {pCamera && (
            <CameraScanner
              onScan={(c) => {
                scanProduct(c);
                setPCamera(false);
              }}
              onClose={() => setPCamera(false)}
            />
          )}
          {packages.length === 0 && (
            <p className="text-xs text-ink/60">Chưa có gói combo nào. Chủ / quản lý tạo gói ở trang <b>Gói combo</b>.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-ink/70">+ Nạp thẻ:</span>
            {tiers.map((t) => (
              <button
                key={t.id}
                className="btn-outline px-3 py-1.5 text-xs"
                onClick={() => addLine({ type: "card_topup", tierId: t.id, member: false, customPrice: 0, qty: 1, discount: 0, card: false, pkgId: "", sellers: [] })}
              >
                {formatVnd(t.topup_amount)}
                {t.bonus_amount > 0 && <span className="text-brown"> +{formatVnd(t.bonus_amount)}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ---- GIẢM GIÁ + THANH TOÁN ---- */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>Tạm tính</span>
          <span>{formatVnd(rows.reduce((a, r) => a + r.net, 0))}</span>
        </div>
        {canDiscount ? (
          <>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                Giảm cả hoá đơn
                <select
                  className="rounded-lg border border-beige-dark px-1 py-1 text-xs"
                  value={discountMode}
                  onChange={(e) => {
                    setDiscountMode(e.target.value as "vnd" | "pct");
                    setDiscountInput(0);
                  }}
                >
                  <option value="vnd">đ</option>
                  <option value="pct">%</option>
                </select>
              </span>
              <span className="flex items-center gap-2">
                {discountMode === "pct" ? (
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="w-20 rounded-lg border border-beige-dark px-2 py-1.5 text-right text-sm"
                    value={discountInput || ""}
                    onChange={(e) => setDiscountInput(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                  />
                ) : (
                  <MoneyInput value={discountInput} onChange={setDiscountInput} className="w-32" ariaLabel="Giảm cả hoá đơn" />
                )}
                {overall > 0 && <span className="text-[#8A2323]">−{formatVnd(overall)}</span>}
              </span>
            </div>
            {totalDiscount > 0 && (
              <input
                className={`input py-2 text-sm ${discountReason.trim() ? "" : "border-[#E0A526]"}`}
                placeholder="Lý do giảm giá (bắt buộc)"
                value={discountReason}
                onChange={(e) => setDiscountReason(e.target.value)}
              />
            )}
          </>
        ) : (
          <div className="rounded-xl border border-beige-dark p-3 text-sm">
            <p className="font-medium">Giảm giá (cần chủ spa duyệt)</p>
            {request?.status === "approved" && (
              <p className="mt-1 text-[#22612A]">
                ✓ Chủ spa đã duyệt giảm <b>{formatVnd(Number(request.amount))}</b> – {request.reason}
                {request.review_note && <span className="text-ink/60"> ({request.review_note})</span>}
              </p>
            )}
            {request?.status === "pending" && (
              <p className="mt-1 text-[#7A5600]">
                Đang chờ chủ spa duyệt giảm {formatVnd(Number(request.amount))} – {request.reason}.{" "}
                <button className="font-semibold text-navy underline" disabled={reqBusy} onClick={refreshRequest}>
                  {reqBusy ? "…" : "Kiểm tra lại"}
                </button>
              </p>
            )}
            {request?.status === "rejected" && (
              <p className="mt-1 text-[#8A2323]">
                Chủ spa không duyệt yêu cầu giảm {formatVnd(Number(request.amount))}
                {request.review_note ? `: ${request.review_note}` : ""}.
              </p>
            )}
            {request?.status !== "approved" && request?.status !== "pending" && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-xs text-ink/60">Xin giảm</span>
                  <MoneyInput value={reqAmount} onChange={setReqAmount} className="flex-1" ariaLabel="Số tiền xin giảm" />
                </div>
                <input className="input py-2 text-sm" placeholder="Lý do (bắt buộc)" value={reqReason} onChange={(e) => setReqReason(e.target.value)} />
                {reqError && <p className="text-xs text-[#8A2323]">{reqError}</p>}
                <button className="btn-outline w-full py-2" disabled={reqBusy || reqAmount <= 0 || !reqReason.trim()} onClick={sendRequest}>
                  {reqBusy ? "Đang gửi…" : "Gửi chủ spa duyệt"}
                </button>
              </div>
            )}
            {overall > 0 && (
              <p className="mt-2 flex justify-between">
                <span>Giảm cả hoá đơn</span>
                <span className="text-[#8A2323]">−{formatVnd(overall)}</span>
              </p>
            )}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-beige pt-3 text-lg font-bold text-navy">
          <span>Tổng cần thu</span>
          <span>{formatVnd(total)}</span>
        </div>

        {cardTotal > 0 && (
          <div className="flex justify-between rounded-xl bg-[#DCE3F5] px-3 py-2 text-sm">
            <span>Trừ thẻ tài khoản (các dòng đánh dấu)</span>
            <b>{formatVnd(cardTotal)}</b>
          </div>
        )}
        {cardTotal > 0 && (
          <p className="text-xs text-ink/60">Số dư sau khi trừ: {formatVnd(balance - cardTotal)}</p>
        )}

        <div className="space-y-2">
          <p className="text-sm font-medium">Khách trả {cardTotal > 0 ? "phần còn lại" : ""}: <b>{formatVnd(need)}</b></p>
          {(
            [
              ["cash", "Tiền mặt", cash, setCash],
              ["bank", "Chuyển khoản", bank, setBank],
              ["pos", "Quẹt thẻ POS", pos, setPos],
            ] as const
          ).map(([m, label, v, set]) => (
            <div key={m} className="flex items-center gap-2 text-sm">
              <span className="w-28 shrink-0">{label}</span>
              <MoneyInput value={v} onChange={set} className="flex-1" ariaLabel={label} />
              <button className="btn-ghost shrink-0 px-2 py-1 text-xs" onClick={() => fillRemaining(m)} disabled={need <= 0}>
                Thu đủ
              </button>
            </div>
          ))}
          {cash > 0 && (
            <div className="flex items-center gap-2 text-xs text-ink/70">
              <span className="w-28 shrink-0">Khách đưa</span>
              <MoneyInput value={cashGiven} onChange={setCashGiven} className="flex-1" ariaLabel="Khách đưa tiền mặt" />
              <span className="w-24 shrink-0 text-right">
                {cashGiven > cash ? <>Trả lại <b className="text-navy">{formatVnd(cashGiven - cash)}</b></> : ""}
              </span>
            </div>
          )}
        </div>

        {online && (
          <div className="space-y-2 rounded-xl border border-beige-dark p-3 text-sm">
            <p className="font-medium text-navy">Giao hàng</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="input py-2 text-sm" placeholder="Người nhận" value={ship.recipient_name}
                onChange={(e) => setShip({ ...ship, recipient_name: e.target.value })} />
              <input className="input py-2 text-sm" placeholder="SĐT người nhận" inputMode="tel" value={ship.recipient_phone}
                onChange={(e) => setShip({ ...ship, recipient_phone: e.target.value })} />
            </div>
            <input className="input py-2 text-sm" placeholder="Địa chỉ giao hàng (bắt buộc)" value={ship.address}
              onChange={(e) => setShip({ ...ship, address: e.target.value })} />
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="input py-2 text-sm" placeholder="Đơn vị vận chuyển (GHTK, Viettel Post…)" value={ship.carrier}
                onChange={(e) => setShip({ ...ship, carrier: e.target.value })} />
              <input className="input py-2 text-sm" placeholder="Mã vận đơn (có thể nhập sau)" value={ship.tracking_code}
                onChange={(e) => setShip({ ...ship, tracking_code: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-xs">Phí ship</span>
              <MoneyInput value={ship.shipping_fee} onChange={(v) => setShip({ ...ship, shipping_fee: v })} className="flex-1" ariaLabel="Phí ship" />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-xs">Thu hộ (COD)</span>
              <MoneyInput value={cod} onChange={setCod} className="flex-1" ariaLabel="Tiền thu hộ COD" />
              <button className="btn-ghost shrink-0 px-2 py-1 text-xs" disabled={need - paid <= 0} onClick={() => setCod(Math.max(0, need - paid))}>
                Thu hộ phần còn lại
              </button>
            </div>
            <p className="text-xs text-ink/60">
              Phí ship chỉ để ghi lại; tiền ship spa tự trả thì lập phiếu chi. Tiền COD được tính là khách còn nợ cho đến khi đơn vị ship trả tiền,
              lúc đó vào hoá đơn bấm “Thu nợ”.
            </p>
          </div>
        )}

        {lines.length > 0 && need - paid - codPart > 0 && (
          <div className={`space-y-2 rounded-xl border p-3 text-sm ${debtOn ? "border-[#E0A526] bg-[#FFF4DB]/50" : "border-beige-dark"}`}>
            <label className="flex items-center gap-2 font-medium">
              <input type="checkbox" checked={debtOn} onChange={(e) => setDebtOn(e.target.checked)} />
              Khách trả thiếu – ghi nợ phần còn lại ({formatVnd(need - paid - codPart)})
            </label>
            {debtOn && (
              <>
                <input className={`input py-2 text-sm ${debtReason.trim() ? "" : "border-[#E0A526]"}`}
                  placeholder="Lý do cho nợ (bắt buộc)" value={debtReason} onChange={(e) => setDebtReason(e.target.value)} />
                {!canDiscount && (
                  <div className="text-xs">
                    {debtReq?.status === "approved" && Number(debtReq.amount) >= debt && (
                      <p className="text-[#22612A]">✓ Đã được duyệt cho nợ {formatVnd(Number(debtReq.amount))}.</p>
                    )}
                    {debtReq?.status === "approved" && Number(debtReq.amount) < debt && (
                      <p className="text-[#8A2323]">Chỉ được duyệt nợ {formatVnd(Number(debtReq.amount))}, khách cần trả thêm.</p>
                    )}
                    {debtReq?.status === "pending" && (
                      <p className="text-[#7A5600]">
                        Đang chờ chủ spa / quản lý duyệt cho nợ {formatVnd(Number(debtReq.amount))}.{" "}
                        <button className="font-semibold text-navy underline" disabled={debtReqBusy} onClick={refreshDebtRequest}>
                          {debtReqBusy ? "…" : "Kiểm tra lại"}
                        </button>
                      </p>
                    )}
                    {debtReq?.status === "rejected" && (
                      <p className="text-[#8A2323]">Không được duyệt cho nợ{debtReq.review_note ? `: ${debtReq.review_note}` : ""}.</p>
                    )}
                    {(!debtReq || debtReq.status === "rejected" || (debtReq.status === "approved" && Number(debtReq.amount) < debt)) && (
                      <button className="btn-outline mt-2 w-full py-2" disabled={debtReqBusy || !customer || !debtReason.trim()} onClick={sendDebtRequest}>
                        {debtReqBusy ? "Đang gửi…" : `Xin duyệt cho nợ ${formatVnd(debt)}`}
                      </button>
                    )}
                    {debtReqError && <p className="mt-1 text-[#8A2323]">{debtReqError}</p>}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {debt > 0 && (
          <div className="flex justify-between rounded-xl bg-[#FFF4DB] px-3 py-2 text-sm">
            <span>Khách còn nợ{codPart > 0 ? " (gồm tiền ship thu hộ)" : ""}</span>
            <b className="text-[#7A5600]">{formatVnd(debt)}</b>
          </div>
        )}

        <label className="block">
          <span className="label">Ghi chú hoá đơn</span>
          <input className="input py-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="(không bắt buộc)" />
        </label>
      </div>

      {/* ---- NÚT THU ---- */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-beige-dark bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1 text-xs">
            {error ? (
              <p className="text-[#8A2323]">{error}</p>
            ) : problems.length ? (
              <p className="text-[#8A2323]">{problems[0]}</p>
            ) : (
              <p className="text-[#22612A]">{debt > 0 ? `Thu ${formatVnd(paid)}, ghi nợ ${formatVnd(debt)}. Bấm để chốt.` : "Đã đủ tiền, bấm để chốt hoá đơn."}</p>
            )}
          </div>
          <button className="btn-primary" disabled={saving || problems.length > 0} onClick={submit}>
            {saving ? "Đang lưu…" : `Thu ${formatVnd(total)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function LineRow({
  line: l,
  row,
  alloc,
  final,
  svc,
  pkg,
  tier,
  product,
  productMin,
  productStock,
  hasCard,
  inAppt,
  packageOptions,
  sellers,
  sellerById,
  branches,
  canDiscount,
  onChange,
  onRemove,
  onRemovePromo,
}: {
  line: Line;
  row: { unit: number; gross: number; disc: number; net: number };
  alloc: number;
  final: number;
  svc?: CheckoutService;
  pkg?: CheckoutPackage;
  tier?: Tier;
  product?: RetailProduct;
  productMin: number;
  productStock: number;
  hasCard: boolean;
  inAppt: boolean;
  packageOptions: { id: string; name: string; left: number }[];
  sellers: Seller[];
  sellerById: Map<string, Seller>;
  branches: { id: string; name: string }[];
  canDiscount: boolean;
  onChange: (p: Partial<Line>) => void;
  onRemove: () => void;
  onRemovePromo: () => void;
}) {
  const isPromo = !!l.promoItemId;
  const title =
    l.type === "service"
      ? svc?.name ?? l.promoLabel ?? "Dịch vụ"
      : l.type === "package"
        ? pkg
          ? `Gói ${pkg.name}`
          : l.promoLabel ?? "Gói"
        : l.type === "product"
          ? product
            ? productLabel(product)
            : l.promoLabel ?? "Sản phẩm"
          : "Nạp thẻ tài khoản";
  const usesPackage = !!l.pkgId;
  const cardBlocked = l.type === "service" && svc && (!svc.card_allowed || svc.member_price === null);
  const showSellers = final > 0 && !l.card;
  const amounts = splitByShares(final, l.sellers.map((s) => s.share));
  const techs = sellers.filter((s) => s.role !== "receptionist");

  return (
    <div className="rounded-xl border border-beige-dark p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {title}
            {l.type === "service" && l.apsId && <span className="ml-1 text-xs text-ink/50">(trong lịch)</span>}
            {l.type === "service" && !l.apsId && inAppt && <span className="ml-1 text-xs text-brown">(làm thêm)</span>}
          </p>
          {isPromo && (
            <p className="mt-0.5 text-xs">
              <span className="rounded-full bg-[#FFE8BA] px-2 py-0.5 font-semibold text-[#7A5600]">KM {l.promoName}</span>
              {row.unit === 0 && <b className="ml-1 text-[#22612A]">tặng</b>}
              <button className="ml-2 text-[#8A2323] underline" onClick={onRemovePromo}>Bỏ khuyến mãi</button>
            </p>
          )}
          {l.type === "package" && pkg && (
            <p className="text-xs text-ink/60">
              {[...pkg.package_items]
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((i) => `${i.label} ${i.quantity === null ? "(không giới hạn)" : `×${i.quantity}`}`)
                .join(", ")}
              {pkg.validity_days ? ` · hạn ${pkg.validity_days} ngày` : ""}
            </p>
          )}
          {l.type === "product" && product && (
            <p className="text-xs text-ink/60">
              {product.brand ? `${product.brand} · ` : ""}Bán lẻ – kho còn {productStock} {product.unit}
            </p>
          )}
          {l.type === "card_topup" && (
            <p className="text-xs text-ink/60">
              {tier && tier.bonus_amount > 0 ? `Tặng thêm ${formatVnd(tier.bonus_amount)} vào thẻ` : ""}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <span className={`font-semibold ${usesPackage ? "text-[#22612A]" : ""}`}>{usesPackage ? "Trừ gói" : formatVnd(final)}</span>
          <button className="text-ink/40 hover:text-[#8A2323]" title="Bỏ dòng này" onClick={onRemove}>✕</button>
        </div>
      </div>

      {/* KTV cho dịch vụ làm thêm */}
      {l.type === "service" && !l.apsId && inAppt && (
        <label className="mt-2 flex items-center gap-2 text-xs text-ink/60">
          KTV làm
          <select
            className="flex-1 rounded-lg border border-beige-dark px-2 py-1.5 text-sm"
            value={l.technicianId ?? ""}
            onChange={(e) => {
              const v = e.target.value || undefined;
              onChange({ technicianId: v, sellers: v && l.sellers.length === 0 ? [{ staffId: v, share: 100 }] : l.sellers });
            }}
          >
            <option value="">— Chưa xếp —</option>
            {techs.map((t) => (
              <option key={t.id} value={t.id}>{techLabel(t, branches)}</option>
            ))}
          </select>
        </label>
      )}

      {/* trừ gói */}
      {l.type === "service" && inAppt && !isPromo && (packageOptions.length > 0 || usesPackage) && (
        <label className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-ink/60">Cách trả</span>
          <select
            className={`flex-1 rounded-lg border px-2 py-1.5 text-sm ${usesPackage ? "border-[#22612A] bg-[#D6EDD8]/50" : "border-beige-dark"}`}
            value={l.pkgId}
            onChange={(e) => onChange({ pkgId: e.target.value, card: false })}
          >
            <option value="">Trả tiền</option>
            {packageOptions.map((p) => (
              <option key={p.id} value={p.id}>
                Trừ buổi gói {p.name} ({p.left === Infinity ? "không giới hạn" : `còn ${p.left} buổi`})
              </option>
            ))}
          </select>
        </label>
      )}

      {!usesPackage && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          {l.type === "service" && svc?.price === null && !isPromo && (
            <label className="flex items-center gap-1">
              Giá
              <MoneyInput value={l.customPrice} onChange={(n) => onChange({ customPrice: n })} className="w-32" ariaLabel="Giá dịch vụ" />
            </label>
          )}
          {l.type === "product" && product && (
            <>
              <label className="flex items-center gap-1">
                SL
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, productStock)}
                  className="w-14 rounded-lg border border-beige-dark px-2 py-1"
                  value={l.qty}
                  onChange={(e) => onChange({ qty: Math.max(1, Math.min(50, Math.floor(Number(e.target.value) || 1))) })}
                />
              </label>
              {!isPromo && (
              <label className="flex items-center gap-1">
                Giá bán
                <MoneyInput
                  value={l.customPrice}
                  onChange={(n) => onChange({ customPrice: n })}
                  className={`w-32 ${l.customPrice < productMin || l.customPrice > Number(product.retail_price) ? "border-[#8A2323]" : ""}`}
                  ariaLabel="Giá bán sản phẩm"
                />
              </label>
              )}
              <span className="text-ink/55">
                niêm yết {formatVnd(product.retail_price)}
                {!isPromo && productMin < Number(product.retail_price) && (
                  <>
                    {" · "}
                    <button className="text-navy underline" onClick={() => onChange({ customPrice: productMin })}>
                      thấp nhất {formatVnd(productMin)}
                    </button>
                  </>
                )}
              </span>
            </>
          )}
          {l.type === "package" && !isPromo && (
            <label className="flex items-center gap-1">
              SL
              <input
                type="number"
                min={1}
                max={10}
                className="w-14 rounded-lg border border-beige-dark px-2 py-1"
                value={l.qty}
                onChange={(e) => onChange({ qty: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
              />
            </label>
          )}
          {l.type !== "card_topup" && canDiscount && !isPromo && (
            <label className="flex items-center gap-1">
              Giảm
              <MoneyInput value={l.discount} onChange={(n) => onChange({ discount: n })} className="w-28" ariaLabel="Giảm giá dòng" />
            </label>
          )}
          {l.type === "service" && hasCard && (
            <label className={`flex items-center gap-1 ${cardBlocked || isPromo ? "text-ink/40" : ""}`}>
              <input
                type="checkbox"
                checked={l.card && !isPromo}
                disabled={!!cardBlocked || isPromo}
                onChange={(e) => onChange({ card: e.target.checked })}
              />
              Trừ thẻ nạp sẵn
              {cardBlocked
                ? " (dịch vụ không có giá thành viên – thanh toán ngoài)"
                : isPromo
                  ? " (món khuyến mãi không trừ thẻ – thanh toán ngoài)"
                  : svc?.member_price != null
                    ? ` · giá thành viên ${formatVnd(svc.member_price)}`
                    : ""}
            </label>
          )}
        </div>
      )}
      {!usesPackage && (row.disc > 0 || alloc > 0) && (
        <p className="mt-1 text-xs text-ink/50">
          {formatVnd(row.gross)}
          {row.disc > 0 && ` − ${formatVnd(row.disc)}`}
          {alloc > 0 && ` − ${formatVnd(alloc)} (giảm chung)`} = {formatVnd(final)}
        </p>
      )}

      {/* chia doanh số */}
      {showSellers && (
        <div className="mt-2 rounded-lg bg-cream px-2 py-2 text-xs">
          <p className="mb-1 flex items-center justify-between">
            <span className={l.sellers.length === 0 ? "font-semibold text-[#7A5600]" : "text-ink/60"}>
              {l.sellers.length === 0 ? "Chưa chia doanh số cho ai" : "Doanh số tính hoa hồng"}
            </span>
            <button
              className="font-semibold text-navy underline"
              onClick={() => {
                const n = l.sellers.length + 1;
                const even = Math.floor(100 / n);
                const next = [...l.sellers, { staffId: "", share: 0 }].map((s, i) => ({
                  ...s,
                  share: i === n - 1 ? 100 - even * (n - 1) : even,
                }));
                onChange({ sellers: next });
              }}
            >
              + {l.sellers.length === 0 ? "Chọn người hưởng" : "Chia thêm"}
            </button>
          </p>
          {l.sellers.map((s, i) => (
            <div key={i} className="mt-1 flex items-center gap-1">
              <select
                className="min-w-0 flex-1 rounded-lg border border-beige-dark bg-white px-1 py-1"
                value={s.staffId}
                onChange={(e) => onChange({ sellers: l.sellers.map((x, j) => (j === i ? { ...x, staffId: e.target.value } : x)) })}
              >
                <option value="">— chọn nhân viên —</option>
                {sellers.map((t) => (
                  <option key={t.id} value={t.id} disabled={t.id !== s.staffId && l.sellers.some((x) => x.staffId === t.id)}>
                    {techLabel(t, branches)}
                    {t.role === "receptionist" ? " · lễ tân" : ""}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={100}
                className="w-14 rounded-lg border border-beige-dark px-1 py-1 text-right"
                value={s.share}
                onChange={(e) =>
                  onChange({ sellers: l.sellers.map((x, j) => (j === i ? { ...x, share: Math.max(0, Number(e.target.value) || 0) } : x)) })
                }
              />
              <span>%</span>
              <span className="w-24 text-right">{formatVnd(amounts[i])}</span>
              <button className="px-1 text-ink/40 hover:text-[#8A2323]" onClick={() => onChange({ sellers: l.sellers.filter((_, j) => j !== i) })}>
                ✕
              </button>
            </div>
          ))}
          {l.sellers.length > 0 && l.sellers.some((s) => !s.staffId) && (
            <p className="mt-1 text-[#8A2323]">Chọn nhân viên cho các ô còn trống (ô trống sẽ bị bỏ qua).</p>
          )}
          {l.sellers.length > 1 && l.sellers.reduce((a, s) => a + s.share, 0) !== 100 && (
            <p className="mt-1 text-ink/60">Tổng tỉ lệ khác 100%: hệ thống chia theo tỉ lệ tương ứng.</p>
          )}
          {sellerById.size === 0 && <p className="text-ink/60">Chưa có tài khoản nhân viên.</p>}
        </div>
      )}
    </div>
  );
}
