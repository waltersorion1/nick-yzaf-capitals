import {
  randomBytes,
  scrypt as derive,
  timingSafeEqual,
  createHash,
} from "node:crypto";
// Versioned parameters: N=2^14, r=8, p=5. Memory limit allows Node's overhead.
const options = { N: 16384, r: 8, p: 5, maxmem: 64 * 1024 * 1024 };
function deriveKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    derive(password, salt, 64, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await deriveKey(password, salt);
  return `scrypt-v1:${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [version, salt, hex] = encoded.split(":");
  if (
    version !== "scrypt-v1" ||
    !/^[a-f0-9]{32}$/.test(salt ?? "") ||
    !/^[a-f0-9]{128}$/.test(hex ?? "")
  )
    return false;
  const actual = await deriveKey(password, salt);
  return timingSafeEqual(actual, Buffer.from(hex, "hex"));
}
export const tokenHash = (token: string): string =>
  createHash("sha256").update(token).digest("hex");
