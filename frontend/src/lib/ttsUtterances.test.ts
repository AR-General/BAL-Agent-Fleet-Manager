import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bracketDepth, pullSpeakableUtterances } from "./ttsUtterances.ts";

describe("ttsUtterances", () => {
  it("holds incomplete sentences while streaming", () => {
    const { utterances, rest } = pullSpeakableUtterances("Hello there, this is");
    assert.deepEqual(utterances, []);
    assert.equal(rest, "Hello there, this is");
  });

  it("emits a sentence as soon as it completes", () => {
    const { utterances, rest } = pullSpeakableUtterances("Hello there. How are you");
    assert.deepEqual(utterances, ["Hello there."]);
    assert.equal(rest, "How are you");
  });

  it("does not split inside unclosed square tags", () => {
    assert.equal(bracketDepth("[happy"), 1);
    const held = pullSpeakableUtterances("Hello [happy");
    assert.deepEqual(held.utterances, []);
    assert.equal(held.rest, "Hello [happy");
    const closed = pullSpeakableUtterances("[happy] Hello there. Next");
    assert.deepEqual(closed.utterances, ["[happy] Hello there."]);
    assert.equal(closed.rest, "Next");
    const afterClosed = pullSpeakableUtterances("[happy] Hello there. Still [open");
    assert.deepEqual(afterClosed.utterances, ["[happy] Hello there."]);
    assert.equal(afterClosed.rest, "Still [open");
  });

  it("does not treat numbered-list dots as sentence ends", () => {
    const held = pullSpeakableUtterances("1. Hello there friend");
    assert.deepEqual(held.utterances, []);
    const { utterances, rest } = pullSpeakableUtterances("1. Hello there friend. Next");
    assert.deepEqual(utterances, ["1. Hello there friend."]);
    assert.equal(rest, "Next");
  });

  it("flushes the remainder at end of turn", () => {
    const { utterances, rest } = pullSpeakableUtterances("Not a full stop yet", { flush: true });
    assert.deepEqual(utterances, ["Not a full stop yet"]);
    assert.equal(rest, "");
  });

  it("force-splits very long runs without punctuation", () => {
    const long = `${"word ".repeat(80)}tail`;
    const { utterances, rest } = pullSpeakableUtterances(long);
    assert.ok(utterances.length >= 1);
    assert.ok(utterances[0]!.length <= 220);
    assert.ok(rest.length > 0);
  });

  it("keeps trailing Fish tags with the sentence instead of a tag-only clip", () => {
    const { utterances, rest } = pullSpeakableUtterances(
      "Let's embark on this journey and see what wonders unfold! [laughing] Next",
    );
    assert.deepEqual(utterances, [
      "Let's embark on this journey and see what wonders unfold! [laughing]",
    ]);
    assert.equal(rest, "Next");
  });

  it("also absorbs safe free-form Fish phrases after a sentence", () => {
    const { utterances, rest } = pullSpeakableUtterances("Nice day! [warm and happy] More");
    assert.deepEqual(utterances, ["Nice day! [warm and happy]"]);
    assert.equal(rest, "More");
  });
});
