import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHARACTER_SPEAK_TOOL_NAME,
  CHARACTER_SPEAK_TOOL_SCHEMA,
  characterSpeakToolSchema,
  formatCharacterSpeakPrompt,
  parseCharacterSpeakArgs,
} from "./characterSpeakTool.js";
import { processCharacterSpeakRound } from "./characterSpeakRound.js";

describe("characterSpeakTool", () => {
  it("exports an OpenAI-style function schema named character_speak", () => {
    assert.equal(CHARACTER_SPEAK_TOOL_SCHEMA.type, "function");
    assert.equal(CHARACTER_SPEAK_TOOL_SCHEMA.function.name, CHARACTER_SPEAK_TOOL_NAME);
    assert.deepEqual(CHARACTER_SPEAK_TOOL_SCHEMA.function.parameters.required, ["text"]);
  });

  it("parses valid speak args and rejects empty/invalid JSON", () => {
    assert.deepEqual(parseCharacterSpeakArgs('{"text":"  Hi [wave]  "}'), {
      ok: true,
      text: "Hi [wave]",
    });
    assert.equal(parseCharacterSpeakArgs("{").ok, false);
    assert.equal(parseCharacterSpeakArgs('{"text":""}').ok, false);
    assert.equal(parseCharacterSpeakArgs('{"text":12}').ok, false);
  });

  it("includes speak guidance in the compact prompt", () => {
    const prompt = formatCharacterSpeakPrompt();
    assert.match(prompt, /character_speak/);
    assert.match(prompt, /printed assistant body is NEVER spoken/i);
    assert.match(prompt, /\[wave\]/);
  });

  it("lists current room members on the per-generation schema", () => {
    const schema = characterSpeakToolSchema({
      selfSlug: "alpha",
      peerSlugs: ["alpha", "beta", "delta"],
    });
    assert.equal(schema.function.name, CHARACTER_SPEAK_TOOL_NAME);
    assert.match(schema.function.description, /@alpha/);
    assert.match(schema.function.description, /@beta/);
    assert.match(schema.function.description, /@delta/);
    assert.match(schema.function.description, /only speaks your avatar/);
  });
});

describe("processCharacterSpeakRound", () => {
  it("emits speak events and builds assistant+tool continuation messages", () => {
    const result = processCharacterSpeakRound({
      toolCalls: [
        {
          id: "call_1",
          name: "character_speak",
          arguments: JSON.stringify({ text: "[nod] On it." }),
        },
      ],
      roundContent: "",
    });
    assert.equal(result.shouldContinue, true);
    assert.deepEqual(result.speakEvents, [{ tool_call_id: "call_1", text: "[nod] On it." }]);
    assert.equal(result.continuationMessages.length, 2);
    assert.equal(result.continuationMessages[0]?.role, "assistant");
    assert.equal(result.continuationMessages[0]?.tool_calls?.[0]?.id, "call_1");
    assert.equal(result.continuationMessages[1]?.role, "tool");
    assert.equal(result.continuationMessages[1]?.tool_call_id, "call_1");
    assert.equal(result.continuationMessages[1]?.content, JSON.stringify({ ok: true }));
    assert.equal(result.parseErrors, 0);
  });

  it("acks parse failures so the tool protocol stays valid", () => {
    const result = processCharacterSpeakRound({
      toolCalls: [
        { id: "bad", name: "character_speak", arguments: "{not-json" },
      ],
      roundContent: "thinking…",
    });
    assert.equal(result.shouldContinue, true);
    assert.equal(result.speakEvents.length, 0);
    assert.equal(result.parseErrors, 1);
    assert.match(result.continuationMessages[1]?.content || "", /"ok":false/);
  });

  it("does not continue when there are no character_speak calls", () => {
    const result = processCharacterSpeakRound({
      toolCalls: [{ id: "x", name: "other_tool", arguments: "{}" }],
      roundContent: "done",
    });
    assert.equal(result.shouldContinue, false);
    assert.equal(result.continuationMessages.length, 0);
  });
});
