import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventEmitter } from "node:events";
import { FISH_PCM_SAMPLE_RATE } from "./fishAudio.js";
import { attachClientAbort, isAbortError, ttsMime, FISH_TTS_TIMESTAMP_PATH } from "./fishTtsProxy.js";

describe("fishTtsProxy", () => {
  it("uses L16 PCM with the Fish sample rate for streaming", () => {
    assert.equal(ttsMime("pcm"), `audio/L16;rate=${FISH_PCM_SAMPLE_RATE};channels=1`);
    assert.equal(ttsMime("mp3"), "audio/mpeg");
  });

  it("recognizes AbortError", () => {
    const err = new Error("This operation was aborted");
    err.name = "AbortError";
    assert.equal(isAbortError(err), true);
    assert.equal(isAbortError(new Error("Fish TTS 402")), false);
  });

  it("aborts upstream only when the response was not finished", () => {
    const res = new EventEmitter() as EventEmitter & { writableEnded: boolean };
    res.writableEnded = false;
    const abort = new AbortController();
    const detach = attachClientAbort(res, abort);
    res.emit("close");
    assert.equal(abort.signal.aborted, true);
    detach();

    const finished = new EventEmitter() as EventEmitter & { writableEnded: boolean };
    finished.writableEnded = true;
    const abort2 = new AbortController();
    const detach2 = attachClientAbort(finished, abort2);
    finished.emit("close");
    assert.equal(abort2.signal.aborted, false);
    detach2();
  });

  it("uses the timestamp SSE path when requested", () => {
    assert.equal(FISH_TTS_TIMESTAMP_PATH, "/v1/tts/stream/with-timestamp");
  });
});
