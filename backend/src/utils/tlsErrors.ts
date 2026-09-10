export function isTlsCertError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const code =
    e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
  return (
    /certificate|self[- ]signed|UNABLE_TO_VERIFY|DEPTH_ZERO|CERT_|ERR_TLS/i.test(msg) ||
    /CERT_|UNABLE_TO_VERIFY/.test(code)
  );
}
