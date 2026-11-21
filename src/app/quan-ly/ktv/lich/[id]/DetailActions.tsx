"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vnError } from "@/lib/format";
import ServicePicker, { type Pick, type PickService } from "../../ServicePicker";

const MAX_SERVICES = 10; // 1 khách tối đa 10 dịch vụ / buổi

/** 1 liệu trình đã có trong lịch */
export type BookedRow = {
  id: string;
  serviceId: string;
  itemId: string | null;
  label: string;
  minutes: number;
  started: boolean;
  done: boolean;
  /** liệu trình của KTV khác – KTV không đổi / bỏ được */
  locked: boolean;
};
/** Dòng trong danh sách đang sửa: id = dòng cũ giữ lại, null = liệu trình mới */
type Entry = Pick & { id: string | null; locked: boolean };

/** Thanh nút cuối màn chi tiết lịch: Quy trình liệu trình + Xác nhận lịch + Đổi / thêm liệu trình */
export default function DetailActions({
  appointmentId,
  confirmed,
  autoTime,
  procedureHref,
  consult,
  customerId,
  branchId,
  services,
  closed,
  booked,
}: {
  appointmentId: string;
  confirmed: boolean;
  autoTime: string;
  procedureHref: string | null;
  consult: boolean;
  customerId: string;
  branchId: string;
  services: PickService[];
  closed: boolean;
  booked: BookedRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [list, setList] = useState<Entry[]>([]);
  const [replacing, setReplacing] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const fixed = booked.filter((b) => b.started); // đã bắt đầu / đã xong: giữ nguyên
  const room = MAX_SERVICES - fixed.length;
  const total = list.reduce((t, e) => t + e.minutes, 0);

  async function confirm() {
    setBusy(true);
    setError(null);
    const { error: e } = await createClient().rpc("ktv_confirm", { p_appt: appointmentId });
    setBusy(false);
    if (e) return setError(vnError(e.message));
    router.refresh();
  }

  function openEditor() {
    setList(booked.filter((b) => !b.started).map((b) => ({ id: b.id, serviceId: b.serviceId, itemId: b.itemId, label: b.label, minutes: b.minutes, locked: b.locked })));
    setReplacing(null);
    setMsg(null);
    setError(null);
    setEditing(true);
  }

  const same = (a: Pick, b: Pick) => a.serviceId === b.serviceId && (a.itemId ?? null) === (b.itemId ?? null);

  /** Bấm 1 liệu trình trong danh sách chọn: đang Đổi → thay vào vị trí đó; đã có → bỏ; chưa có → thêm */
  function toggle(p: Pick) {
    setMsg(null);
    if (replacing !== null) {
      setList((cur) => cur.map((e, i) => (i === replacing ? { ...p, id: null, locked: false } : e)));
      setReplacing(null);
      return;
    }
    const at = list.findIndex((e) => same(e, p));
    if (at >= 0) {
      if (list[at].locked) return setMsg("Liệu trình của KTV khác – báo quản lý / lễ tân nếu cần đổi.");
      return setList((cur) => cur.filter((_, i) => i !== at));
    }
    if (list.length >= room) return setMsg(`Mỗi buổi tối đa ${MAX_SERVICES} dịch vụ cho 1 khách.`);
    setList((cur) => [...cur, { ...p, id: null, locked: false }]);
  }

  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    setList((cur) => {
      const n = [...cur];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  }

  async function save() {
    if (list.length + fixed.length === 0) return setError("Chọn ít nhất 1 liệu trình.");
    setBusy(true);
    setError(null);
    const { data, error: e } = await createClient().rpc("ktv_set_services", {
      p_appt: appointmentId,
      p_items: list.map((x) => ({ id: x.id, service_id: x.serviceId, package_item_id: x.itemId })),
    });
    setBusy(false);
    if (e) return setError(vnError(e.message));
    setEditing(false);
    if (consult && data) router.push(`/quan-ly/ktv/lieu-trinh/${data as string}`);
    else router.refresh();
  }

  if (editing) {
    return (
      <div className="fixed inset-0 z-40 overflow-y-auto bg-cream">
        <div className="mx-auto max-w-3xl space-y-3 px-4 pb-36 pt-4">
          <div className="flex items-center justify-between">
            <p className="text-lg font-bold">{consult ? "Chọn liệu trình cho khách" : "Đổi / thêm liệu trình"}</p>
            <button className="text-sm font-semibold text-navy underline" onClick={() => setEditing(false)}>Đóng</button>
          </div>
          <p className="text-xs text-[#646464]">
            Bấm <b>Đổi</b> để thay liệu trình sang liệu trình khác, <b>Bỏ</b> để bỏ, hoặc chọn thêm ở danh sách bên dưới (tối đa {MAX_SERVICES} dịch vụ / buổi). Các liệu trình làm nối tiếp theo thứ tự.
          </p>

          <div className="space-y-1.5 rounded-[14px] bg-white p-3">
            {fixed.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-2 text-sm text-[#646464]">
                <span>✓ {b.label} · {b.minutes} phút</span>
                <span className="shrink-0 text-xs">{b.done ? "Đã xong" : "Đang làm"} – giữ nguyên</span>
              </div>
            ))}
            {list.length === 0 && fixed.length === 0 && <p className="text-sm text-[#646464]">Chưa có liệu trình nào – chọn ở danh sách bên dưới.</p>}
            {list.map((e, i) => (
              <div key={`${e.id ?? "new"}-${e.serviceId}-${i}`} className={`space-y-1 rounded-lg px-2 py-1.5 ${replacing === i ? "bg-beige ring-2 ring-brown" : ""}`}>
                <div className="flex items-start justify-between gap-2 text-sm">
                  <span>
                    {fixed.length + i + 1}. <b>{e.label}</b> · {e.minutes} phút
                    {e.itemId ? " · trừ buổi combo" : ""}
                    {e.id === null && <span className="ml-1 rounded-full bg-[#E4F2E9] px-1.5 py-0.5 text-[10px] font-semibold text-[#1F5E3A]">mới</span>}
                  </span>
                  {!e.locked && (
                    <span className="flex shrink-0 gap-2.5 text-xs font-semibold text-navy">
                      {list.length > 1 && (
                        <>
                          <button type="button" aria-label="Lên" disabled={i === 0} className="disabled:opacity-30" onClick={() => move(i, -1)}>▲</button>
                          <button type="button" aria-label="Xuống" disabled={i === list.length - 1} className="disabled:opacity-30" onClick={() => move(i, 1)}>▼</button>
                        </>
                      )}
                      <button type="button" className="underline" onClick={() => setReplacing(replacing === i ? null : i)}>
                        {replacing === i ? "Thôi đổi" : "Đổi"}
                      </button>
                      <button type="button" className="underline" onClick={() => { setList((cur) => cur.filter((_, k) => k !== i)); setReplacing(null); }}>
                        Bỏ
                      </button>
                    </span>
                  )}
                </div>
                {e.locked && <p className="text-[11px] text-[#646464]">Liệu trình của KTV khác – không sửa được</p>}
                {replacing === i && <p className="text-[11px] font-semibold text-[#5E4B30]">Chọn liệu trình thay thế ở danh sách bên dưới ↓</p>}
              </div>
            ))}
            {list.length > 0 && <p className="pt-1 text-xs font-semibold">Tổng {fixed.length + list.length} dịch vụ · {total + fixed.reduce((t, b) => t + b.minutes, 0)} phút</p>}
          </div>

          <p className="text-sm font-semibold">{replacing !== null ? `Đổi "${list[replacing]?.label}" sang:` : "Thêm liệu trình"}</p>
          <ServicePicker customerId={customerId} branchId={branchId} services={services} selected={list} onToggle={toggle} />
          {msg && <p className="text-xs text-[#B3261E]">{msg}</p>}
        </div>

        <div className="fixed inset-x-0 bottom-0 border-t border-[#E6DDCC] bg-white px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto max-w-3xl space-y-1.5">
            {error && <p className="text-center text-xs text-[#B3261E]">{error}</p>}
            <div className="flex gap-2.5">
              <button className="min-h-[52px] flex-1 rounded-[14px] border-[1.5px] border-navy text-[15px] font-semibold text-navy" onClick={() => setEditing(false)}>
                Huỷ
              </button>
              <button className="min-h-[52px] flex-[2] rounded-[14px] bg-navy text-[15px] font-semibold text-white disabled:opacity-50" disabled={busy || list.length + fixed.length === 0} onClick={save}>
                {busy ? "Đang lưu…" : consult ? "Lưu & làm liệu trình" : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#E6DDCC] bg-white px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
      <div className="mx-auto max-w-3xl space-y-2">
        {!confirmed && !closed && <p className="text-center text-xs text-[#646464]">Nếu chưa xác nhận, hệ thống tự nhận lịch lúc {autoTime}</p>}
        {error && <p className="text-center text-xs text-[#B3261E]">{error}</p>}
        {!closed && !consult && (
          <button className="min-h-11 w-full rounded-[14px] border-[1.5px] border-dashed border-[#7A6242] text-sm font-semibold text-[#5E4B30]" onClick={openEditor}>
            ⇄ Đổi / thêm liệu trình
          </button>
        )}
        <div className="flex gap-2.5">
          {consult && !closed ? (
            <button className="min-h-[52px] flex-1 rounded-[14px] border-[1.5px] border-navy text-[15px] font-semibold text-navy" onClick={openEditor}>
              Chọn liệu trình
            </button>
          ) : procedureHref ? (
            <Link href={procedureHref} className="flex min-h-[52px] flex-1 items-center justify-center rounded-[14px] border-[1.5px] border-navy text-[15px] font-semibold text-navy">
              Quy trình liệu trình
            </Link>
          ) : null}
          {!closed && (
            confirmed ? (
              <span className="flex min-h-[52px] flex-1 items-center justify-center rounded-[14px] bg-[#E4F2E9] text-[15px] font-semibold text-[#1F5E3A]">✓ Đã nhận lịch</span>
            ) : (
              <button className="min-h-[52px] flex-1 rounded-[14px] bg-navy text-[15px] font-semibold text-white disabled:opacity-50" disabled={busy} onClick={confirm}>
                Xác nhận lịch
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
