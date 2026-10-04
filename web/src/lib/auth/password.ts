import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// scrypt natif (N=2^15, r=8, p=1). Format stocké : scrypt$N$r$p$sel$hash, en base64url.

const N = 32_768;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
export const MIN_PASSWORD_LENGTH = 12;

function derive(password: string, salt: Buffer, n: number, r: number, p: number, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, length, { N: n, r, p, maxmem: 256 * n * r }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P, KEY_LENGTH);
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await derive(password, Buffer.from(salt, "base64url"), Number(n), Number(r), Number(p), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Vérifié quand l'adresse est inconnue, pour que la durée de réponse ne révèle pas son existence.
let dummy: Promise<string> | undefined;
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummy ??= hashPassword("mot-de-passe-factice-jamais-valide");
  await verifyPassword(password, await dummy);
  return false;
}
