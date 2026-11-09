/**
 * Nén ảnh ngay trên điện thoại trước khi gửi lên (tiết kiệm dung lượng, giữ độ nét soi lỗ chân lông).
 * - Ảnh gốc: cạnh dài tối đa 2560px, WebP chất lượng 0.86 (≈ 350–700KB thay vì 3–6MB của ảnh điện thoại).
 *   Máy không hỗ trợ ghi WebP (iPhone đời cũ) -> JPEG chất lượng 0.9.
 * - Ảnh thu nhỏ: cạnh dài 480px (≈ 20–40KB) để xem danh sách nhanh; chỉ tải ảnh gốc khi bấm mở.
 */
export const PHOTO_MAX_EDGE = 2560;
export const PHOTO_QUALITY = 0.86;
export const THUMB_MAX_EDGE = 480;
export const THUMB_QUALITY = 0.7;

export type Compressed = { full: Blob; thumb: Blob; ext: "webp" | "jpg"; type: string; width: number; height: number };

async function decode(file: File): Promise<{ src: CanvasImageSource; w: number; h: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch {
      // một số máy không đọc được -> dùng thẻ <img>
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  return { src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

function toBlob(canvas: HTMLCanvasElement, type: string, q: number): Promise<Blob | null> {
  return new Promise((res) => canvas.toBlob(res, type, q));
}

async function render(src: CanvasImageSource, w: number, h: number, maxEdge: number, q: number, preferWebp: boolean) {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Máy không hỗ trợ xử lý ảnh");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, cw, ch);
  let blob = preferWebp ? await toBlob(canvas, "image/webp", q) : null;
  if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", Math.min(0.92, q + 0.04));
  canvas.width = canvas.height = 0; // giải phóng bộ nhớ trên điện thoại
  if (!blob) throw new Error("Không nén được ảnh");
  return { blob, width: cw, height: ch };
}

export async function compressPhoto(file: File): Promise<Compressed> {
  const img = await decode(file);
  try {
    const full = await render(img.src, img.w, img.h, PHOTO_MAX_EDGE, PHOTO_QUALITY, true);
    const webp = full.blob.type === "image/webp";
    const thumb = await render(img.src, img.w, img.h, THUMB_MAX_EDGE, THUMB_QUALITY, webp);
    return { full: full.blob, thumb: thumb.blob, ext: webp ? "webp" : "jpg", type: full.blob.type, width: full.width, height: full.height };
  } finally {
    img.close();
  }
}

/** Đường dẫn ảnh thu nhỏ tương ứng ảnh gốc */
export function thumbPath(path: string): string {
  return path.replace(/\.(\w+)$/, "_t.$1");
}
