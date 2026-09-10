import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultInlineCatalog,
  isFishAnnotation,
  parseInlineTags,
} from "../../../../dev-vrm/packages/character-kit/dist/inline-tags.js";
import { splitTrailingSceneTarget } from "../../../../dev-vrm/packages/character-kit/dist/scene-ref.js";
import {
  hasSpeakableContent,
  isFishAnnotationInner,
  sanitizeTtsText,
} from "./ttsSanitize.ts";
import { pullSpeakableUtterances } from "./ttsUtterances.ts";

/**
 * Mirrors ChatPage → Fish path:
 * parseInlineTags (VRM/Fish split) → sanitizeTtsText → utterance chunking.
 */
function prepareSpoken(
  raw: string,
  catalog = { ...defaultInlineCatalog(), expressions: ["grin"] },
) {
  const parsed = parseInlineTags(raw, catalog);
  const spoken = sanitizeTtsText(parsed.ttsText).text;
  const { utterances } = pullSpeakableUtterances(spoken, { flush: true });
  return {
    parsed,
    spoken,
    utterances: utterances.filter((u) => hasSpeakableContent(u)),
    steps: parsed.withSpeech,
  };
}

describe("splitTrailingSceneTarget vs character kv", () => {
  it("keeps mood:/gesture:/look: kv tags intact", () => {
    assert.deepEqual(splitTrailingSceneTarget("mood:playful"), { body: "mood:playful" });
    assert.deepEqual(splitTrailingSceneTarget("gesture:sad"), { body: "gesture:sad" });
    assert.deepEqual(splitTrailingSceneTarget("g:wave"), { body: "g:wave" });
    assert.deepEqual(splitTrailingSceneTarget("look:camera"), { body: "look:camera" });
    assert.deepEqual(splitTrailingSceneTarget("emotion:happy"), { body: "emotion:happy" });
  });

  it("still splits gesture:@participant scene targets", () => {
    assert.deepEqual(splitTrailingSceneTarget("wave:@beta"), {
      body: "wave",
      target: "@beta",
    });
    assert.deepEqual(splitTrailingSceneTarget("nod:player1"), {
      body: "nod",
      target: "player1",
    });
  });

  it("leaves walk:forward=1 alone (suffix has =)", () => {
    assert.deepEqual(splitTrailingSceneTarget("walk:forward=1"), {
      body: "walk:forward=1",
    });
  });
});

describe("Fish vs VRM tag classification", () => {
  it("treats bare emotion words as Fish voice tags", () => {
    assert.equal(isFishAnnotation("happy"), true);
    assert.equal(isFishAnnotation("laughing"), true);
    assert.equal(isFishAnnotation("soft tone"), true);
    assert.equal(isFishAnnotationInner("happy"), true);
    assert.equal(isFishAnnotationInner("warm and happy"), true);
  });

  it("rejects laugh-spam free-form that Fish turns into noise", () => {
    assert.equal(isFishAnnotation("soft laugh"), false);
    assert.equal(isFishAnnotation("laughing hard with breathy heh"), false);
    assert.equal(isFishAnnotationInner("soft laugh"), false);
  });

  it("does not treat scored faces or gestures as Fish", () => {
    assert.equal(isFishAnnotation("happy=40"), false);
    assert.equal(isFishAnnotation("wave"), false);
    assert.equal(isFishAnnotation("wave|angry=30"), false);
    assert.equal(isFishAnnotation("grin"), false);
  });

  it("keeps frontend sanitize fish rules in sync with character-kit", () => {
    const samples = [
      "happy",
      "soft tone",
      "warm and happy",
      "slightly sad",
      "soft laugh",
      "heh heh huh",
      "wave",
      "happy=40",
      "laughing",
    ];
    for (const s of samples) {
      assert.equal(
        isFishAnnotationInner(s),
        isFishAnnotation(s),
        `mismatch for ${JSON.stringify(s)}`,
      );
    }
  });
});

