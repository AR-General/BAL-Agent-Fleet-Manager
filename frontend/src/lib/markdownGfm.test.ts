import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

const TABLE = `| Col | Value | Status |
| --- | --- | --- |
| walk tags | compact | ok |
| spawn objects | no API | blocked |
| this table | renderer | check |`;

function visitTypes(node: { type?: string; children?: unknown[] }, types: Set<string>) {
  if (node.type) types.add(node.type);
  for (const child of node.children ?? []) {
    if (child && typeof child === "object") {
      visitTypes(child as { type?: string; children?: unknown[] }, types);
    }
  }
}

describe("gfm markdown tables", () => {
  it("parses pipe tables into table nodes", () => {
    const tree = fromMarkdown(TABLE, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    });
    const types = new Set<string>();
    visitTypes(tree, types);
    assert.equal(types.has("table"), true);
    assert.equal(types.has("tableRow"), true);
    assert.equal(types.has("tableCell"), true);
  });
});
