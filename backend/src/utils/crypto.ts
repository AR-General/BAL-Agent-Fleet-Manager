import crypto from "crypto";
import { config } from "../config.js";

function requireKey(): Buffer {
  const hex = config.chatEncryptionKey.trim();
  if (!hex || hex.length < 64) {
    throw new Error("CHAT_ENCRYPTION_KEY must be 32-byte hex (64 chars)");
  }
  return Buffer.from(hex.slice(0, 64), "hex");
}

export function encryptText(plaintext: string): { encrypted: Buffer; iv: Buffer } {
  const key = requireKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { encrypted: Buffer.concat([enc, tag]), iv };
}

export function decryptText(encrypted: Buffer, iv: Buffer): string {
  const key = requireKey();
  const tag = encrypted.subarray(encrypted.length - 16);
  const data = encrypted.subarray(0, encrypted.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function contentSearchHash(normalized: string): string {
  const key = requireKey();
  return crypto.createHmac("sha256", key).update(normalized).digest("hex");
}

export function hashRefreshToken(token: string): string {
  return crypto
    .createHmac("sha256", config.refreshTokenPepper)
    .update(token)
    .digest("hex");
}

export function generateInstanceToken(): { raw: string; prefix: string } {
  const body = crypto.randomBytes(24).toString("hex");
  const raw = `oc_inst_${body}`;
  return { raw, prefix: raw.slice(0, 12) };
}
