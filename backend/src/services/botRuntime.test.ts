import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyBotRuntime,
  shouldRequestStreamUsage,
  usesOpenAiCompatChat,
} from "./botRuntime.js";

describe("classifyBotRuntime", () => {
  it("maps known runtimes", () => {
    assert.equal(classifyBotRuntime("hermes"), "hermes");
    assert.equal(classifyBotRuntime("hermes-agent"), "hermes");
    assert.equal(classifyBotRuntime("openclaw"), "openclaw");
    assert.equal(classifyBotRuntime(""), "openclaw");
    assert.equal(classifyBotRuntime("openai"), "openai-like");
    assert.equal(classifyBotRuntime("openai_like"), "openai-like");
    assert.equal(classifyBotRuntime("openai like"), "openai-like");
  });

  it("treats OpenAI-compat runtimes as chat-capable", () => {
    assert.equal(usesOpenAiCompatChat("hermes"), true);
    assert.equal(usesOpenAiCompatChat("openclaw"), true);
    assert.equal(usesOpenAiCompatChat("openai"), true);
  });

  it("skips stream_options for OpenClaw gateway", () => {
    assert.equal(shouldRequestStreamUsage("hermes"), true);
    assert.equal(shouldRequestStreamUsage("openai-like"), true);
    assert.equal(shouldRequestStreamUsage("openclaw"), false);
  });
});
