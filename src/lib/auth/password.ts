import "server-only";
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing with scrypt (memory-hard, built into Node, no native dependency).
 * Stored format: `scrypt$N$r$p$saltB64$hashB64`, so parameters can be raised later and old
 * hashes keep verifying.
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

function scryptOptions(N: number, r: number, p: number): ScryptOptions {
  return { N, r, p, maxmem: 256 * N * r };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, scryptOptions(PARAMS.N, PARAMS.r, PARAMS.p));
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await derive(password, Buffer.from(saltB64, "base64"), scryptOptions(Number(n), Number(r), Number(p)));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

let dummyHash: Promise<string> | undefined;

/** Burn the same time as a real verification when the account does not exist (timing parity). */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword("timing-parity-placeholder");
  await verifyPassword(password, await dummyHash);
}
