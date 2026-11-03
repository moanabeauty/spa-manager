"use client";

import { useEffect, useRef, useState } from "react";

type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorCtor = new () => Detector;

/**
 * Quét mã vạch bằng camera điện thoại (camera sau). Quét liên tục, cùng 1 mã chỉ nhận lại sau 2 giây.
 * Trình duyệt có sẵn BarcodeDetector (Chrome Android) thì dùng luôn; còn lại (iPhone) dùng thư viện ZXing.
 */
export default function CameraScanner({ onScan, onClose }: { onScan: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stop = () => {};
    let lastCode = "";
    let lastAt = 0;
    const emit = (code: string) => {
      const now = Date.now();
      if (code === lastCode && now - lastAt < 2000) return;
      lastCode = code;
      lastAt = now;
      setLast(code);
      if (navigator.vibrate) navigator.vibrate(80);
      onScanRef.current(code);
    };

    (async () => {
      try {
        const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
        const video = videoRef.current;
        if (!video) return;
        if (Native) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
          if (cancelled) return stream.getTracks().forEach((t) => t.stop());
          video.srcObject = stream;
          await video.play();
          const detector = new Native();
          let timer = 0;
          const tick = async () => {
            try {
              const found = await detector.detect(video);
              if (found[0]?.rawValue) emit(found[0].rawValue);
            } catch {
              // khung hình chưa sẵn sàng
            }
            if (!cancelled) timer = window.setTimeout(tick, 200);
          };
          tick();
          stop = () => {
            window.clearTimeout(timer);
            stream.getTracks().forEach((t) => t.stop());
          };
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const reader = new BrowserMultiFormatReader();
          const controls = await reader.decodeFromConstraints(
            { video: { facingMode: "environment" }, audio: false },
            video,
            (result) => {
              if (result) emit(result.getText());
            },
          );
          if (cancelled) return controls.stop();
          stop = () => controls.stop();
        }
      } catch (e) {
        const msg = e instanceof Error ? e.name + " " + e.message : String(e);
        setError(
          /NotAllowed|Permission/i.test(msg)
            ? "Chưa cho phép dùng camera. Hãy bấm cho phép camera trong trình duyệt rồi thử lại."
            : /NotFound|Overconstrained/i.test(msg)
              ? "Không tìm thấy camera trên thiết bị này."
              : "Không mở được camera. Bạn có thể gõ mã vạch hoặc dùng máy quét.",
        );
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4 text-white">
      <div className="mx-auto flex w-full max-w-md items-center justify-between">
        <p className="font-semibold">Đưa mã vạch vào khung</p>
        <button className="rounded-full bg-white/15 px-4 py-1.5 text-sm font-semibold" onClick={onClose}>
          Xong
        </button>
      </div>
      <div className="relative mx-auto mt-4 w-full max-w-md overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} className="aspect-[3/4] w-full object-cover" playsInline muted />
        <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-white/80" />
      </div>
      <p className="mx-auto mt-3 max-w-md text-center text-sm text-white/80">
        {error ?? (last ? `Đã quét: ${last}` : "Quét liên tục được nhiều sản phẩm, bấm Xong khi đủ.")}
      </p>
    </div>
  );
}
