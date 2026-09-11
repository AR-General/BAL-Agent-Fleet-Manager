import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  modelDisplayName,
  modelProviderPrefix,
  resolveModelProvider,
  stripGatewayPrefix,
} from "./llmModelProvider.ts";

describe("llmModelProvider", () => {
  it("strips gateway and reads author/name", () => {
    assert.equal(stripGatewayPrefix("openrouter:deepseek/deepseek-v4-pro"), "deepseek/deepseek-v4-pro");
    assert.equal(modelProviderPrefix("openrouter:deepseek/deepseek-v4-pro"), "deepseek");
    assert.equal(modelDisplayName("openrouter:deepseek/deepseek-v4-pro"), "deepseek-v4-pro");
  });

  it("resolves known deepseek icon metadata", () => {
    const p = resolveModelProvider("deepseek/deepseek-chat");
    assert.equal(p.prefix, "deepseek");
    assert.equal(p.label, "DeepSeek");
    assert.ok(p.iconUrl);
  });

  it("uses generic author chip for unknown prefixes", () => {
    const p = resolveModelProvider("acme-labs/widget-9");
    assert.equal(p.prefix, "acme-labs");
    assert.equal(p.label, "acme-labs");
    assert.ok(p.color);
  });
});
