import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasSpeakableContent, sanitizeTtsText } from "./ttsSanitize.ts";

describe("sanitizeTtsText", () => {
  it("unwraps markdown bold and italic", () => {
    assert.equal(sanitizeTtsText("Say **hello** to *world*.").text, "Say hello to world.");
    assert.equal(sanitizeTtsText("Say __hello__ to _world_.").text, "Say hello to world.");
  });

  it("drops stage directions wrapped in asterisks", () => {
    assert.equal(sanitizeTtsText("Hello *waves* there.").text, "Hello there.");
    assert.equal(sanitizeTtsText("*smiles* Okay.").text, "Okay.");
  });

  it("strips leftover asterisk markers", () => {
    assert.equal(sanitizeTtsText("Look * here").text, "Look here");
  });

  it("keeps Fish emotion tags and free-form phrases", () => {
    assert.equal(
      sanitizeTtsText("[happy] Hello [soft tone] there.").text,
      "[happy] Hello [soft tone] there.",
    );
    assert.equal(sanitizeTtsText("[warm and happy] Hi.").text, "[warm and happy] Hi.");
  });

  it("strips dangerous free-form brackets that Fish turns into noise", () => {
    assert.equal(
      sanitizeTtsText("Hello [laughing hard with breathy heh heh heh sounds].").text,
      "Hello.",
    );
    assert.equal(sanitizeTtsText("Hi [soft laugh] there.").text, "Hi there.");
  });

  it("strips leftover non-Fish brackets like [grin]", () => {
    assert.equal(sanitizeTtsText("Hello [grin] there.").text, "Hello there.");
  });

  it("reports when text has no speakable words", () => {
    assert.equal(hasSpeakableContent("[laughing]"), false);
    assert.equal(hasSpeakableContent("***"), false);
    assert.equal(hasSpeakableContent("[happy] Hello"), true);
  });

  it("strips zero-width and control characters", () => {
    assert.equal(sanitizeTtsText("Hel\u200Blo\u0000.").text, "Hello.");
  });

  it("maps offsets through removals", () => {
    const { text, mapOffset } = sanitizeTtsText("Hi [grin] there.");
    assert.equal(text, "Hi there.");
    // 't' of there was after "[grin] "
    const grinStart = "Hi ".length;
    assert.ok(mapOffset(grinStart) <= text.indexOf("there"));
    assert.equal(text[mapOffset("Hi [grin] ".length)], "t");
  });
});
