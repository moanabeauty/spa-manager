"use client";

import { useEffect, useRef, useState } from "react";
import { cleanBarcode } from "@/lib/inventory";

type Detector = { detect: (src: HTMLVideoElement | ImageBitmap | HTMLCanvasElement) => Promise<{ rawValue: string; format?: string }[]> };
type DetectorCtor = {
  new (opts?: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

// Các loại mã hay gặp trên mỹ phẩm: EAN-13 / EAN-8 / UPC (mã sản phẩm), Code 128, QR, DataMatrix,
// và mã nội bộ của nhà phân phối: Code 39 / Code 93 / Codabar / ITF (vd tem Lait VIP O2 là Code 39 "11913586").
const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "codabar", "itf", "qr_code", "data_matrix"];
// Loại mã "yếu": không có số kiểm tra bắt buộc nên dễ đọc nhầm → cần đọc trùng nhiều lần hơn
const WEAK = /^(code_?39|code_?93|codabar|itf)$/i;

/**
 * Nhóm loại mã: "ean" = EAN-13 / EAN-8 / UPC (có số kiểm tra cuối); "weak" = Code 39 / 93 / Codabar / ITF
 * (không có số kiểm tra bắt buộc → dễ đọc nhầm, cần đọc trùng nhiều lần); "strong" = Code 128, QR, DataMatrix.
 * Không biết loại (vd gõ tay) thì đoán: toàn số dài 8 / 12 / 13 coi là EAN.
 */
type Kind = "ean" | "weak" | "strong";
function kindOf(format: string, code: string): Kind {
  const f = format.toLowerCase();
  if (/^(ean_?13|ean_?8|upc_?a|upc_?e)$/.test(f)) return "ean";
  if (WEAK.test(f)) return "weak";
  if (f) return "strong";
  return /^\d{8}$|^\d{12,13}$/.test(code) ? "ean" : "strong";
}
/** Mã EAN / UPC phải đúng số kiểm tra cuối — chặn đọc nhầm (chỉ áp cho loại EAN / UPC) */
function checkOk(digits: string, check: number): boolean {
  const sum = digits.split("").map(Number).reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
/** UPC-E 8 số: số kiểm tra tính trên mã UPC-A mở rộng */
function upcEBody(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const [n, a, b, c, d, e, f] = code.slice(0, 7).split("");
  if (f <= "2") return `${n}${a}${b}${f}0000${c}${d}${e}`;
  if (f === "3") return `${n}${a}${b}${c}00000${d}${e}`;
  if (f === "4") return `${n}${a}${b}${c}${d}00000${e}`;
  return `${n}${a}${b}${c}${d}${e}0000${f}`;
}
function plausible(code: string, kind: Kind): boolean {
  if (kind !== "ean") return true;
  if (!/^\d+$/.test(code) || ![8, 12, 13].includes(code.length)) return false;
  const check = Number(code[code.length - 1]);
  if (checkOk(code.slice(0, -1), check)) return true;
  const e = code.length === 8 ? upcEBody(code) : null;
  return !!e && checkOk(e, check);
}

/**
 * Bộ đọc mã của trình duyệt (BarcodeDetector) chỉ dùng khi nó thật sự đọc được mã sản phẩm EAN-13.
 * Chrome trên Windows / một số máy Android có sẵn BarcodeDetector nhưng không đọc được loại nào → phải dùng ZXing.
 */
async function nativeDetector(): Promise<Detector | null> {
  const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (!Native) return null;
  try {
    const supported = (await Native.getSupportedFormats?.()) ?? [];
    if (!supported.includes("ean_13")) return null;
    return new Native({ formats: NATIVE_FORMATS.filter((f) => supported.includes(f)) });
  } catch {
    return null;
  }
}

let zxFormatName: (f: number) => string = () => "";
async function zxingReader() {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import("@zxing/browser"),
    import("@zxing/library"),
  ]);
  zxFormatName = (f) => String(BarcodeFormat[f] ?? "");
  const hints = new Map();
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.CODE_93,
    BarcodeFormat.CODABAR,
    BarcodeFormat.ITF,
    BarcodeFormat.QR_CODE,
    BarcodeFormat.DATA_MATRIX,
  ]);
  return new BrowserMultiFormatReader(hints);
}

