import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildWordTimeline,
  cueTimeForIndex,
  parseFishTimestampEvent,
} from "./ttsCueTiming.ts";

describe("ttsCueTiming", () => {
  it("parses a Fish timestamp SSE payload", () => {
    const audio = new Uint8Array([1, 2, 3, 4]);
    const b64 = Buffer.from(audio).toString("base64");
    const parsed = parseFishTimestampEvent({
      audio_base64: b64,
      content: "Hello world",
      chunk_seq: 0,
      chunk_audio_offset_sec: 0.1,
      alignment: {
        audio_duration: 0.86,
        segments: [
          { text: "Hello", start: 0, end: 0.42 },
          { text: "world", start: 0.42, end: 0.86 },
        ],
      },
    });
    assert.ok(parsed);
    assert.deepEqual([...parsed!.audio], [1, 2, 3, 4]);
    assert.equal(parsed!.chunkSeq, 0);
    assert.equal(parsed!.alignment?.segments.length, 2);
  });

  it("builds an absolute word timeline from chunk snapshots", () => {
    const map = new Map([
      [
        0,
        {
          offset: 0.1,
          alignment: {
            audio_duration: 0.5,
            segments: [{ text: "Hi", start: 0, end: 0.4 }],
          },
        },
      ],
      [
        1,
        {
          offset: 0.5,
          alignment: {
            audio_duration: 0.4,
            segments: [{ text: "there", start: 0, end: 0.3 }],
          },
        },
      ],
    ]);
    const timeline = buildWordTimeline(map);
    assert.equal(timeline.length, 2);
    assert.equal(timeline[0]!.start, 0.1);
    assert.equal(timeline[1]!.start, 0.5);
  });

  it("maps cue index to Fish segment time", () => {
    const utterance = "Hello there friend";
    const timeline = [
      { text: "Hello", start: 0, end: 0.4, chunkSeq: 0 },
      { text: "there", start: 0.4, end: 0.7, chunkSeq: 0 },
      { text: "friend", start: 0.7, end: 1.0, chunkSeq: 0 },
    ];
    const t = cueTimeForIndex({
      ttsIndex: utterance.indexOf("there"),
      utterance,
      timeline,
      scheduledDurationSec: 1,
    });
    assert.ok(t >= 0.4 && t < 0.7);
  });

  it("falls back to duration ratio without timeline", () => {
    const utterance = "abcdef";
    const t = cueTimeForIndex({
      ttsIndex: 3,
      utterance,
      timeline: [],
      scheduledDurationSec: 2,
    });
    assert.equal(t, 1);
  });
});
