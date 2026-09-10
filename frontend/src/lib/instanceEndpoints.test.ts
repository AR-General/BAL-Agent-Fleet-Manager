import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attachFallbackUrls,
  deriveInstanceEndpoints,
  HTTP_PLAINTEXT_WARNING,
  urlScheme,
} from "./instanceEndpoints.ts";

describe("instanceEndpoints", () => {
  it("warns on HTTP and annotates HTTPS as TLS", () => {
    assert.equal(urlScheme("http://127.0.0.1:8642"), "http");
    assert.equal(urlScheme("https://127.0.0.1:9642"), "https");
  });

  it("derives primary + fallback with HTTP warning", () => {
    const urls = attachFallbackUrls(
      {
        api_base: "http://127.0.0.1:8642",
        control_ui: "https://127.0.0.1:9642",
      },
      "10.0.0.2",
    );
    const e = deriveInstanceEndpoints({ host: "127.0.0.1", urls });
    assert.equal(e.primary?.host, "127.0.0.1:8642");
    assert.equal(e.primary?.http_warning, HTTP_PLAINTEXT_WARNING);
    assert.equal(e.fallback?.host, "10.0.0.2:8642");
    assert.equal(e.control_ui?.tls, true);
  });
});
