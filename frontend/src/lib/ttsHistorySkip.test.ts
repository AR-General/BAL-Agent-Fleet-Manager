import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectCompletedAssistantIds,
  shouldIgnoreExistingTtsText,
  spokenCursorAtEnd,
} from "./ttsHistorySkip.ts";

describe("collectCompletedAssistantIds", () => {
  it("skips streaming and non-assistant messages", () => {
    const ids = collectCompletedAssistantIds([
      { id: "u1", role: "user", status: "done" },
      { id: "a1", role: "assistant", status: "done" },
      { id: "a2", role: "assistant", status: "streaming" },
      { id: "a3", role: "assistant" },
    ]);
    assert.deepEqual(ids, { a1: true, a3: true });
  });

  it("ignores assistants from another session", () => {
    const ids = collectCompletedAssistantIds(
      [
        { id: "a1", role: "assistant", status: "done", sessionId: "s1" },
        { id: "a2", role: "assistant", status: "done", sessionId: "s2" },
      ],
      "s1",
    );
    assert.deepEqual(ids, { a1: true });
  });
});

describe("shouldIgnoreExistingTtsText", () => {
  it("skips backlog when TTS is turned on, session changes, or a slug is re-enabled", () => {
    assert.equal(shouldIgnoreExistingTtsText({ justEnabled: true, sessionChanged: false, slugWasDisabled: false }), true);
    assert.equal(shouldIgnoreExistingTtsText({ justEnabled: false, sessionChanged: true, slugWasDisabled: false }), true);
    assert.equal(shouldIgnoreExistingTtsText({ justEnabled: false, sessionChanged: false, slugWasDisabled: true }), true);
    assert.equal(shouldIgnoreExistingTtsText({ justEnabled: false, sessionChanged: false, slugWasDisabled: false }), false);
  });
});

describe("spokenCursorAtEnd", () => {
  it("marks the current text as already spoken", () => {
    assert.deepEqual(spokenCursorAtEnd("m1", "hello there"), {
      messageId: "m1",
      spokenOffset: 11,
      lastText: "hello there",
    });
  });
});
