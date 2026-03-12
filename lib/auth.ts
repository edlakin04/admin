import { createHmac } from "crypto";

const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

export function verifySessionValue(value: string, password: string): boolean {
  const [ts, hash] = (value ?? "").split(":");
  if (!ts || !hash) return false;

  // Check expiry
  const age = Date.now() - parseInt(ts, 10);
  if (age > SESSION_MAX_AGE_MS) return false;

  // Re-compute and compare — timing-safe
  const expected = createHmac("sha256", password).update(ts).digest("hex");
  if (expected.length !== hash.length) return false;

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  return diff === 0;
}
