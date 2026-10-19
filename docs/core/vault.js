/**
 * 账号保险箱（vault）：把「平台凭据」（网易云 MUSIC_U、QQ 音乐 qm_keyst）加密后存进账号，
 * 让同一账号在任何设备 / 网页版登录后都能取出来用 —— 但服务端永远拿不到明文。
 *
 * 密钥体系（两层，密码只管私钥，私钥只管数据密钥）：
 *
 *   登录密码 ──PBKDF2-SHA256(iter, salt)──▶ KEK
 *   ECDH P-256 私钥 ──AES-256-GCM(KEK)──▶  privKeyEnc   ← 存账号（改密码只重包这 32 字节）
 *   ECDH P-256 公钥 ──明文────────────────▶  pubKey      ← 存账号
 *
 *   随机 DEK(32B) ──AES-256-GCM──▶  凭据密文            ← entries[name].ct
 *   DEK ──ECDH-ES(公钥, 临时密钥对 + HKDF)──▶ dekEnc    ← 存账号
 *
 * 服务端能看到的只有：盐、公钥、两段密文。没有密码 ⟹ 解不出私钥 ⟹ 解不出 DEK ⟹ 解不出凭据。
 *
 * 纯逻辑层：不碰 DOM / localStorage / fetch，浏览器与 node 都能跑（node 18+ 自带 webcrypto）。
 */

export const VAULT_V = 1;
export const KDF_ALGO = 'PBKDF2-SHA256';
export const KDF_ITER = 310000;             // OWASP 2023 对 PBKDF2-SHA256 的建议下限
const HKDF_INFO = 'thlyrics-vault-v1';

const subtle = () => {
  const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
  if (!c || !c.subtle) throw new Error('这个环境不支持加密');
  return c.subtle;
};
const enc = new TextEncoder();
const dec = new TextDecoder();

// ── base64（不用 btoa / Buffer，云端与浏览器同一套实现） ──
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function b64(bytes) {
  const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < a.length; i += 3) {
    const n = (a[i] << 16) | ((a[i + 1] || 0) << 8) | (a[i + 2] || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
      + (i + 1 < a.length ? B64[(n >> 6) & 63] : '=')
      + (i + 2 < a.length ? B64[n & 63] : '=');
  }
  return out;
}
export function unb64(s) {
  const t = String(s || '').replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor(t.length * 3 / 4));
  let o = 0;
  for (let i = 0; i < t.length; i += 4) {
    const n = (B64.indexOf(t[i]) << 18) | (B64.indexOf(t[i + 1]) << 12)
      | ((B64.indexOf(t[i + 2]) & 63) << 6) | (B64.indexOf(t[i + 3]) & 63);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < t.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < t.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}
export function randomBytes(n) {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}

