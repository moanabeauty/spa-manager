"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatTime, vnError } from "@/lib/format";
import { elapsed } from "@/lib/ktv";
import ProductPicker from "./ProductPicker";
import ServiceGuideSections, { type ServiceGuide } from "@/components/ServiceGuideSections";

export type Step = { step_no: number; title: string; products: string[]; instructions: string | null; note: string | null };
export type Change = { id: string; step_no: number; from_product: string | null; to_product: string; reason: string; status: string; review_note: string | null };

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
  changes: Change[];
  guide: ServiceGuide | null;
  closed: boolean;
}) {
  const { apsId, steps, changes, startedAt, doneAt, stepsDone, plannedMinutes } = props;
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [ask, setAsk] = useState<{ step: number; from: string } | null>(null);
  const [to, setTo] = useState("");
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

  async function act(action: "start" | "step" | "finish" | "undo") {
    if (action === "finish" && total > 0 && stepsDone < total && !confirm(`Còn ${total - stepsDone} bước chưa bấm xong. Vẫn hoàn thành buổi?`)) return;
    setBusy(true);
    setError(null);
    const { error: e } = await createClient().rpc("ktv_progress", { p_aps: apsId, p_action: action });
    setBusy(false);
    if (e) return setError(vnError(e.message));
    router.refresh();
  }

  async function sendChange() {
    if (!ask) return;
    if (!to.trim() || !reason.trim()) return setError("Ghi sản phẩm muốn dùng và lý do.");
    setBusy(true);
    setError(null);
    const { error: e } = await createClient().rpc("request_procedure_change", {
      p_aps: apsId,
      p_step: ask.step,
      p_from: ask.from,
      p_to: to.trim(),
      p_reason: reason.trim(),
    });
    setBusy(false);
    if (e) return setError(vnError(e.message));
    setAsk(null);
    setTo("");
    setReason("");
    router.refresh();
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

      <div className="space-y-2.5 px-4 pt-4">
        <p className="text-[15px] font-bold">Quy trình (theo liệu trình gốc){total ? ` · ${Math.min(stepsDone, total)}/${total} bước` : ""}</p>
        {total === 0 && (
          <p className="rounded-[14px] bg-white p-4 text-sm text-[#646464]">
            Liệu trình này chưa có quy trình trong hệ thống. Làm theo hướng dẫn của quản lý, vẫn bấm Bắt đầu / Hoàn thành để quản lý theo dõi.
          </p>
        )}
        {steps.map((s) => {
          const done = s.step_no < current;
          const isCur = s.step_no === current && !!startedAt && !doneAt;
          const stepChanges = changes.filter((c) => c.step_no === s.step_no);
          const replaced = new Set(stepChanges.filter((c) => c.status !== "rejected").map((c) => c.from_product));
          const show = open[s.step_no] ?? isCur;
          return (
            <div key={s.step_no} className={`flex gap-3 rounded-[14px] bg-white px-3.5 py-3 ${isCur ? "border-2 border-navy" : ""} ${done ? "opacity-70" : ""}`}>
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${
                  done ? "bg-[#2E7D4F] text-white" : isCur ? "bg-navy text-white" : "bg-[#E6DDCC] text-[#646464]"
                }`}
              >
                {done ? "✓" : s.step_no}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen((o) => ({ ...o, [s.step_no]: !show }))}>
                  <span className="text-sm font-semibold">{s.step_no}. {s.title}</span>
                  <span className="shrink-0 text-xs text-[#646464]">{done && stepAt.get(s.step_no) ? formatTime(stepAt.get(s.step_no)!) : show ? "▴" : "▾"}</span>
                </button>
                {s.products.map((p) => (
                  <div key={p} className="flex items-center justify-between gap-2">
                    <span className={`text-xs ${replaced.has(p) ? "text-[#646464] line-through" : "text-[#646464]"}`}>SP: {p}</span>
                    {!doneAt && !props.closed && !replaced.has(p) && (
                      <button type="button" className="shrink-0 text-[11px] font-semibold text-[#7A6242] underline" onClick={() => { setAsk({ step: s.step_no, from: p }); setError(null); }}>
                        Đổi SP
                      </button>
                    )}
                  </div>
                ))}
                {show && s.instructions && <p className="whitespace-pre-line text-xs text-ink/80">{s.instructions}</p>}
                {show && s.note && <p className="whitespace-pre-line text-xs text-[#8C1D18]">Lưu ý: {s.note}</p>}
                {stepChanges.map((c) => (
                  <div
                    key={c.id}
                    className={`rounded-[10px] px-2.5 py-2 text-xs ${
                      c.status === "pending" ? "bg-beige text-[#5E4B30]" : c.status === "approved" ? "bg-[#E4F2E9] text-[#1F5E3A]" : "bg-[#FDECEA] text-[#8C1D18]"
                    }`}
                  >
                    <b>{c.status === "pending" ? "Chờ quản lý duyệt:" : c.status === "approved" ? "Đã duyệt:" : "Không duyệt:"}</b> đổi
                    {c.from_product ? ` ${c.from_product}` : ""} sang <b>{c.to_product}</b> · lý do: {c.reason}
                    {c.review_note ? ` · QL: ${c.review_note}` : ""}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {!doneAt && !props.closed && (
          <button
            type="button"
            className="min-h-11 w-full rounded-xl border-[1.5px] border-dashed border-[#7A6242] text-sm font-semibold text-[#5E4B30]"
            onClick={() => { setAsk({ step: Math.min(Math.max(current, 1), Math.max(total, 1)), from: "" }); setError(null); }}
          >
            + Yêu cầu đổi sản phẩm
          </button>
        )}

        {ask && (
          <div className="space-y-2 rounded-[14px] bg-white p-3.5 ring-2 ring-brown">
            <p className="text-sm font-semibold">Xin đổi sản phẩm · bước {ask.step}</p>
            {total > 0 && (
              <select className="input py-2 text-sm" value={ask.step} onChange={(e) => setAsk({ ...ask, step: Number(e.target.value) })}>
                {steps.map((s) => (
                  <option key={s.step_no} value={s.step_no}>{s.step_no}. {s.title}</option>
                ))}
              </select>
            )}
            <input className="input py-2 text-sm" placeholder="Sản phẩm gốc (nếu có)" value={ask.from} onChange={(e) => setAsk({ ...ask, from: e.target.value })} />
            <ProductPicker value={to} onChange={setTo} />
            <input className="input py-2 text-sm" placeholder="Lý do (vd da khách đang đỏ)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setAsk(null)}>Huỷ</button>
              <button className="btn-primary flex-1" disabled={busy} onClick={sendChange}>Gửi quản lý duyệt</button>
            </div>
          </div>
        )}
      </div>

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
