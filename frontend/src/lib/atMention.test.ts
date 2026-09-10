import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyMentionInsertion,
  filterMentionSuggestions,
  getAtMentionQuery,
} from "./atMention.ts";

describe("getAtMentionQuery", () => {
  it("triggers at start and after whitespace", () => {
    assert.deepEqual(getAtMentionQuery("@", 1), { start: 0, query: "" });
    assert.deepEqual(getAtMentionQuery("@al", 3), { start: 0, query: "al" });
    assert.deepEqual(getAtMentionQuery("hi @al", 6), { start: 3, query: "al" });
    assert.deepEqual(getAtMentionQuery("(@alice", 7), { start: 1, query: "alice" });
  });

  it("does not trigger inside emails", () => {
    assert.equal(getAtMentionQuery("alex@", 5), null);
    assert.equal(getAtMentionQuery("alex@exa", 8), null);
    assert.equal(getAtMentionQuery("mail alex@ex.com more", 16), null);
    assert.equal(getAtMentionQuery("a.b@", 4), null);
  });

  it("respects caret position", () => {
    assert.equal(getAtMentionQuery("hi @alice there", 3), null);
    assert.deepEqual(getAtMentionQuery("hi @alice there", 9), { start: 3, query: "alice" });
  });
});

describe("filterMentionSuggestions", () => {
  it("filters and prefers prefix matches", () => {
    assert.deepEqual(filterMentionSuggestions(["alice", "echo", "alicia"], "ali"), [
      "alice",
      "alicia",
    ]);
  });

  it("lists @all and @room first for empty queries", () => {
    assert.deepEqual(filterMentionSuggestions(["alpha", "beta"], ""), [
      "all",
      "room",
      "alpha",
      "beta",
    ]);
  });
});

describe("applyMentionInsertion", () => {
  it("replaces the @query span", () => {
    assert.deepEqual(applyMentionInsertion("hi @al", 6, 3, "alice"), {
      text: "hi @alice ",
      caret: 10,
    });
  });
});
