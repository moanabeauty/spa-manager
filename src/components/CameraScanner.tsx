"use client";

import { useEffect, useRef, useState } from "react";
import { cleanBarcode } from "@/lib/inventory";

type Detector = { detect: (src: HTMLVideoElement | ImageBitmap | HTMLCanvasElement) => Promise<{ rawValue: string; format?: string }[]> };
type DetectorCtor = {
  new (opts?: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

// Các loại mã hay gặp trên mỹ phẩm: EAN-13 / EAN-8 / UPC (mã sản phẩm), Code 128, QR, DataMatrix,
// và mã nội bộ của hãng: Code 39 / Code 93 / Codabar / ITF (vd Lait VIP O2 in mã 9 số 119913586).
const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "codabar", "itf", "qr_code", "data_matrix"];
// Loại mã "yếu": không có số kiểm tra bắt buộc nên dễ đọc nhầm → cần đọc trùng nhiều lần hơn
const WEAK = /^(code_?39|code_?93|codabar|itf)$/i;

/** Mã toàn số dài 8 / 12 / 13 (EAN / UPC) phải đúng số kiểm tra cuối — chặn đọc nhầm */
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
function plausible(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13].includes(code.length)) return true;
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

/** Mã ngắn 8 số (EAN-8 / UPC-E) — loại hay bị đọc nhầm từ một phần mã 13 số khi ảnh mờ */
/** Tên loại mã của ZXing (CODE_39) / trình duyệt (code_39) → có phải loại "yếu" */
const weakFormat = (format: string | number | undefined, zxingName?: (f: number) => string) =>
  WEAK.test(typeof format === "number" ? (zxingName?.(format) ?? "") : (format ?? ""));
const isShort = (code: string) => /^\d{8}$/.test(code);

/**
 * Bỏ phiếu giữa các lần đọc: chỉ nhận khi cùng một mã đọc ra nhiều lần.
 * Mã thường cần 2 lần; mã ngắn 8 số cần 3 lần ở ít nhất 2 vùng / cỡ khác nhau,
 * và không nhận mã ngắn nếu gần đó đã đọc thấy một mã dài (mã ngắn khi đó gần như chắc là đọc nhầm).
 */
function makeVoter(windowMs = 4000) {
  const votes = new Map<string, { n: number; regions: Set<string>; t: number }>();
  return {
    add(code: string, region: string, weak = false): string | null {
      const now = Date.now();
      for (const [k, v] of votes) if (now - v.t > windowMs) votes.delete(k);
      const v = votes.get(code) ?? { n: 0, regions: new Set<string>(), t: now };
      v.n += 1;
      v.regions.add(region);
      v.t = now;
      votes.set(code, v);
      const longSeen = [...votes.keys()].some((k) => !isShort(k));
      const ok = isShort(code)
        ? !longSeen && v.n >= 3 && v.regions.size >= 2
        : weak
          ? v.n >= 3 && v.regions.size >= 2
          : v.n >= 2;
      if (!ok) return null;
      votes.clear();
      return code;
    },
  };
}

const CAMERA: MediaStreamConstraints = {
  video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  audio: false,
};

/** Bật lấy nét liên tục + phóng to nhẹ nếu camera hỗ trợ (cầm xa hơn vẫn nét, đọc được mã nhỏ trên chai lọ) */
function tuneCamera(stream: MediaStream | null) {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  const caps = (track.getCapabilities?.() ?? {}) as { focusMode?: string[]; zoom?: { min: number; max: number } };
  const adv: Record<string, unknown>[] = [];
  if (caps.focusMode?.includes("continuous")) adv.push({ focusMode: "continuous" });
  if (caps.zoom && caps.zoom.max >= 1.5) adv.push({ zoom: Math.min(2, caps.zoom.max) });
  if (adv.length) track.applyConstraints({ advanced: adv } as unknown as MediaTrackConstraints).catch(() => {});
}

/** Đọc mã từ ảnh chụp: thu nhỏ ảnh về vài cỡ rồi thử lần lượt (ảnh 12MP đọc trực tiếp rất chậm và hay trượt) */
async function decodePhoto(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const native = await nativeDetector();
  if (native) {
    try {
      const codes = (await native.detect(bitmap)).map((f) => cleanBarcode(f.rawValue)).filter((c) => c && plausible(c));
      const best = codes.find((c) => !isShort(c)) ?? codes[0];
      if (best) return best;
    } catch {
      // thử tiếp bằng ZXing
    }
  }
  const reader = await zxingReader();
  // thử hết các vùng / cỡ rồi chọn: mã dài đọc được ở đâu cũng ưu tiên; mã ngắn 8 số phải ra ít nhất 2 lần
  const tries: [typeof FULL, number][] = [[FULL, 1600], [BAND, 1600], [FULL, 1000], [BAND, 1000], [FULL, 2400], [FULL, 700]];
  const tally = new Map<string, number>();
  const weak = new Set<string>();
  for (const [region, size] of tries) {
    try {
      const r = reader.decodeFromCanvas(crop(bitmap, bitmap.width, bitmap.height, region, size));
      const code = cleanBarcode(r.getText());
      if (!code || !plausible(code)) continue;
      tally.set(code, (tally.get(code) ?? 0) + 1);
      if (weakFormat(r.getBarcodeFormat(), zxFormatName)) weak.add(code);
    } catch {
      // vùng / cỡ này không đọc được, thử tiếp
    }
  }
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const long = ranked.find(([c, n]) => !isShort(c) && (!weak.has(c) || n >= 2));
  if (long) return long[0];
  const short = ranked.find(([, n]) => n >= 2);
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
      if (!code || !plausible(code)) return;
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
    const vote = (raw: string, region: string, weak: boolean) => {
      const code = cleanBarcode(raw);
      if (!code || !plausible(code)) return;
      const ok = voter.add(code, region, weak);
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
                for (const f of found) vote(f.rawValue, `n${turn++ % 2}`, weakFormat(f.format));
              } else if (reader) {
                const i = turn++ % regions.length;
                const [region, size] = regions[i];
                try {
                  const r = reader.decodeFromCanvas(crop(video, video.videoWidth, video.videoHeight, region, size, canvas));
                  vote(r.getText(), `z${i}`, weakFormat(r.getBarcodeFormat(), zxFormatName));
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
