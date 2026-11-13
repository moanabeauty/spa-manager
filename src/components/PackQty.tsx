"use client";

import { COUNT_UNITS, UNITS, parseDec } from "@/lib/inventory";

/** Ô nhập số lượng có 2 cách: Theo hộp (số hộp × số ống/hộp) hoặc Theo ống/lọ lẻ — tồn kho luôn lưu theo đơn vị lẻ */
export type PackEntry = {
  mode: "box" | "unit";
  boxes: string; // số hộp
  loose: string; // số đơn vị lẻ (theo ống) / ống lẻ ngoài hộp (theo hộp, khi kiểm kho)
  unit: string; // đơn vị lẻ: ống, lọ, chai…
  pack: string; // số đơn vị lẻ mỗi hộp
  volume: string; // ml mỗi đơn vị lẻ
};

type Spec = { unit: string; volume?: number | string | null; pack_size?: number | null };

export function initPack(p: Spec, loose = ""): PackEntry {
  const legacyBox = p.unit === "hộp";
  return {
    mode: p.pack_size ? "box" : "unit",
    boxes: "",
    loose,
    unit: p.unit,
    pack: p.pack_size ? String(p.pack_size) : "",
    volume: p.volume != null && Number(p.volume) > 0 && !(legacyBox && p.pack_size == null) ? String(Number(p.volume)) : "",
  };
}

const int = (s: string) => {
  const n = Number(s.trim());
  return s.trim() !== "" && Number.isInteger(n) && n >= 0 ? n : null;
};

/** Tổng số đơn vị lẻ; null = chưa nhập đủ / sai */
export function packTotal(e: PackEntry, allowLoose: boolean): number | null {
  if (e.mode === "unit") return int(e.loose);
  const b = int(e.boxes);
  const k = int(e.pack);
  const l = e.loose.trim() === "" ? 0 : int(e.loose);
  if (b === null || k === null || k < 2 || l === null) return null;
  return b * k + (allowLoose ? l : 0);
}

export function packError(e: PackEntry, p?: Spec): string | null {
  if (!e.unit) return "Chọn đơn vị lẻ";
  if (p?.unit === "hộp" && e.unit !== "hộp" && !COUNT_UNITS.includes(e.unit) && e.volume.trim() === "")
    return `Ghi dung tích mỗi ${e.unit} để đổi từ hộp sang ${e.unit}`;
  if (e.mode === "box") {
    if (e.unit === "hộp") return "Theo hộp: chọn đơn vị lẻ trong hộp (ống, lọ…)";
    const k = int(e.pack);
    if (k === null || k < 2) return "Ghi số ống / hộp (từ 2 trở lên)";
  }
  if (!COUNT_UNITS.includes(e.unit) && e.volume.trim() !== "") {
    const v = parseDec(e.volume);
    if (v === null || v <= 0) return "Dung tích mỗi đơn vị lẻ không hợp lệ";
  }
  return null;
}

/** Quy cách mới nếu khác sản phẩm hiện tại (để gọi set_product_pack), không đổi thì null */
export function packChange(p: Spec, e: PackEntry): { p_unit: string; p_volume: number | null; p_pack: number | null } | null {
  const unit = e.unit;
  const fromBox = p.unit === "hộp" && unit !== "hộp";
  const vol = COUNT_UNITS.includes(unit) ? 1 : (parseDec(e.volume) ?? (!fromBox && p.volume != null ? Number(p.volume) : null));
  const pack = e.mode === "box" ? int(e.pack) : unit === p.unit ? (p.pack_size ?? null) : null;
  const same = unit === p.unit && (vol ?? null) === (p.volume != null ? Number(p.volume) : null) && (pack ?? null) === (p.pack_size ?? null);
  return same ? null : { p_unit: unit, p_volume: vol, p_pack: pack };
}

export default function PackQty({
  value,
  onChange,
  allowLoose = false,
  volUnit = "ml",
  product,
}: {
  value: PackEntry;
  onChange: (e: PackEntry) => void;
  allowLoose?: boolean; // kiểm kho: theo hộp + ống lẻ ngoài hộp
  volUnit?: string;
  product?: Spec;
}) {
  const e = value;
  const set = (x: Partial<PackEntry>) => onChange({ ...e, ...x });
  const u = e.unit === "hộp" && e.mode === "box" ? "ống" : e.unit;
  const total = packTotal(e, allowLoose);
  const err = packError(e, product);
  const box = "w-14 rounded-lg border border-beige-dark bg-white px-2 py-1.5 text-right text-sm";
  const units = [...new Set([e.unit, ...UNITS])].filter((x) => e.mode === "unit" || x !== "hộp");

  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex gap-1">
        {(["box", "unit"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={`rounded-full px-3 py-1 font-semibold ${e.mode === m ? "bg-navy text-white" : "bg-cream text-navy ring-1 ring-beige-dark"}`}
            onClick={() => set({ mode: m, unit: m === "box" && e.unit === "hộp" ? "ống" : e.unit })}
          >
            {m === "box" ? "Theo hộp" : `Theo ${e.unit === "hộp" ? "hộp / ống" : e.unit}`}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {e.mode === "box" ? (
          <>
            <input inputMode="numeric" className={box} placeholder="0" value={e.boxes} onChange={(x) => set({ boxes: x.target.value })} aria-label="Số hộp" />
            <span>hộp ×</span>
            <input inputMode="numeric" className={box} placeholder="?" value={e.pack} onChange={(x) => set({ pack: x.target.value })} aria-label="Số đơn vị lẻ mỗi hộp" />
            <span>{u}/hộp</span>
            {allowLoose && (
              <>
                <span className="ml-1">+</span>
                <input inputMode="numeric" className={box} placeholder="0" value={e.loose} onChange={(x) => set({ loose: x.target.value })} aria-label="Đơn vị lẻ ngoài hộp" />
                <span>{u} lẻ</span>
              </>
            )}
          </>
        ) : (
          <>
            <input inputMode="numeric" className={box} placeholder="0" value={e.loose} onChange={(x) => set({ loose: x.target.value })} aria-label="Số lượng" />
            <span>{u}</span>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1 text-ink/65">
        <span>1</span>
        <select className="rounded-lg border border-beige-dark bg-white px-1.5 py-1 text-xs" value={u} onChange={(x) => set({ unit: x.target.value })} aria-label="Đơn vị lẻ">
          {units.map((x) => (
            <option key={x} value={x}>{x}</option>
          ))}
        </select>
        {!COUNT_UNITS.includes(u) && (
          <>
            <span>=</span>
            <input inputMode="decimal" className="w-16 rounded-lg border border-beige-dark bg-white px-2 py-1 text-right text-xs" placeholder="?" value={e.volume} onChange={(x) => set({ volume: x.target.value })} aria-label="Dung tích mỗi đơn vị lẻ" />
            <span>{volUnit}</span>
          </>
        )}
        {e.mode === "box" && total !== null && <b className="ml-auto text-navy">= {total} {u}</b>}
      </div>
      {err && <p className="text-[#8A2323]">{err}</p>}
    </div>
  );
}