// ── 第一层：密码 → KEK ──
export async function deriveKek(pass, salt, iter = KDF_ITER) {
  const base = await subtle().importKey('raw', enc.encode(String(pass)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: salt instanceof Uint8Array ? salt : unb64(salt), iterations: iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// ── 第二层：ECDH 密钥对 ──
export async function newKeyPair() {
  const kp = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pubKey = b64(new Uint8Array(await subtle().exportKey('spki', kp.publicKey)));
  return { pubKey, privKey: kp.privateKey };
}
export async function importPrivate(pkcs8B64) {
  // extractable=true：改密码时要重新导出再包一次（私钥只活在内存里，不落盘）
  return subtle().importKey('pkcs8', unb64(pkcs8B64), { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
}
export async function importPublic(spkiB64) {
  return subtle().importKey('spki', unb64(spkiB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

/** 用私钥包起来存账号（用密码派生的 KEK 加密） */
export async function wrapPrivate(privKey, pass) {
  const raw = b64(new Uint8Array(await subtle().exportKey('pkcs8', privKey)));
  const salt = randomBytes(16), iv = randomBytes(12);
  const kek = await deriveKek(pass, salt);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, kek, enc.encode(raw));
  return { iv: b64(iv), ct: b64(new Uint8Array(ct)), salt: b64(salt), iter: KDF_ITER };
}
/** 用密码解开私钥；密码不对直接抛错 */
export async function unwrapPrivate(privKeyEnc, pass) {
  const kek = await deriveKek(pass, privKeyEnc.salt, privKeyEnc.iter || KDF_ITER);
  const raw = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(privKeyEnc.iv) }, kek, unb64(privKeyEnc.ct));
  return importPrivate(dec.decode(new Uint8Array(raw)));
}

// ── 第三层：数据密钥（DEK）用接收方公钥包（ECDH-ES + HKDF） ──
async function aesFromShared(sharedBits, salt) {
  const hk = await subtle().importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(HKDF_INFO) },
    hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function sealDek(pubKeyB64, dek) {
  const eph = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const peer = await importPublic(pubKeyB64);
  const shared = await subtle().deriveBits({ name: 'ECDH', public: peer }, eph.privateKey, 256);
  const salt = randomBytes(16), iv = randomBytes(12);
  const aes = await aesFromShared(shared, salt);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, aes, dek);
  const epk = b64(new Uint8Array(await subtle().exportKey('spki', eph.publicKey)));
  return { epk, iv: b64(iv), ct: b64(new Uint8Array(ct)), salt: b64(salt) };
}
async function openDek(privKey, dekEnc) {
  const peer = await importPublic(dekEnc.epk);
  const shared = await subtle().deriveBits({ name: 'ECDH', public: peer }, privKey, 256);
  const aes = await aesFromShared(shared, unb64(dekEnc.salt));
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(dekEnc.iv) }, aes, unb64(dekEnc.ct)));
}

// ── 对外：整条链 ──
/** 用密码包一条明文，返回可直接写进 vault.entries[name] 的结构 */
export async function sealEntry(pubKeyB64, plainText, device = '') {
  const dek = randomBytes(32), iv = randomBytes(12);
  const aes = await subtle().importKey('raw', dek, 'AES-GCM', false, ['encrypt']);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, aes, enc.encode(String(plainText)));
  return {
    iv: b64(iv), ct: b64(new Uint8Array(ct)),
    dekEnc: await sealDek(pubKeyB64, dek),
    updatedAt: new Date().toISOString(),
    device: String(device || '').slice(0, 60),
  };
}
/** 解出一条明文 */
export async function openEntry(privKey, entry) {
  const dek = await openDek(privKey, entry.dekEnc);
  const aes = await subtle().importKey('raw', dek, 'AES-GCM', false, ['decrypt']);
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(entry.iv) }, aes, unb64(entry.ct));
  return dec.decode(new Uint8Array(pt));
}

/** 新建保险箱：生成密钥对 + 用密码包私钥。entries 为空 */
export async function createVault(pass) {
  const kp = await newKeyPair();
  const enc0 = await wrapPrivate(kp.privKey, pass);
  return {
    v: VAULT_V,
    kdf: { algo: KDF_ALGO, iter: KDF_ITER, salt: enc0.salt },
    pubKey: kp.pubKey,
    privKeyEnc: enc0,
    entries: {},
    locked: false,
    updatedAt: new Date().toISOString(),
  };
}

/** 打开保险箱：密码 → 私钥（调用方在内存里留着，用来解/加条目） */
export async function openVault(vault, pass) {
  if (!vault || vault.v !== VAULT_V) throw new Error('保险箱为空');
  if (vault.locked) throw new Error('保险箱已锁定');
  const privKey = await unwrapPrivate(vault.privKeyEnc, pass);
  return { pubKey: vault.pubKey, privKey };
}

/** 改密码：只重包私钥（数据密文不动） */
export async function rewrapVault(vault, session, newPass) {
  const privKeyEnc = await wrapPrivate(session.privKey, newPass);
  return Object.assign({}, vault, {
    kdf: { algo: KDF_ALGO, iter: KDF_ITER, salt: privKeyEnc.salt },
    privKeyEnc,
    locked: false,
    updatedAt: new Date().toISOString(),
  });
}

/** 加/换一条（返回新的 vault 对象，不原地改） */
export async function putEntry(vault, session, name, plainText, device = '') {
  const entry = await sealEntry(session.pubKey, plainText, device);
  const entries = Object.assign({}, vault.entries, { [name]: entry });
  return Object.assign({}, vault, { entries, updatedAt: new Date().toISOString() });
}
/** 去掉一条 */
export function dropEntry(vault, name) {
  const entries = Object.assign({}, vault.entries);
  delete entries[name];
  return Object.assign({}, vault, { entries, updatedAt: new Date().toISOString() });
}
/** 取一条明文（没有就返回 ''） */
export async function getEntry(vault, session, name) {
  const e = vault && vault.entries && vault.entries[name];
  if (!e) return '';
  return openEntry(session.privKey, e);
}
