import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTtsBody,
  configuredDefaultFishVoiceId,
  DEFAULT_FISH_VOICE_ID,
  FISH_LIBRARY_VOICES,
  FISH_PCM_SAMPLE_RATE,
  isFishVoiceId,
  listFishVoices,
  mergeFishVoices,
  parseFishModelItem,
  parseFishModelList,
  resetFishVoiceCache,
  resolveTtsVoiceId,
} from "./fishAudio.js";

describe("fishAudio", () => {
  it("falls back to the documented E-Girl voice", () => {
    assert.equal(configuredDefaultFishVoiceId(""), DEFAULT_FISH_VOICE_ID);
    assert.equal(configuredDefaultFishVoiceId("  "), DEFAULT_FISH_VOICE_ID);
    assert.equal(configuredDefaultFishVoiceId("abc12345"), "abc12345");
    assert.equal(resolveTtsVoiceId(null), DEFAULT_FISH_VOICE_ID);
    assert.equal(resolveTtsVoiceId(""), DEFAULT_FISH_VOICE_ID);
    assert.equal(resolveTtsVoiceId("not-a-voice"), DEFAULT_FISH_VOICE_ID);
    assert.equal(resolveTtsVoiceId("9a9cf47702da476aa4629e2506d4a857"), "9a9cf47702da476aa4629e2506d4a857");
  });

  it("accepts Fish hex model ids", () => {
    assert.equal(isFishVoiceId("ca3007f96ae7499ab87d27ea3599956a"), true);
    assert.equal(isFishVoiceId("not-a-voice"), false);
    assert.equal(isFishVoiceId("short"), false);
    assert.equal(isFishVoiceId(""), false);
  });

  it("parses Fish model list payloads", () => {
    const voices = parseFishModelList(
      {
        items: [
          { _id: "ca3007f96ae7499ab87d27ea3599956a", title: "E-Girl", languages: ["en"] },
          { id: "bad" },
          { id: "9a9cf47702da476aa4629e2506d4a857", name: "Energetic Male" },
        ],
      },
      "workspace",
    );
    assert.equal(voices.length, 2);
    assert.equal(voices[0]?.source, "workspace");
    assert.equal(voices[0]?.title, "E-Girl");
    assert.equal(parseFishModelItem(null, "library"), null);
  });

  it("dedupes workspace voices ahead of the library catalog", () => {
    const merged = mergeFishVoices([
      [{ id: DEFAULT_FISH_VOICE_ID, title: "Mine", languages: ["en"], source: "workspace" }],
      FISH_LIBRARY_VOICES,
    ]);
    assert.equal(merged[0]?.title, "Mine");
    assert.equal(merged.filter((v) => v.id === DEFAULT_FISH_VOICE_ID).length, 1);
    assert.ok(merged.some((v) => v.id === "9a9cf47702da476aa4629e2506d4a857"));
  });

  it("builds a Fish TTS body with the resolved reference_id", () => {
    const body = buildTtsBody({
      text: "hello",
      voiceId: DEFAULT_FISH_VOICE_ID,
      format: "mp3",
    });
    assert.equal(body.reference_id, DEFAULT_FISH_VOICE_ID);
    assert.equal(body.text, "hello");
    assert.equal(body.latency, "balanced");
    assert.equal(body.mp3_bitrate, 128);
  });

  it("requests PCM with an explicit sample rate for streaming playback", () => {
    const body = buildTtsBody({
      text: "hello",
      voiceId: DEFAULT_FISH_VOICE_ID,
      format: "pcm",
    });
    assert.equal(body.format, "pcm");
    assert.equal(body.sample_rate, FISH_PCM_SAMPLE_RATE);
    assert.equal(body.mp3_bitrate, undefined);
  });

  it("returns the library catalog when no API key is set", async () => {
    resetFishVoiceCache();
    const { voices } = await listFishVoices({ apiKey: "", bypassCache: true });
    assert.deepEqual(
      voices.map((v) => v.id),
      FISH_LIBRARY_VOICES.map((v) => v.id),
    );
  });
});