/** Vẽ một vùng của ảnh / khung hình vào canvas, thu về chiều rộng tối đa `maxW` */
function crop(
  src: CanvasImageSource,
  sw: number,
  sh: number,
  region: { x: number; y: number; w: number; h: number },
  maxW: number,
  canvas = document.createElement("canvas"),
) {
  const rw = sw * region.w;
  const rh = sh * region.h;
  const scale = Math.min(1, maxW / rw);
  canvas.width = Math.max(1, Math.round(rw * scale));
  canvas.height = Math.max(1, Math.round(rh * scale));
  canvas.getContext("2d", { willReadFrequently: true })!.drawImage(src, sw * region.x, sh * region.y, rw, rh, 0, 0, canvas.width, canvas.height);
  return canvas;
}
const FULL = { x: 0, y: 0, w: 1, h: 1 };
const BAND = { x: 0.05, y: 0.3, w: 0.9, h: 0.4 }; // dải giữa khung hình, đúng chỗ khung trắng

/** Tên loại mã: ZXing trả số (BarcodeFormat), trình duyệt trả chuỗi ("code_39") */
const formatName = (format: string | number | undefined) => (typeof format === "number" ? zxFormatName(format) : (format ?? ""));

/** EAN-8 / UPC-E 8 số — loại hay bị đọc nhầm từ một phần mã khác khi ảnh mờ */
const isShortEan = (code: string, kind: Kind) => kind === "ean" && code.length === 8;

/**
 * Bỏ phiếu giữa các lần đọc: chỉ nhận khi cùng một mã đọc ra nhiều lần.
 * EAN-13 / Code 128 / QR: 2 lần. Code 39 / 93 / Codabar / ITF: 3 lần ở ít nhất 2 vùng / cỡ khác nhau.
 * EAN-8 / UPC-E: 3 lần ở 2 vùng, và không nhận nếu gần đó đã đọc thấy mã khác (khi đó gần như chắc là đọc nhầm).
 */
function makeVoter(windowMs = 4000) {
  const votes = new Map<string, { n: number; regions: Set<string>; t: number; kind: Kind }>();
  return {
    add(code: string, region: string, kind: Kind): string | null {
      const now = Date.now();
      for (const [k, v] of votes) if (now - v.t > windowMs) votes.delete(k);
      const v = votes.get(code) ?? { n: 0, regions: new Set<string>(), t: now, kind };
      v.n += 1;
      v.regions.add(region);
      v.t = now;
      votes.set(code, v);
      const otherSeen = [...votes.entries()].some(([k, x]) => k !== code && !isShortEan(k, x.kind));
      const ok = isShortEan(code, kind)
        ? !otherSeen && v.n >= 3 && v.regions.size >= 2
        : kind === "weak"
          ? v.n >= 3 && v.regions.size >= 2
          : v.n >= 2;
      if (!ok) return null;
      votes.clear();
      return code;
    },
  };
}

