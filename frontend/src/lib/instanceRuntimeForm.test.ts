import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultHealthPath, emptyRuntimeForm, instanceWriteBody, resolveHealthPath } from "./instanceRuntimeForm.ts";

describe("instanceWriteBody", () => {
  it("emits OpenClaw identity and healthz", () => {
    const body = instanceWriteBody({
      ...emptyRuntimeForm(),
      displayName: "Alpha",
      runtime: "openclaw",
      host: "127.0.0.1",
    });
    const identity = body.identity as Record<string, unknown>;
    assert.equal(identity.runtime, "openclaw");
    assert.equal(identity.health_path, "/healthz");
    assert.equal(identity.display_name, "Alpha");
  });

  it("builds Hermes urls from host and ports", () => {
    const body = instanceWriteBody({
      ...emptyRuntimeForm(),
      runtime: "hermes",
      displayName: "Beta",
      host: "10.0.0.2",
      apiPort: 8642,
      httpsPort: 9642,
      gatewayToken: "secret",
    });
    const urls = body.urls as Record<string, string>;
    assert.equal(urls.api_base, "http://10.0.0.2:8642");
    assert.equal(urls.health, "http://10.0.0.2:8642/health");
    assert.equal(body.gateway_token, "secret");
  });

  it("normalizes OpenAI-like api_base", () => {
    const body = instanceWriteBody({
      ...emptyRuntimeForm(),
      runtime: "openai-like",
      displayName: "Direct",
      apiBase: "https://api.openai.com",
      defaultModel: "gpt-4o-mini",
    });
    const urls = body.urls as Record<string, string>;
    const identity = body.identity as Record<string, unknown>;
    assert.equal(urls.api_base, "https://api.openai.com/v1");
    assert.equal(identity.default_model, "gpt-4o-mini");
    assert.equal(identity.health_path, "/v1/models");
  });
});

describe("defaultHealthPath", () => {
  it("matches each runtime probe", () => {
    assert.equal(defaultHealthPath("openclaw"), "/healthz");
    assert.equal(defaultHealthPath("hermes"), "/health");
    assert.equal(defaultHealthPath("openai-like"), "/v1/models");
  });

  it("replaces leftover stock paths when the runtime changes", () => {
    assert.equal(resolveHealthPath("openai-like", "/healthz"), "/v1/models");
    assert.equal(resolveHealthPath("openai-like", "/health"), "/v1/models");
    assert.equal(resolveHealthPath("openai-like", "/ready"), "/ready");
  });
});
