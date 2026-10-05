/**
 * Hashe (maile, kody, numery czatów) i szyfrowanie kluczy API użytkowników.
 * Klucz szyfrujemy AES-GCM sekretem Workera, a numer czatu wchodzi jako dane powiązane:
 * zaszyfrowanego klucza nie da się przenieść do innej rozmowy.
 */

const encoder = new TextEncoder();

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hash z sekretnym dodatkiem: bez HASH_PEPPER nie da się sprawdzić, czy dany mail jest w bazie. */
export function peppered(value: string, env: Env) {
  return sha256(`${value}:${env.HASH_PEPPER || "otto-dev"}`);
}

async function aesKey(secret: string) {
  const raw = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(plain: string, secret: string, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    await aesKey(secret),
    encoder.encode(plain),
  );
  return `${toBase64(iv)}.${toBase64(new Uint8Array(cipher))}`;
}

export async function unseal(sealed: string, secret: string, context: string) {
  const [iv, cipher] = sealed.split(".").map(fromBase64);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    await aesKey(secret),
    cipher,
  );
  return new TextDecoder().decode(plain);
}

export function sixDigits() {
  const [n] = crypto.getRandomValues(new Uint32Array(1));
  return String(n % 1_000_000).padStart(6, "0");
}

export function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
