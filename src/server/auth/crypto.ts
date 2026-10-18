import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

// Argon2id, OWASP-recommended parameters (19 MiB, 2 passes).
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, ARGON);

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

// A real hash to verify against when the email doesn't exist, so login takes the same time either way.
let dummyHash: Promise<string> | undefined;
export const dummyPasswordHash = () => (dummyHash ??= hashPassword("not-a-real-password-" + randomBytes(8).toString("hex")));

export const newToken = () => randomBytes(32).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const newResetCode = () => randomInt(0, 1_000_000).toString().padStart(6, "0");

export function hashResetCode(code: string, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: createHmac("sha256", salt).update(code).digest("hex") };
}

export function verifyResetCode(code: string, salt: string, stored: string): boolean {
  const a = Buffer.from(hashResetCode(code, salt).hash, "hex");
  const b = Buffer.from(stored, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
