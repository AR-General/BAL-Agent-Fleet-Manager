import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  flattenHermesModelOptions,
  formatStoredModelId,
  isAgentAliasModel,
  parseCompletionModelRef,
  resolveModelQuery,
} from "./instanceModels.js";
import { parseSlashCommand } from "./slashCommands.js";

describe("isAgentAliasModel", () => {
  it("treats profile names and OpenAI-compat aliases as non-LLM ids", () => {
    assert.equal(isAgentAliasModel("alpha", "alpha"), true);
    assert.equal(isAgentAliasModel("default"), true);
    assert.equal(isAgentAliasModel("hermes-agent"), true);
    assert.equal(isAgentAliasModel("openclaw/alpha", "alpha"), true);
    assert.equal(isAgentAliasModel("openai/gpt-4o-mini", "alpha"), false);
  });
});

describe("flattenHermesModelOptions", () => {
  it("flattens provider catalog and skips the agent alias", () => {
    const { models, default_model } = flattenHermesModelOptions(
      {
        provider: "openrouter",
        model: "openai/gpt-4o-mini",
        providers: [
          { slug: "openrouter", models: ["openai/gpt-4o-mini", "anthropic/claude-sonnet-4", "alpha"] },
          { slug: "nous", models: [{ id: "hermes-agent" }, { id: "nous/hermes-3" }] },
        ],
      },
      "alpha",
    );
    assert.deepEqual(
      models.map((m) => m.id),
      [
        "openrouter:openai/gpt-4o-mini",
        "openrouter:anthropic/claude-sonnet-4",
        "nous:nous/hermes-3",
      ],
    );
    assert.equal(default_model, "openrouter:openai/gpt-4o-mini");
  });

  it("accepts keyed providers and nested current", () => {
    const { models, default_model } = flattenHermesModelOptions({
      current: { provider: "openrouter", model: "x-ai/grok-4.6" },
      providers: {
        openrouter: { models: [{ id: "x-ai/grok-4.6" }, { id: "anthropic/claude-sonnet-5" }] },
      },
    });
    assert.equal(default_model, "openrouter:x-ai/grok-4.6");
    assert.deepEqual(
      models.map((m) => m.label),
      ["x-ai/grok-4.6", "anthropic/claude-sonnet-5"],
    );
  });
});

describe("parseCompletionModelRef", () => {
  it("splits provider:model and ignores agent aliases", () => {
    assert.deepEqual(parseCompletionModelRef("openrouter:openai/gpt-4o-mini"), {
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
      isAgentAlias: false,
    });
    assert.equal(parseCompletionModelRef("alpha", "alpha").isAgentAlias, true);
    assert.equal(parseCompletionModelRef("openai/gpt-4o-mini").model, "openai/gpt-4o-mini");
  });
});

describe("resolveModelQuery", () => {
  const models = [
    { id: "openrouter:openai/gpt-4o-mini", owned_by: "openrouter", label: "openai/gpt-4o-mini" },
    { id: "openrouter:anthropic/claude-sonnet-4", owned_by: "openrouter", label: "anthropic/claude-sonnet-4" },
    { id: "openrouter:x-ai/grok-4", owned_by: "openrouter", label: "x-ai/grok-4" },
  ];
  it("matches short names like sonnet and grok", () => {
    assert.equal(resolveModelQuery("sonnet", models)?.label, "anthropic/claude-sonnet-4");
    assert.equal(resolveModelQuery("grok", models)?.label, "x-ai/grok-4");
    assert.equal(formatStoredModelId("openai/gpt-4o-mini", "openrouter"), "openrouter:openai/gpt-4o-mini");
  });
});

describe("parseSlashCommand", () => {
  it("parses /status and /model with optional mentions", () => {
    assert.deepEqual(parseSlashCommand("/status"), { name: "status", args: "", mentionSlugs: [] });
    assert.deepEqual(parseSlashCommand("/model grok-4"), {
      name: "model",
      args: "grok-4",
      mentionSlugs: [],
    });
    assert.equal(parseSlashCommand("@alpha /model sonnet")?.name, "model");
    assert.deepEqual(parseSlashCommand("@alpha /model sonnet")?.mentionSlugs, ["alpha"]);
    assert.equal(parseSlashCommand("please /status"), null);
    assert.equal(parseSlashCommand("what is /status doing"), null);
  });
});