/** Đọc mã từ ảnh chụp: thu nhỏ ảnh về vài cỡ rồi thử lần lượt (ảnh 12MP đọc trực tiếp rất chậm và hay trượt) */
async function decodePhoto(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const native = await nativeDetector();
  if (native) {
    try {
      const codes = (await native.detect(bitmap))
        .map((f) => ({ code: cleanBarcode(f.rawValue), kind: kindOf(formatName(f.format), cleanBarcode(f.rawValue)) }))
        .filter((x) => x.code && plausible(x.code, x.kind));
      const best = (codes.find((x) => !isShortEan(x.code, x.kind)) ?? codes[0])?.code;
      if (best) return best;
    } catch {
      // thử tiếp bằng ZXing
    }
  }
  const reader = await zxingReader();
  // thử hết các vùng / cỡ rồi chọn: mã dài đọc được ở đâu cũng ưu tiên; mã ngắn 8 số phải ra ít nhất 2 lần
  const tries: [typeof FULL, number][] = [[FULL, 1600], [BAND, 1600], [FULL, 1000], [BAND, 1000], [FULL, 2400], [FULL, 700]];
  const tally = new Map<string, number>();
  const kinds = new Map<string, Kind>();
  for (const [region, size] of tries) {
    try {
      const r = reader.decodeFromCanvas(crop(bitmap, bitmap.width, bitmap.height, region, size));
      const code = cleanBarcode(r.getText());
      const kind = kindOf(formatName(r.getBarcodeFormat()), code);
      if (!code || !plausible(code, kind)) continue;
      tally.set(code, (tally.get(code) ?? 0) + 1);
      kinds.set(code, kind);
    } catch {
      // vùng / cỡ này không đọc được, thử tiếp
    }
  }
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const long = ranked.find(([c, n]) => !isShortEan(c, kinds.get(c)!) && (kinds.get(c) !== "weak" || n >= 2));
  if (long) return long[0];
  const short = ranked.length === 1 && ranked[0][1] >= 2 ? ranked[0] : null;
  return short ? short[0] : null;
}

/**
 * Quét mã vạch bằng camera điện thoại (camera sau). Quét liên tục, cùng 1 mã chỉ nhận lại sau 2 giây.
 * Không quét được thì có thể chụp ảnh mã vạch hoặc gõ số in dưới mã vạch.
 */
