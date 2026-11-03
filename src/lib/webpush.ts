// Gửi thông báo đẩy (Web Push) tới điện thoại / máy tính mà không cần thư viện ngoài.
// Theo chuẩn RFC 8291 (mã hoá aes128gcm) + RFC 8292 (khoá VAPID).
import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from "node:crypto";

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

const b64u = {
  enc: (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
};

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** Mã hoá nội dung cho 1 thiết bị (aes128gcm) */
export function encryptPayload(target: PushTarget, payload: string): Buffer {
  const uaPublic = b64u.dec(target.p256dh);
  const authSecret = b64u.dec(target.auth);
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);

  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);

  const salt = randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload, "utf8"), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** Chữ ký VAPID: chứng minh thông báo gửi từ máy chủ Moana */
export function vapidHeader(endpoint: string, publicKey: string, privateKey: string, subject: string): string {
  const pub = b64u.dec(publicKey);
  const key = createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: privateKey, x: b64u.enc(pub.subarray(1, 33)), y: b64u.enc(pub.subarray(33, 65)) },
    format: "jwk",
  });
  const head = b64u.enc(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u.enc(
    Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })),
  );
  const sig = sign("sha256", Buffer.from(`${head}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${claims}.${b64u.enc(sig)}, k=${publicKey}`;
}

/** Gửi 1 thông báo. Trả về mã HTTP (201 = đã gửi; 404 / 410 = thiết bị đã gỡ đăng ký) */
export async function sendPush(target: PushTarget, payload: object): Promise<number> {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) throw new Error("Chưa cài khoá VAPID");
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@moanabeauty.vn";
  const res = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      Authorization: vapidHeader(target.endpoint, publicKey, privateKey, subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "high",
    },
    body: new Uint8Array(encryptPayload(target, JSON.stringify(payload))),
  });
  return res.status;
}
