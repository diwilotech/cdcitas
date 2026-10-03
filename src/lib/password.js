// Contraseñas del personal: PBKDF2-SHA256 con salt por usuario (Web Crypto, disponible en Workers).
// Van en users.pin_hash / pin_salt (nombre histórico: antes era un PIN). Los hashes viejos
// (SHA-256 de "salt:pin", sin prefijo) se siguen aceptando para que el PIN entre una última vez
// y la persona cree su contraseña.
const ITERATIONS = 100000;
const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const randomSalt = () => crypto.randomUUID();
export const randomToken = () => toHex(crypto.getRandomValues(new Uint8Array(32)));
export const sha256Hex = async (text) => toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));

export async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(String(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: ITERATIONS }, key, 256);
  return `pbkdf2$${toHex(bits)}`;
}

export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const calc = hash.startsWith("pbkdf2$")
    ? await hashPassword(password, salt)
    : await sha256Hex(`${salt}:${password}`);
  return timingSafeEqual(calc, hash);
}

export const MIN_PASSWORD = 8;
export const validatePassword = (p) => typeof p === "string" && p.length >= MIN_PASSWORD && p.length <= 200;
