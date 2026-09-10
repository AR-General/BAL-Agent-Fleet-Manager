import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRuntimeRegistration } from "./instanceRuntime.js";

describe("buildRuntimeRegistration", () => {
  it("builds OpenClaw ports and healthz", () => {
    const built = buildRuntimeRegistration({
      runtime: "openclaw",
      name: "Alpha",
      host: "127.0.0.1",
      ports: { slot: 0, gateway: 18789, https: 8443, bridge: 18790, signal: 8383, twilio: 18792 },
      tls: { gateway_https: false, allow_self_signed: false },
    });
    assert.equal(built.runtime, "openclaw");
    assert.equal(built.identity.runtime, "openclaw");
    assert.equal(built.identity.health_path, "/healthz");
    assert.ok(String(built.urls.gateway_intranet).includes("18789"));
  });

  it("builds Hermes api_base and /health", () => {
    const built = buildRuntimeRegistration({
      runtime: "hermes",
      name: "Beta",
      host: "10.0.0.2",
      apiPort: 8642,
      httpsPort: 9642,
    });
    assert.equal(built.runtime, "hermes");
    assert.equal(built.identity.health_path, "/health");
    assert.equal(built.urls.api_base, "http://10.0.0.2:8642");
    assert.equal(built.urls.health, "http://10.0.0.2:8642/health");
    assert.equal(built.urls.control_ui, "https://10.0.0.2:9642");
  });

  it("requires api_base for OpenAI-like and normalizes /v1", () => {
    assert.throws(() =>
      buildRuntimeRegistration({
        runtime: "openai-like",
        name: "Direct",
        host: "api.openai.com",
      }),
    );
    const built = buildRuntimeRegistration({
      runtime: "openai-like",
      name: "Direct",
      apiBase: "https://api.openai.com",
      defaultModel: "gpt-4o-mini",
    });
    assert.equal(built.runtime, "openai-like");
    assert.equal(built.urls.api_base, "https://api.openai.com/v1");
    assert.equal(built.identity.default_model, "gpt-4o-mini");
    assert.equal(built.identity.health_path, "/v1/models");
  });
});
