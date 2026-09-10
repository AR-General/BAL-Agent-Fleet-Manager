import { decryptText, encryptText } from "./crypto.js";

/** Persist secrets in text columns as ivHex:cipherHex (AES-256-GCM). */
export function encryptSecret(plaintext: string): string {
  const { encrypted, iv } = encryptText(plaintext);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(stored: string): string {
  const sep = stored.indexOf(":");
  if (sep <= 0) throw new Error("invalid encrypted secret format");
  const iv = Buffer.from(stored.slice(0, sep), "hex");
  const encrypted = Buffer.from(stored.slice(sep + 1), "hex");
  return decryptText(encrypted, iv);
}
