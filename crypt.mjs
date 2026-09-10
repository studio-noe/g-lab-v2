// 훈련 데이터 암호화. 입장코드가 곧 열쇠다.
// PBKDF2-SHA256 30만 회로 늘린 뒤 AES-GCM 256 으로 봉한다.
// 브라우저 쪽 복호화(index.html)와 같은 규격이어야 한다.
import { webcrypto as wc } from 'node:crypto';

const ITER = 300000;
const b64 = u8 => Buffer.from(u8).toString('base64');
const un64 = s => new Uint8Array(Buffer.from(s, 'base64'));

async function keyOf(code, salt, iter = ITER) {
  const km = await wc.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
  return wc.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function seal(text, code) {
  const salt = wc.getRandomValues(new Uint8Array(16));
  const iv = wc.getRandomValues(new Uint8Array(12));
  const key = await keyOf(code, salt);
  const ct = new Uint8Array(await wc.subtle.encrypt({ name: 'AES-GCM', iv }, key,
    new TextEncoder().encode(text)));
  return Buffer.from(JSON.stringify({ v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) }))
    .toString('base64');
}

export async function open(blob, code) {
  const o = JSON.parse(Buffer.from(blob, 'base64').toString('utf8'));
  const key = await keyOf(code, un64(o.salt), o.iter);
  const pt = await wc.subtle.decrypt({ name: 'AES-GCM', iv: un64(o.iv) }, key, un64(o.ct));
  return new TextDecoder().decode(pt);
}
