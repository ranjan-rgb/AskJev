import { timingSafeEqual, randomBytes } from "node:crypto";

/** Constant-time hex token compare. Returns false if lengths differ. */
export function tokensEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) {
    // Still do a compare to reduce timing signal on length-only paths.
    timingSafeEqual(ba.length ? ba : Buffer.alloc(1), ba.length ? ba : Buffer.alloc(1));
    return false;
  }
  return timingSafeEqual(ba, bb);
}

/** Generate a pairing token: 32+ random bytes as hex (≥64 chars). */
export function generateToken(bytes = 32): string {
  if (bytes < 32) bytes = 32;
  return randomBytes(bytes).toString("hex");
}

export function extractToken(msg: unknown): string | undefined {
  if (!msg || typeof msg !== "object") return undefined;
  const t = (msg as { token?: unknown }).token;
  return typeof t === "string" ? t : undefined;
}
