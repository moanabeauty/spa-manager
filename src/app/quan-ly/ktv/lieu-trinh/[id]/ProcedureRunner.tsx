"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatTime, vnError } from "@/lib/format";
import { elapsed } from "@/lib/ktv";
import ProductPicker from "./ProductPicker";
import UsagePanel from "./UsagePanel";
import { fmtQty } from "@/lib/inventory";
import ServiceGuideSections, { type ServiceGuide } from "@/components/ServiceGuideSections";
import SessionPhotos from "@/components/SessionPhotos";
import type { Photo } from "@/lib/photos";

export type Step = { step_no: number; title: string; products: string[]; instructions: string | null; note: string | null };
export type Usage = { label: string; unit: string; qty: number };
export type Item = { id: string; step_no: number; name: string; product_id: string | null; qty: number | null; unit: string };
export type ChangeKind = "swap" | "remove" | "qty" | "add_product" | "remove_step" | "add_step";
export type Change = {
  id: string;
  step_no: number;
  from_product: string | null;
  to_product: string;
  reason: string;
  status: string;
  review_note: string | null;
  kind: ChangeKind;
  item_id: string | null;
  new_qty: number | null;
  step_title: string | null;
  parent_id: string | null;
  product_label: string | null;
  to_product_id: string | null;
  requested_by: string;
  unit: string;
};

/** Mẫu yêu cầu đang mở */
type Form = {
  kind: ChangeKind;
  step: number;
  itemId?: string | null;
  parentId?: string | null;
  label: string; // mô tả đối tượng đang sửa (hiện ở đầu khung)
  unit?: string;
  oldQty?: number | null;
  legacyFrom?: string; // sản phẩm chỉ có tên trong quy trình (chưa có dòng định mức)
};

const KIND_TITLE: Record<ChangeKind, string> = {
  swap: "Đổi sản phẩm",
  remove: "Bỏ sản phẩm",
  qty: "Đổi định lượng",
  add_product: "Thêm sản phẩm",
  remove_step: "Bỏ bước",
  add_step: "Thêm bước",
};

const qtyText = (q: number | null | undefined, unit?: string) => (q == null ? "" : `${fmtQty(q)}${unit ? ` ${unit}` : ""}`);

/** Định lượng gợi ý theo các liệu trình khác đang dùng sản phẩm */
type DoseHint = { unit: string | null; suggest: number | null; options: number[]; services: { name: string; qty: number }[] };

/** Số → chữ để điền vào ô (dấu phẩy thập phân, không dấu chấm ngăn nghìn) */
const inputQty = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");

