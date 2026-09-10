import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attachFallbackUrls,
  buildHermesInstanceUrls,
  buildOpenAiLikeUrls,
  HTTP_PLAINTEXT_WARNING,
  isRetryableNetworkError,
  resolveApiBaseCandidates,
  resolveHealthUrlCandidates,
  rewriteUrlHost,
  summarizeInstanceEndpoints,
  urlScheme,
} from "./instanceEndpoints.js";

describe("instanceEndpoints", () => {
  it("classifies TLS vs plaintext HTTP", () => {
    assert.equal(urlScheme("https://127.0.0.1:9642"), "https");
    assert.equal(urlScheme("http://127.0.0.1:8642"), "http");
    assert.equal(urlScheme("ssh://x"), "other");
  });

  it("rewrites host while keeping port and path", () => {
    assert.equal(
      rewriteUrlHost("http://127.0.0.1:8642/health", "10.0.0.2"),
      "http://10.0.0.2:8642/health",
    );
    assert.equal(
      rewriteUrlHost("https://127.0.0.1:9642/", "10.0.0.2"),
      "https://10.0.0.2:9642/",
    );
  });

  it("builds hermes urls with primary and fallback", () => {
    const urls = buildHermesInstanceUrls({
      host: "127.0.0.1",
      fallbackHost: "10.0.0.2",
      apiPort: 8642,
      httpsPort: 9642,
    });
    assert.equal(urls.api_base, "http://127.0.0.1:8642");
    assert.equal(urls.api_base_fallback, "http://10.0.0.2:8642");
    assert.equal(urls.health_fallback, "http://10.0.0.2:8642/health");
    assert.equal(urls.control_ui, "https://127.0.0.1:9642");
    assert.equal(urls.control_ui_fallback, "https://10.0.0.2:9642");
    assert.equal(urls.host_fallback, "10.0.0.2");
  });

  it("summarizes endpoints with HTTP warning on API and TLS on control UI", () => {
    const summary = summarizeInstanceEndpoints({
      host: "127.0.0.1",
      urls: buildHermesInstanceUrls({
        host: "127.0.0.1",
        fallbackHost: "10.0.0.2",
        apiPort: 8642,
        httpsPort: 9642,
      }),
    });
    assert.equal(summary.primary?.host, "127.0.0.1:8642");
    assert.equal(summary.primary?.tls, false);
    assert.equal(summary.primary?.http_warning, HTTP_PLAINTEXT_WARNING);
    assert.equal(summary.fallback?.host, "10.0.0.2:8642");
    assert.equal(summary.control_ui?.tls, true);
    assert.equal(summary.control_ui?.http_warning, undefined);
  });

  it("resolves health candidates primary then fallback", () => {
    const urls = attachFallbackUrls(
      { health: "http://127.0.0.1:8642/health" },
      "10.0.0.2",
    );
    const c = resolveHealthUrlCandidates(urls, { runtime: "hermes" });
    assert.equal(c.length, 2);
    assert.equal(c[0].role, "primary");
    assert.equal(c[1].url, "http://10.0.0.2:8642/health");
  });

  it("resolves API bases without duplicating", () => {
    const bases = resolveApiBaseCandidates({
      urls: {
        api_base: "http://127.0.0.1:8642/v1",
        api_base_fallback: "http://10.0.0.2:8642/v1",
      },
    });
    assert.deepEqual(bases, ["http://127.0.0.1:8642", "http://10.0.0.2:8642"]);
  });

  it("treats connection failures as retryable but not auth/abort", () => {
    const conn = new Error("fetch failed");
    (conn as Error & { cause: { code: string } }).cause = { code: "ECONNREFUSED" };
    assert.equal(isRetryableNetworkError(conn), true);
    const abort = new Error("Aborted");
    abort.name = "AbortError";
    assert.equal(isRetryableNetworkError(abort), false);
  });

  it("normalizes OpenAI-like api_base and health", () => {
    const urls = buildOpenAiLikeUrls({
      apiBase: "https://api.openai.com",
      fallbackHost: "proxy.internal",
    });
    assert.equal(urls.api_base, "https://api.openai.com/v1");
    assert.equal(urls.health, "https://api.openai.com/v1/models");
    assert.equal(urls.api_base_fallback, "https://proxy.internal/v1");
  });
});
