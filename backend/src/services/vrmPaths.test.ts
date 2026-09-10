import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSafeRelativePath,
  displayNameFromFilename,
  isGltfBinary,
  libraryVrmRef,
  parseLibraryVrmId,
  sanitizeUploadFilename,
} from "./vrmPaths.js";

describe("vrmPaths", () => {
  it("rejects path traversal", () => {
    assert.throws(() => assertSafeRelativePath("../secret.vrm"));
    assert.throws(() => assertSafeRelativePath("foo/../../etc/passwd"));
    assert.equal(assertSafeRelativePath("heroes/alpha.vrm"), "heroes/alpha.vrm");
  });

  it("requires a .vrm filename for uploads", () => {
    assert.equal(sanitizeUploadFilename("/tmp/Hero.vrm"), "Hero.vrm");
    assert.throws(() => sanitizeUploadFilename("note.txt"));
  });

  it("titles names from filenames", () => {
    assert.equal(displayNameFromFilename("blue-or-green.vrm"), "Blue Or Green");
  });

  it("detects glTF binary magic", () => {
    const buf = Buffer.concat([Buffer.from("glTF"), Buffer.alloc(8)]);
    assert.equal(isGltfBinary(buf), true);
    assert.equal(isGltfBinary(Buffer.from("PK\u0003\u0004")), false);
  });

  it("parses library refs and file URLs", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    assert.equal(parseLibraryVrmId(libraryVrmRef(id)), id);
    assert.equal(parseLibraryVrmId(`/api/v1/vrm-models/${id}/file`), id);
    assert.equal(parseLibraryVrmId("/dev-vrm-assets/vrm/sample.vrm"), null);
  });
});
