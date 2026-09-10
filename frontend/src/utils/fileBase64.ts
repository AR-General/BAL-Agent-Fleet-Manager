/** Encode a File/ArrayBuffer as base64 without blowing the call stack on large images. */
export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  return arrayBufferToBase64(buf);
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