/** Đọc định lượng KTV gõ: "0,5" · "0.5" · ",5" · "1/2" · "1 1/2" → số; không hợp lệ → NaN */
function parseQty(raw: string): number {
  const t = raw.trim().replace(/\s+/g, " ");
  const mixed = t.match(/^(\d+) (\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = t.match(/^(\d+(?:[.,]\d+)?)\/(\d+(?:[.,]\d+)?)$/);
  if (frac) return Number(frac[1].replace(",", ".")) / Number(frac[2].replace(",", "."));
  const n = t.replace(",", ".");
  return /^\d*\.?\d+$/.test(n) ? Number(n) : NaN;
}

export default function ProcedureRunner(props: {
  apsId: string;
  backHref: string;
  customerName: string;
  serviceName: string;
  plannedMinutes: number;
  startedAt: string | null;
  doneAt: string | null;
  stepsDone: number;
  stepLog: { step: number; at: string }[];
  steps: Step[];
  items: Item[];
  myId: string;
  changes: Change[];
  guide: ServiceGuide | null;
  closed: boolean;
  appointmentId: string;
  photos: Photo[];
  photosRequired: boolean;
  photoSkipReason: string | null;
  photosEditable: boolean;
  usages: Usage[];
}) {
  const { apsId, steps, changes, startedAt, doneAt, stepsDone, plannedMinutes } = props;
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [form, setForm] = useState<Form | null>(null);
  const [to, setTo] = useState("");
  const [toId, setToId] = useState<string | null>(null);
  const [toUnit, setToUnit] = useState("");
  const [qty, setQty] = useState("");
  const [hint, setHint] = useState<DoseHint | null>(null);
  const [hintBusy, setHintBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [reason, setReason] = useState("");

  // đồng hồ chạy + cập nhật duyệt đổi sản phẩm
  useEffect(() => {
    if (!startedAt || doneAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt, doneAt]);
  useEffect(() => {
    if (!changes.some((c) => c.status === "pending")) return;
    const t = setInterval(() => router.refresh(), 20000);
    return () => clearInterval(t);
  }, [changes, router]);

  const total = steps.length;
  const current = doneAt ? total + 1 : stepsDone + 1; // bước đang làm (1-based)
  const spentMin = startedAt ? ((doneAt ? new Date(doneAt).getTime() : now) - new Date(startedAt).getTime()) / 60000 : 0;
  const pct = startedAt ? Math.min(100, Math.round((spentMin / plannedMinutes) * 100)) : 0;
  const stepAt = new Map(props.stepLog.map((l) => [l.step, l.at]));
  const editable = !doneAt && !props.closed;
  const live = changes.filter((c) => c.status === "pending" || c.status === "approved");
  const pendingCount = changes.filter((c) => c.status === "pending").length;
  const itemsOf = (step: number) => props.items.filter((i) => i.step_no === step);
  /** Điều chỉnh mới nhất (đang chờ / đã duyệt) cho 1 dòng sản phẩm */
  const latest = (itemId: string, kinds: ChangeKind[]) =>
    [...live].reverse().find((c) => c.item_id === itemId && kinds.includes(c.kind));
  const stepRemoval = (step: number) => live.find((c) => c.kind === "remove_step" && !c.parent_id && c.step_no === step);
  const addedSteps = (after: number) => live.filter((c) => c.kind === "add_step" && c.step_no === after);
  const addedIn = (step: number, parent: string | null) =>
    live.filter((c) => c.kind === "add_product" && (parent ? c.parent_id === parent : !c.parent_id && c.step_no === step));

  async function act(action: "start" | "step" | "finish" | "undo", choices?: Record<string, string>) {
    if (action === "finish" && pendingCount > 0) {
      return setError(`Còn ${pendingCount} yêu cầu điều chỉnh quy trình chờ quản lý duyệt. Chờ duyệt hoặc huỷ yêu cầu rồi mới hoàn thành buổi.`);
    }
    if (action === "finish" && !choices) {
      // xem trước sản phẩm sẽ trừ rồi mới hoàn thành
      if (total > 0 && stepsDone < total && !confirm(`Còn ${total - stepsDone} bước chưa bấm xong. Vẫn hoàn thành buổi?`)) return;
      setError(null);
      return setFinishing(true);
    }
    setBusy(true);
    setError(null);
    const { error: e } = await createClient().rpc("ktv_progress", { p_aps: apsId, p_action: action, p_choices: choices ?? null });
    setBusy(false);
    if (e) return setError(vnError(e.message));
    if (action === "finish") setFinishing(false);
    router.refresh();
  }

  function openForm(f: Form) {
    setForm(f);
    setTo("");
    setToId(null);
    setToUnit(f.unit ?? "");
    setQty(f.kind === "qty" && f.oldQty != null ? inputQty(f.oldQty) : "");
    setHint(null);
    setTitle("");
    setReason("");
    setError(null);
  }

  /** KTV chọn sản phẩm trong danh sách → lấy định lượng gợi ý theo liệu trình khác, tự điền vào ô định lượng */
  async function pickProduct(id: string) {
    setHint(null);
    setHintBusy(true);
    const { data } = await createClient().rpc("product_dose_hint", { p_product: id });
    setHintBusy(false);
    const h = (data ?? null) as DoseHint | null;
    setHint(h);
    if (h?.unit) setToUnit(h.unit);
    if (h?.suggest != null) setQty(inputQty(h.suggest));
  }

  async function sendForm() {
    if (!form) return;
    const k = form.kind;
    const needProduct = k === "swap" || k === "add_product";
    if (needProduct && !to.trim()) return setError("Gõ tên rồi chọn sản phẩm trong danh sách.");
    if ((needProduct || (k === "add_step" && to.trim())) && !toId)
      return setError("Chọn sản phẩm trong danh sách gợi ý (hoặc quét mã). Sản phẩm chưa có trong danh sách → báo kho thêm vào hệ thống.");
    if (k === "add_step" && !title.trim()) return setError("Ghi tên bước muốn thêm.");
    const q = qty.trim() && !form.legacyFrom ? Math.round(parseQty(qty) * 1000) / 1000 : null;
    if (q !== null && !(q > 0)) return setError("Định lượng phải là số lớn hơn 0 – số lẻ gõ 0,5 hoặc 1/2.");
    if (k === "qty" && q === null) return setError("Nhập định lượng mới.");
    if ((k === "add_product" || (k === "add_step" && to.trim())) && toId && q === null) return setError("Nhập định lượng sản phẩm dùng cho 1 buổi.");
    if (!reason.trim()) return setError("Ghi lý do để quản lý duyệt.");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: e } =
      k === "swap" && !form.itemId
        ? await supabase.rpc("request_procedure_change", {
            p_aps: apsId,
            p_step: form.step,
            p_from: form.legacyFrom ?? "",
            p_to: to.trim(),
            p_reason: reason.trim(),
            p_to_product: toId,
          })
        : await supabase.rpc("request_procedure_adjust", {
            p_aps: apsId,
            p_kind: k,
            p_step: form.step,
            p_reason: reason.trim(),
            p_item: form.itemId ?? null,
            p_parent: form.parentId ?? null,
            p_to: to.trim() || null,
            p_to_product: toId,
            p_qty: q,
            p_title: title.trim() || null,
          });
    setBusy(false);
    if (e) return setError(vnError(e.message));
    setForm(null);
    router.refresh();
  }

  async function cancelChange(id: string) {
    if (!confirm("Huỷ yêu cầu này?")) return;
    setBusy(true);
    const { error: e } = await createClient().rpc("cancel_procedure_change", { p_id: id });
    setBusy(false);
    if (e) return setError(vnError(e.message));
    router.refresh();
  }

  /** Nhãn trạng thái + nút huỷ cho 1 yêu cầu */
  function ChangeNote({ c }: { c: Change }) {
    return (
      <div
        className={`rounded-[10px] px-2.5 py-2 text-xs ${
          c.status === "pending" ? "bg-beige text-[#5E4B30]" : c.status === "approved" ? "bg-[#E4F2E9] text-[#1F5E3A]" : "bg-[#FDECEA] text-[#8C1D18]"
        }`}
      >
        <b>{c.status === "pending" ? "Chờ duyệt" : c.status === "approved" ? "Đã duyệt" : "Không duyệt"} · {KIND_TITLE[c.kind]}:</b>{" "}
        {c.from_product ? `${c.from_product} → ` : ""}
        <b>{c.to_product}</b> · lý do: {c.reason}
        {c.review_note ? ` · QL: ${c.review_note}` : ""}
        {c.status === "pending" && editable && c.requested_by === props.myId && (
          <button type="button" disabled={busy} className="ml-2 font-semibold underline" onClick={() => cancelChange(c.id)}>
            Huỷ
          </button>
        )}
      </div>
    );
  }

  /** 1 dòng sản phẩm: theo định mức gốc, hoặc sản phẩm đã xin thêm */
  function ProductRow({ step, item, added, parentId }: { step: number; item?: Item; added?: Change; parentId?: string | null }) {
    const id = item?.id ?? added!.id;
    const name = item ? item.name : added!.product_label ?? added!.to_product;
    const unit = item ? item.unit : added!.unit;
    const baseQty = item ? item.qty : added!.new_qty;
    const rem = latest(id, ["remove"]);
    const swap = item ? latest(id, ["swap"]) : undefined;
    const qc = latest(id, ["qty", ...(item ? (["swap"] as ChangeKind[]) : [])]);
    const newQty = qc?.status === "approved" && qc.new_qty != null ? qc.new_qty : null;
    const struck = rem?.status === "approved" || swap?.status === "approved";
    const busyRow = !!rem || (!!added && added.status !== "approved") || live.some((c) => c.item_id === id && c.status === "pending");
    return (
      <div className="space-y-0.5">
        <div className="flex items-start justify-between gap-2">
          <span className={`text-xs ${struck ? "text-[#646464] line-through" : added ? "text-[#1F5E3A]" : "text-[#646464]"}`}>
            {added ? "＋ " : "SP: "}
            {name}
            {baseQty != null && (
              <>
                {" · "}
                {newQty != null ? <><s>{qtyText(baseQty, unit)}</s> <b>{qtyText(newQty, unit)}</b></> : qtyText(baseQty, unit)}
              </>
            )}
          </span>
          {editable && !busyRow && (
            <span className="flex shrink-0 gap-2 text-[11px] font-semibold text-[#7A6242]">
              {item && !swap && (
                <button type="button" className="underline" onClick={() => openForm({ kind: "swap", step, itemId: id, label: name, unit, oldQty: baseQty })}>
                  Đổi
                </button>
              )}
              {baseQty != null && (
                <button type="button" className="underline" onClick={() => openForm({ kind: "qty", step, itemId: id, parentId, label: name, unit, oldQty: newQty ?? baseQty })}>
                  SL
                </button>
              )}
              <button type="button" className="underline" onClick={() => openForm({ kind: "remove", step, itemId: id, parentId, label: name })}>
                Bỏ
              </button>
            </span>
          )}
        </div>
        {swap?.status === "approved" && (
          <p className="text-xs font-medium text-[#1F5E3A]">→ dùng {swap.product_label ?? swap.to_product}{swap.new_qty != null ? ` · ${qtyText(swap.new_qty, swap.unit)}` : ""}</p>
        )}
      </div>
    );
  }

  /** Bước KTV xin thêm (hiện sau bước gốc tương ứng) */
  function AddedStep({ st }: { st: Change }) {
    const rem = latest(st.id, ["remove"]);
    const gone = rem?.status === "approved";
    const kids = addedIn(st.step_no, st.id);
    return (
      <div className={`space-y-1.5 rounded-[14px] border-[1.5px] border-dashed border-[#2E7D4F] bg-white px-3.5 py-3 ${gone ? "opacity-60" : ""}`}>
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm font-semibold ${gone ? "line-through" : ""}`}>＋ Bước thêm: {st.step_title}</p>
          {editable && st.status === "approved" && !rem && (
            <button type="button" className="shrink-0 text-[11px] font-semibold text-[#7A6242] underline" onClick={() => openForm({ kind: "remove", step: st.step_no, itemId: st.id, label: `bước thêm "${st.step_title}"` })}>
              Bỏ bước
            </button>
          )}
        </div>
        {st.product_label && <ProductRow step={st.step_no} added={st} />}
        {kids.map((k) => <ProductRow key={k.id} step={st.step_no} added={k} parentId={st.id} />)}
        {(() => {
          const ids = new Set([st.id, ...kids.map((k) => k.id)]);
          return changes
            .filter((c) => c.id === st.id || c.parent_id === st.id || (!!c.item_id && ids.has(c.item_id)))
            .filter((c) => c.status === "pending" || c.status === "rejected" || (c.kind === "remove" && c.status === "approved"))
            .map((c) => <ChangeNote key={c.id} c={c} />);
        })()}
        {editable && st.status === "approved" && !gone && (
          <button type="button" className="text-[11px] font-semibold text-[#7A6242] underline" onClick={() => openForm({ kind: "add_product", step: st.step_no, parentId: st.id, label: `bước thêm "${st.step_title}"` })}>
            + Thêm sản phẩm
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="-mx-4 -mt-6 pb-32">
      <div className="space-y-1.5 bg-navy px-5 pb-4 pt-4 text-white">
        <Link href={props.backHref} className="flex min-h-8 items-center text-sm text-beige-dark">‹ {props.customerName}</Link>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">{props.serviceName}</h1>
            <p className="text-[13px] text-[#C9CADB]">
              {startedAt ? `Bắt đầu ${formatTime(startedAt)}` : "Chưa bắt đầu"} · dự kiến {plannedMinutes} phút
              {doneAt ? ` · xong ${formatTime(doneAt)}` : ""}
            </p>
          </div>
          {startedAt && (
            <p className={`text-[26px] font-bold tabular-nums ${spentMin > plannedMinutes && !doneAt ? "text-[#F2B8B5]" : "text-beige-dark"}`}>
              {elapsed(startedAt, doneAt ? new Date(doneAt).getTime() : now)}
            </p>
          )}
        </div>
        <div className="h-1.5 rounded-full bg-white/20">
          <div className="h-1.5 rounded-full bg-brown" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {props.guide && (
        <div className="px-4 pt-4">
          <ServiceGuideSections guide={props.guide} collapsible />
        </div>
      )}

      <div className="px-4 pt-4">
        <SessionPhotos
          appointmentId={props.appointmentId}
          photos={props.photos}
          editable={props.photosEditable && !props.closed}
          required={props.photosRequired}
          skipReason={props.photoSkipReason}
          highlight={!startedAt || doneAt ? null : props.photos.filter((p) => p.phase === "before" && p.angle !== "extra").length < 3 ? "before" : total > 0 && stepsDone >= total ? "after" : null}
        />
      </div>

      <div className="space-y-2.5 px-4 pt-4">
        <p className="text-[15px] font-bold">Quy trình (theo liệu trình gốc){total ? ` · ${Math.min(stepsDone, total)}/${total} bước` : ""}</p>
        {editable && (
          <p className="text-xs text-[#646464]">
            Có thể xin bỏ / đổi sản phẩm, đổi định lượng, thêm sản phẩm, bỏ hoặc thêm bước. Mọi điều chỉnh cần quản lý / chủ spa duyệt; kho trừ theo quy trình đã duyệt khi hoàn thành buổi.
          </p>
        )}
        {total === 0 && (
          <p className="rounded-[14px] bg-white p-4 text-sm text-[#646464]">
            Liệu trình này chưa có quy trình trong hệ thống. Làm theo hướng dẫn của quản lý, vẫn bấm Bắt đầu / Hoàn thành để quản lý theo dõi.
          </p>
        )}
        {addedSteps(0).map((st) => <AddedStep key={st.id} st={st} />)}
        {steps.map((s) => {
          const done = s.step_no < current;
          const isCur = s.step_no === current && !!startedAt && !doneAt;
          const its = itemsOf(s.step_no);
          const stepRem = stepRemoval(s.step_no);
          const stepGone = stepRem?.status === "approved";
          const itemIds = new Set([...its.map((i) => i.id), ...addedIn(s.step_no, null).map((c) => c.id)]);
          // các yêu cầu cần hiện trạng thái ở bước này
          const notes = changes.filter(
            (c) =>
              c.kind !== "add_step" &&
              !c.parent_id &&
              (c.status === "pending" || c.status === "rejected" || c.kind === "remove_step" || (c.kind === "swap" && !c.item_id)) &&
              (c.kind === "remove_step" || c.kind === "add_product" ? c.step_no === s.step_no : c.item_id ? itemIds.has(c.item_id) : c.step_no === s.step_no),
          );
          const textOnly = its.length === 0 ? s.products : [];
          const show = open[s.step_no] ?? isCur;
          return (
            <div key={s.step_no} className="space-y-2.5">
              <div className={`flex gap-3 rounded-[14px] bg-white px-3.5 py-3 ${isCur ? "border-2 border-navy" : ""} ${done || stepGone ? "opacity-70" : ""}`}>
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${
                    done ? "bg-[#2E7D4F] text-white" : isCur ? "bg-navy text-white" : "bg-[#E6DDCC] text-[#646464]"
                  }`}
                >
                  {done ? "✓" : s.step_no}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen((o) => ({ ...o, [s.step_no]: !show }))}>
                    <span className={`text-sm font-semibold ${stepGone ? "line-through" : ""}`}>{s.step_no}. {s.title}</span>
                    <span className="shrink-0 text-xs text-[#646464]">{done && stepAt.get(s.step_no) ? formatTime(stepAt.get(s.step_no)!) : show ? "▴" : "▾"}</span>
                  </button>
                  {stepGone && <p className="text-xs font-semibold text-[#1F5E3A]">Đã duyệt bỏ bước này – không trừ sản phẩm của bước.</p>}
                  {!stepGone && its.map((i) => <ProductRow key={i.id} step={s.step_no} item={i} />)}
                  {!stepGone && addedIn(s.step_no, null).map((c) => <ProductRow key={c.id} step={s.step_no} added={c} />)}
                  {!stepGone &&
                    textOnly.map((p) => {
                      const replaced = changes.some((c) => c.kind === "swap" && !c.item_id && c.step_no === s.step_no && c.from_product === p && c.status !== "rejected");
                      return (
                        <div key={p} className="flex items-center justify-between gap-2">
                          <span className={`text-xs text-[#646464] ${replaced ? "line-through" : ""}`}>SP: {p}</span>
                          {editable && !replaced && (
                            <button type="button" className="shrink-0 text-[11px] font-semibold text-[#7A6242] underline" onClick={() => openForm({ kind: "swap", step: s.step_no, label: p, legacyFrom: p })}>
                              Đổi
                            </button>
                          )}
                        </div>
                      );
                    })}
                  {show && s.instructions && <p className="whitespace-pre-line text-xs text-ink/80">{s.instructions}</p>}
                  {show && s.note && <p className="whitespace-pre-line text-xs text-[#8C1D18]">Lưu ý: {s.note}</p>}
                  {notes.map((c) => <ChangeNote key={c.id} c={c} />)}
                  {editable && !stepRem && (
                    <div className="flex gap-3 pt-0.5 text-[11px] font-semibold text-[#7A6242]">
                      <button type="button" className="underline" onClick={() => openForm({ kind: "add_product", step: s.step_no, label: `bước ${s.step_no}. ${s.title}` })}>
                        + Thêm SP
                      </button>
                      <button type="button" className="underline" onClick={() => openForm({ kind: "remove_step", step: s.step_no, label: `bước ${s.step_no}. ${s.title}` })}>
                        Bỏ bước
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {addedSteps(s.step_no).map((st) => <AddedStep key={st.id} st={st} />)}
            </div>
          );
        })}
        {editable && (
          <button
            type="button"
            className="min-h-11 w-full rounded-xl border-[1.5px] border-dashed border-[#7A6242] text-sm font-semibold text-[#5E4B30]"
            onClick={() => openForm({ kind: "add_step", step: total, label: "quy trình" })}
          >
            + Thêm bước
          </button>
        )}

        {form && (
          <div className="space-y-2 rounded-[14px] bg-white p-3.5 ring-2 ring-brown">
            <p className="text-sm font-semibold">
              {KIND_TITLE[form.kind]} · {form.label}
              {form.kind === "qty" && form.oldQty != null ? ` (đang ${qtyText(form.oldQty, form.unit)})` : ""}
            </p>
            {form.kind === "add_step" && (
              <>
                <select className="input py-2 text-sm" value={form.step} onChange={(e) => setForm({ ...form, step: Number(e.target.value) })}>
                  <option value={0}>Ở đầu quy trình</option>
                  {steps.map((s) => (
                    <option key={s.step_no} value={s.step_no}>Sau bước {s.step_no}. {s.title}</option>
                  ))}
                </select>
                <input className="input py-2 text-sm" placeholder="Tên bước (vd Đắp mặt nạ dịu da)" value={title} onChange={(e) => setTitle(e.target.value)} />
              </>
            )}
            {(form.kind === "swap" || form.kind === "add_product" || form.kind === "add_step") && (
              <ProductPicker
                value={to}
                placeholder={form.kind === "swap" ? "Đổi sang sản phẩm… (gõ tên hoặc quét mã)" : form.kind === "add_step" ? "Sản phẩm dùng ở bước này (nếu có)" : "Sản phẩm muốn thêm… (gõ tên hoặc quét mã)"}
                onChange={(v, id, u) => {
                  setTo(v);
                  setToId(id ?? null);
                  if (u !== undefined) setToUnit(u);
                  if (id) pickProduct(id);
                  else setHint(null);
                }}
              />
            )}
            {(form.kind === "qty" || ((form.kind === "swap" || form.kind === "add_product" || form.kind === "add_step") && toId && !form.legacyFrom)) && (
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    className="input py-2 text-sm"
                    type="text"
                    inputMode="decimal"
                    placeholder={form.kind === "swap" ? "Định lượng / buổi (bỏ trống = giữ như cũ)" : "Định lượng / buổi (vd 0,5)"}
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                  />
                  <span className="shrink-0 text-xs text-[#646464]">{(form.kind === "qty" ? form.unit : toUnit || form.unit) || ""}</span>
                </label>
                {hintBusy && <p className="text-[11px] text-[#646464]">Đang tìm định lượng ở các liệu trình khác…</p>}
                {form.kind !== "qty" && hint && hint.options.length > 0 && (
                  <div className="space-y-1 rounded-[10px] bg-cream px-2.5 py-2 text-[11px] text-[#5E4B30]">
                    <p className="font-semibold">Gợi ý theo liệu trình khác đang dùng sản phẩm này (đã tự điền, sửa được):</p>
                    <div className="flex flex-wrap gap-1.5">
                      {hint.options.map((o) => {
                        const used = hint.services.filter((s) => s.qty === o).map((s) => s.name);
                        return (
                          <button
                            key={o}
                            type="button"
                            onClick={() => setQty(inputQty(o))}
                            className={`rounded-full border px-2.5 py-1 font-semibold ${parseQty(qty) === o ? "border-navy bg-navy text-white" : "border-[#C9B79A] bg-white"}`}
                          >
                            {qtyText(o, hint.unit ?? toUnit)}
                            {used.length > 0 && <span className="font-normal opacity-75"> · {used.length} liệu trình</span>}
                          </button>
                        );
                      })}
                    </div>
                    {hint.services.length > 0 && (
                      <p className="opacity-80">
                        Dùng ở: {hint.services.slice(0, 4).map((s) => `${s.name} (${qtyText(s.qty, hint.unit ?? "")})`).join(", ")}
                        {hint.services.length > 4 ? ` +${hint.services.length - 4} liệu trình khác` : ""}
                      </p>
                    )}
                  </div>
                )}
                {form.kind !== "qty" && hint && hint.options.length === 0 && (
                  <p className="text-[11px] text-[#646464]">Sản phẩm này chưa có trong quy trình liệu trình nào – nhập định lượng / buổi (số lẻ gõ 0,5).</p>
                )}
              </div>
            )}
            <input className="input py-2 text-sm" placeholder="Lý do (vd da khách đang đỏ)" value={reason} onChange={(e) => setReason(e.target.value)} />
            {error && <p className="text-xs text-[#B3261E]">{error}</p>}
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setForm(null)}>Huỷ</button>
              <button className="btn-primary flex-1" disabled={busy} onClick={sendForm}>Gửi quản lý duyệt</button>
            </div>
          </div>
        )}
        {pendingCount > 0 && editable && (
          <p className="rounded-[10px] bg-beige px-3 py-2 text-xs text-[#5E4B30]">
            ⏳ {pendingCount} yêu cầu đang chờ quản lý duyệt (trang tự cập nhật). Cần duyệt xong mới hoàn thành buổi được.
          </p>
        )}
      </div>

      {finishing && !doneAt && (
        <div className="px-4 pt-4">
          <UsagePanel apsId={apsId} busy={busy} onCancel={() => setFinishing(false)} onConfirm={(c) => act("finish", c)} />
        </div>
      )}

      {doneAt && props.usages.length > 0 && (
        <div className="px-4 pt-4">
          <div className="space-y-1 rounded-[14px] bg-white p-3.5 text-xs">
            <p className="text-sm font-bold">Đã trừ sản phẩm</p>
            {props.usages.map((u) => (
              <p key={u.label} className="flex justify-between gap-2">
                <span>{u.label}</span>
                <b className="shrink-0">−{fmtQty(u.qty)} {u.unit}</b>
              </p>
            ))}
          </div>
        </div>
      )}

      {!props.closed && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#E6DDCC] bg-white px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto max-w-3xl space-y-1.5">
            {error && <p className="text-center text-xs text-[#B3261E]">{error}</p>}
            {doneAt ? (
              <Link href={props.backHref} className="flex min-h-[52px] items-center justify-center rounded-[14px] bg-[#E4F2E9] text-[15px] font-semibold text-[#1F5E3A]">
                ✓ Đã hoàn thành buổi · quay lại
              </Link>
            ) : !startedAt ? (
              <button className="min-h-[52px] w-full rounded-[14px] bg-navy text-[16px] font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => act("start")}>
                Bắt đầu
              </button>
            ) : (
              <div className="flex gap-2.5">
                {total > 0 && stepsDone < total ? (
                  <button className="min-h-[52px] flex-1 rounded-[14px] border-[1.5px] border-navy bg-white text-[15px] font-semibold text-navy disabled:opacity-50" disabled={busy} onClick={() => act("step")}>
                    Xong bước {current}
                  </button>
                ) : (
                  stepsDone > 0 && (
                    <button className="min-h-[52px] flex-1 rounded-[14px] border-[1.5px] border-navy bg-white text-[15px] font-semibold text-navy disabled:opacity-50" disabled={busy} onClick={() => act("undo")}>
                      Bỏ bước {stepsDone}
                    </button>
                  )
                )}
                <button className="min-h-[52px] flex-1 rounded-[14px] bg-navy text-[15px] font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => act("finish")}>
                  Hoàn thành buổi
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
