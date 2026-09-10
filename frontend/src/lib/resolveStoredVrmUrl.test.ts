import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { persistableVrmUrl, resolveStoredVrmUrl } from "./resolveStoredVrmUrl.ts";
import { libraryVrmRef, parseLibraryVrmId } from "./vrmLibrary.ts";

describe("resolveStoredVrmUrl", () => {
  it("drops blob URLs from persistence", () => {
    assert.equal(persistableVrmUrl("blob:https://x/1"), "");
    assert.equal(persistableVrmUrl("/dev-vrm-assets/vrm/tori.vrm"), "/dev-vrm-assets/vrm/tori.vrm");
    assert.equal(persistableVrmUrl("idb://alpha"), "idb://alpha");
    const id = "11111111-2222-4333-8444-555555555555";
    assert.equal(persistableVrmUrl(`/api/v1/vrm-models/${id}/file`), libraryVrmRef(id));
  });

  it("prefers a saved catalog URL over a stale IndexedDB blob", () => {
    assert.equal(
      resolveStoredVrmUrl({
        storedUrl: "/dev-vrm-assets/vrm/tori.vrm",
        idbObjectUrl: "blob:https://x/old",
        fallback: "/dev-vrm-assets/vrm/sample.vrm",
      }),
      "/dev-vrm-assets/vrm/tori.vrm",
    );
  });

  it("resolves idb:// via the IndexedDB object URL", () => {
    assert.equal(
      resolveStoredVrmUrl({
        storedUrl: "idb://beta",
        idbObjectUrl: "blob:https://x/beta",
        fallback: "/dev-vrm-assets/vrm/sample.vrm",
      }),
      "blob:https://x/beta",
    );
  });

  it("resolves oc-vrm library refs via the fetched object URL", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    assert.equal(parseLibraryVrmId(libraryVrmRef(id)), id);
    assert.equal(
      resolveStoredVrmUrl({
        storedUrl: libraryVrmRef(id),
        libraryObjectUrl: "blob:https://x/lib",
        fallback: "/dev-vrm-assets/vrm/sample.vrm",
      }),
      "blob:https://x/lib",
    );
  });

  it("falls back to cache when the server has no URL yet", () => {
    assert.equal(
      resolveStoredVrmUrl({
        storedUrl: null,
        cachedUrl: "/dev-vrm-assets/vrm/curt.vrm",
        fallback: "/dev-vrm-assets/vrm/sample.vrm",
      }),
      "/dev-vrm-assets/vrm/curt.vrm",
    );
  });
});
