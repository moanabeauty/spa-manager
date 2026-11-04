"use client";

import { useEffect, useRef, useState } from "react";

type Detector = { detect: (src: HTMLVideoElement | ImageBitmap | HTMLCanvasElement) => Promise<{ rawValue: string }[]> };
type DetectorCtor = {
  new (opts?: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

// Các loại mã hay gặp trên mỹ phẩm: EAN-13 / EAN-8 / UPC (mã sản phẩm), Code 128 / 39, ITF, QR, DataMatrix
const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code", "data_matrix"];

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

async function zxingReader() {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import("@zxing/browser"),
    import("@zxing/library"),
  ]);
  const hints = new Map();
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.ITF,
    BarcodeFormat.QR_CODE,
    BarcodeFormat.DATA_MATRIX,
  ]);
  return new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
}

const CAMERA: MediaStreamConstraints = {
  video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  audio: false,
};

/** Bật lấy nét liên tục nếu camera hỗ trợ (giúp đọc mã nhỏ trên chai lọ) */
function tryAutofocus(stream: MediaStream | null) {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  track.applyConstraints({ advanced: [{ focusMode: "continuous" }] } as unknown as MediaTrackConstraints).catch(() => {});
}

/** Đọc mã từ ảnh chụp: thu nhỏ ảnh về vài cỡ rồi thử lần lượt (ảnh 12MP đọc trực tiếp rất chậm và hay trượt) */
async function decodePhoto(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const native = await nativeDetector();
  if (native) {
    try {
      const found = await native.detect(bitmap);
      if (found[0]?.rawValue) return found[0].rawValue;
    } catch {
      // thử tiếp bằng ZXing
    }
  }
  const reader = await zxingReader();
  const longest = Math.max(bitmap.width, bitmap.height);
  for (const size of [1600, 1000, 2400, 700]) {
    const scale = Math.min(1, size / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    try {
      return reader.decodeFromCanvas(canvas).getText();
    } catch {
      // cỡ này không đọc được, thử cỡ khác
    }
    if (scale === 1 && size >= longest) break;
  }
  return null;
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
      const code = raw.replace(/\s/g, "");
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
    const slowTimer = window.setTimeout(() => setSlow(true), 8000);

    (async () => {
      try {
        const video = videoRef.current;
        if (!video) return;
        const native = await nativeDetector();
        if (cancelled) return;
        if (native) {
          const stream = await navigator.mediaDevices.getUserMedia(CAMERA);
          if (cancelled) return stream.getTracks().forEach((t) => t.stop());
          video.srcObject = stream;
          await video.play();
          tryAutofocus(stream);
          let timer = 0;
          const tick = async () => {
            try {
              if (video.readyState >= 2) {
                const found = await native.detect(video);
                if (found[0]?.rawValue) emit(found[0].rawValue);
              }
            } catch {
              // khung hình chưa sẵn sàng
            }
            if (!cancelled) timer = window.setTimeout(tick, 150);
          };
          tick();
          stop = () => {
            window.clearTimeout(timer);
            stream.getTracks().forEach((t) => t.stop());
          };
        } else {
          const reader = await zxingReader();
          if (cancelled) return;
          const controls = await reader.decodeFromConstraints(CAMERA, video, (result) => {
            if (result) emit(result.getText());
          });
          if (cancelled) return controls.stop();
          tryAutofocus(video.srcObject as MediaStream | null);
          stop = () => controls.stop();
        }
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