export default function CameraScanner({ onScan, onClose }: { onScan: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const emitRef = useRef<(code: string) => void>(() => {});
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [busyPhoto, setBusyPhoto] = useState(false);
  const [photoMsg, setPhotoMsg] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    let cancelled = false;
    let stop = () => {};
    let lastCode = "";
    let lastAt = 0;
    const emit = (raw: string) => {
      const code = cleanBarcode(raw);
      if (!code) return;
      const now = Date.now();
      if (code === lastCode && now - lastAt < 2000) return;
      lastCode = code;
      lastAt = now;
      setLast(code);
      setSlow(false);
      if (navigator.vibrate) navigator.vibrate(80);
      onScanRef.current(code);
    };
    emitRef.current = emit;
    const voter = makeVoter();
    const vote = (raw: string, region: string, format: string | number | undefined) => {
      const code = cleanBarcode(raw);
      const kind = kindOf(formatName(format), code);
      if (!code || !plausible(code, kind)) return;
      const ok = voter.add(code, region, kind);
      if (ok) emit(ok);
    };
    const slowTimer = window.setTimeout(() => setSlow(true), 8000);

    (async () => {
      try {
        const video = videoRef.current;
        if (!video) return;
        const native = await nativeDetector();
        if (cancelled) return;
        const stream = await navigator.mediaDevices.getUserMedia(CAMERA);
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        video.srcObject = stream;
        await video.play();
        tuneCamera(stream);
        const reader = native ? null : await zxingReader();
        const canvas = document.createElement("canvas");
        // ZXing: mỗi lượt đọc một vùng / cỡ khác nhau của khung hình (dải giữa và cả khung, giữ đủ hai đầu mã vạch)
        const regions: [typeof FULL, number][] = [[BAND, 1280], [FULL, 1280], [BAND, 900], [FULL, 900]];
        let turn = 0;
        let timer = 0;
        const tick = async () => {
          try {
            if (video.readyState >= 2 && video.videoWidth) {
              if (native) {
                const found = await native.detect(video);
                for (const f of found) vote(f.rawValue, `n${turn++ % 2}`, f.format);
              } else if (reader) {
                const i = turn++ % regions.length;
                const [region, size] = regions[i];
                try {
                  const r = reader.decodeFromCanvas(crop(video, video.videoWidth, video.videoHeight, region, size, canvas));
                  vote(r.getText(), `z${i}`, r.getBarcodeFormat());
                } catch {
                  // khung hình này chưa thấy mã
                }
              }
            }
          } catch {
            // khung hình chưa sẵn sàng
          }
          if (!cancelled) timer = window.setTimeout(tick, native ? 150 : 60);
        };
        tick();
        stop = () => {
          window.clearTimeout(timer);
          stream.getTracks().forEach((t) => t.stop());
        };
      } catch (e) {
        const msg = e instanceof Error ? e.name + " " + e.message : String(e);
        setError(
          /NotAllowed|Permission/i.test(msg)
            ? "Chưa cho phép dùng camera. Hãy cho phép camera trong trình duyệt, hoặc bấm Chụp ảnh mã vạch bên dưới."
            : /NotFound|Overconstrained/i.test(msg)
              ? "Không tìm thấy camera trên thiết bị này. Bạn có thể gõ số dưới mã vạch."
              : "Không mở được camera trực tiếp. Hãy bấm Chụp ảnh mã vạch hoặc gõ số dưới mã vạch.",
        );
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
      stop();
    };
  }, []);

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusyPhoto(true);
    setPhotoMsg(null);
    try {
      const code = await decodePhoto(file);
      if (code) emitRef.current(code);
      else setPhotoMsg("Ảnh chưa đọc được mã. Chụp gần hơn, đủ sáng, mã vạch nằm ngang và rõ nét — hoặc gõ số dưới mã vạch.");
    } catch {
      setPhotoMsg("Không đọc được ảnh này. Hãy thử chụp lại hoặc gõ số dưới mã vạch.");
    }
    setBusyPhoto(false);
  }

  function submitTyped() {
    const code = typed.replace(/\s/g, "");
    if (!code) return;
    setTyped("");
    emitRef.current(code);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-black/90 p-4 text-white">
      <div className="mx-auto flex w-full max-w-md items-center justify-between">
        <p className="font-semibold">Đưa mã vạch vào khung</p>
        <button className="rounded-full bg-white/15 px-4 py-1.5 text-sm font-semibold" onClick={onClose}>
          Xong
        </button>
      </div>
      <div className="relative mx-auto mt-4 w-full max-w-md overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} className="aspect-[4/3] w-full object-cover" playsInline muted />
        <div className="pointer-events-none absolute inset-x-6 top-1/2 h-28 -translate-y-1/2 rounded-xl border-2 border-white/80" />
      </div>
      <p className="mx-auto mt-3 max-w-md text-center text-sm text-white/80">
        {error ??
          (last
            ? `Đã đọc mã: ${last}`
            : slow
              ? "Chưa đọc được? Để mã vạch nằm ngang, cách camera 10–20 cm, đủ sáng — hoặc chụp ảnh / gõ số bên dưới."
              : "Giữ yên điện thoại, mã vạch nằm ngang trong khung.")}
      </p>

      <div className="mx-auto mt-4 w-full max-w-md space-y-3">
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhoto} />
        <button
          className="w-full rounded-xl bg-white py-2.5 text-sm font-semibold text-navy disabled:opacity-60"
          disabled={busyPhoto}
          onClick={() => fileRef.current?.click()}
        >
          {busyPhoto ? "Đang đọc ảnh…" : "📸 Chụp ảnh mã vạch"}
        </button>
        {photoMsg && <p className="text-center text-xs text-[#FFD7D7]">{photoMsg}</p>}
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-xl bg-white/10 px-3 py-2 font-mono text-sm text-white placeholder:text-white/50"
            inputMode="numeric"
            placeholder="Hoặc gõ số dưới mã vạch"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitTyped()}
          />
          <button className="rounded-xl bg-white/20 px-4 text-sm font-semibold disabled:opacity-50" disabled={!typed.trim()} onClick={submitTyped}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
