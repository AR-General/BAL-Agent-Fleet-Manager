/** Decode base64 image payload (raw or data-URL) into a Buffer for bytea storage. */
export function decodeBase64Image(data: string): Buffer {
  const trimmed = data.trim();
  const base64 = trimmed.includes(",") ? (trimmed.split(",").pop() ?? trimmed) : trimmed;
  const cleaned = base64.replace(/\s/g, "");
  const buf = Buffer.from(cleaned, "base64");
  if (buf.length === 0) {
    throw new Error("empty image data");
  }
  return buf;
}
