// Nhận ảnh sản phẩm (base64) và lưu vào kho product-images, gắn vào products.image_url / texture_image_url theo mã SP.
// Xác thực bằng khoá tạm trong bảng web_image_import_keys (lưu mã băm SHA-256, có hạn dùng).
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-import-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const key = req.headers.get("x-import-key") || "";
  const { data: k } = await sb.from("web_image_import_keys").select("key_hash").eq("key_hash", await sha256(key)).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!key || !k) return json({ error: "unauthorized" }, 401);

  const { skus, kind, data, mime } = await req.json().catch(() => ({}));
  const list: string[] = Array.isArray(skus) ? skus : [];
  if (!list.length || !["main", "texture"].includes(kind) || typeof data !== "string") return json({ error: "bad request" }, 400);
  const type = ["image/webp", "image/jpeg", "image/png"].includes(mime) ? mime : "image/jpeg";
  const ext = type.split("/")[1].replace("jpeg", "jpg");
  const bytes = Uint8Array.from(atob(data.replace(/^data:[^,]+,/, "")), (c) => c.charCodeAt(0));
  if (bytes.length > 4_000_000) return json({ error: "too large" }, 413);

  const { data: prods, error: pe } = await sb.from("products").select("id, sku").in("sku", list).is("deleted_at", null);
  if (pe) return json({ error: pe.message }, 500);
  const missing = list.filter((s) => !prods!.some((p) => p.sku === s));
  if (missing.length) return json({ error: "sku not found", missing }, 404);

  const path = `web/${list[0]}-${kind}-${Date.now()}.${ext}`;
  const up = await sb.storage.from("product-images").upload(path, bytes, { contentType: type, upsert: true, cacheControl: "31536000" });
  if (up.error) return json({ error: up.error.message }, 500);
  const url = sb.storage.from("product-images").getPublicUrl(path).data.publicUrl;
  const col = kind === "main" ? "image_url" : "texture_image_url";
  const { error: ue } = await sb.from("products").update({ [col]: url }).in("sku", list);
  if (ue) return json({ error: ue.message }, 500);
  return json({ ok: true, url, skus: list, kind, bytes: bytes.length });
});