describe("LLM tag → TTS pipeline", () => {
  it("strips VRM gestures/walk/mood and keeps Fish voice tags", () => {
    const r = prepareSpoken("[wave] [happy] Hello there! [laughing]");
    assert.ok(r.steps.some((s) => s.op === "play_gesture" && s.id === "wave"));
    assert.equal(r.spoken, "[happy] Hello there! [laughing]");
    assert.deepEqual(r.utterances, ["[happy] Hello there! [laughing]"]);
  });

  it("strips scored face tags from speech but emits VRM emotion steps", () => {
    const r = prepareSpoken("Hello [happy=40] world.");
    assert.ok(r.steps.some((s) => s.op === "set_emotion" && s.emotion === "happy"));
    assert.equal(r.spoken, "Hello world.");
    assert.doesNotMatch(r.spoken, /happy/);
  });

  it("parses mood: and gesture: kv tags for VRM (not scene targets)", () => {
    const mood = prepareSpoken("[mood:playful] Hey friend!");
    assert.ok(mood.steps.some((s) => s.op === "set_mood" && s.mood === "playful"));
    assert.equal(mood.spoken, "Hey friend!");

    const gest = prepareSpoken("[gesture:sad] oh no");
    assert.ok(gest.steps.some((s) => s.op === "play_gesture" && s.id === "sad"));
    assert.equal(gest.spoken, "oh no");
  });

  it("uses [laugh] as VRM gesture and [laughing] as Fish voice", () => {
    const gesture = prepareSpoken("[laugh] that is funny");
    assert.ok(gesture.steps.some((s) => s.op === "play_gesture" && s.id === "laugh"));
    assert.equal(gesture.spoken, "that is funny");

    const fish = prepareSpoken("[laughing] that is funny");
    assert.equal(fish.steps.length, 0);
    assert.equal(fish.spoken, "[laughing] that is funny");
  });

  it("strips custom [grin] from speech when it is a VRM expression", () => {
    const r = prepareSpoken("Hello [grin] there.");
    assert.ok(r.steps.some((s) => s.op === "set_expression" && s.name === "grin"));
    assert.equal(r.spoken, "Hello there.");
  });

  it("strips markdown/stage junk before Fish", () => {
    const r = prepareSpoken("**Hello** *waves* there!");
    assert.equal(r.spoken, "Hello there!");
  });

  it("strips dangerous free-form brackets from speech", () => {
    const r = prepareSpoken("Nice. [soft laugh]");
    assert.equal(r.spoken, "Nice.");
  });

  it("keeps safe free-form Fish phrases with the sentence", () => {
    const r = prepareSpoken("Nice! [warm and happy]");
    assert.equal(r.spoken, "Nice! [warm and happy]");
    assert.deepEqual(r.utterances, ["Nice! [warm and happy]"]);
  });

  it("absorbs trailing Fish tags so they are not a solo clip", () => {
    const { utterances } = pullSpeakableUtterances(
      "Let's go! [laughing] [chuckling] More later",
    );
    assert.deepEqual(utterances, ["Let's go! [laughing] [chuckling]"]);
    assert.equal(
      pullSpeakableUtterances("Let's go! [laughing] [chuckling] More later").rest,
      "More later",
    );
  });

  it("skips tag-only / punctuation-only utterances", () => {
    assert.equal(hasSpeakableContent("[laughing]"), false);
    assert.equal(hasSpeakableContent("***"), false);
    assert.equal(hasSpeakableContent("[happy] Hello"), true);
  });

  it("handles chained gestures without leaking into TTS", () => {
    const r = prepareSpoken("[nod,wave] Hi there.");
    assert.equal(r.steps.filter((s) => s.op === "play_gesture").length, 2);
    assert.equal(r.spoken, "Hi there.");
  });

  it("strips walk tags from speech", () => {
    const r = prepareSpoken("[walk:forward=1] Coming closer.");
    assert.ok(r.steps.some((s) => s.op === "walk"));
    assert.equal(r.spoken, "Coming closer.");
  });
});
