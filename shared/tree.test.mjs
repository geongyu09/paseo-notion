import assert from "node:assert/strict";
import { test } from "node:test";
import { ancestry, childrenByParent, linkParents, listMarker, notionIdFromUrl, searchRows, visibleRows } from "./tree.ts";

const node = (id, extra = {}) => ({
  id,
  kind: "page",
  title: id,
  icon: null,
  parentId: null,
  databaseId: null,
  lastEdited: "2026-01-01T00:00:00.000Z",
  url: `https://app.notion.com/p/${id}`,
  ...extra,
});

test("linkParents maps database parents to the data source and orphans to roots", () => {
  const nodes = linkParents([
    node("ds", { kind: "database", databaseId: "db" }),
    node("row", { parentId: "db" }),
    node("child", { parentId: "row" }),
    node("orphan", { parentId: "unshared" }),
    node("self", { parentId: "self" }),
  ]);
  const parent = Object.fromEntries(nodes.map((n) => [n.id, n.parentId]));
  assert.deepEqual(parent, { ds: null, row: "ds", child: "row", orphan: null, self: null });
});

test("visibleRows walks only expanded nodes and sorts database rows newest first", () => {
  const nodes = linkParents([
    node("나", { title: "나" }),
    node("가", { title: "가" }),
    node("ds", { kind: "database", databaseId: "db", title: "다" }),
    node("old", { parentId: "db", lastEdited: "2026-01-01T00:00:00.000Z" }),
    node("new", { parentId: "db", lastEdited: "2026-02-01T00:00:00.000Z" }),
    node("deep", { parentId: "new" }),
  ]);
  const children = childrenByParent(nodes);
  const ids = (expanded) => visibleRows(children, new Set(expanded)).map((r) => `${r.depth}:${r.node.id}`);
  assert.deepEqual(ids([]), ["0:가", "0:나", "0:ds"]);
  assert.deepEqual(ids(["ds"]), ["0:가", "0:나", "0:ds", "1:new", "1:old"]);
  assert.deepEqual(ids(["ds", "new"]), ["0:가", "0:나", "0:ds", "1:new", "2:deep", "1:old"]);
  assert.equal(visibleRows(children, new Set()).find((r) => r.node.id === "ds").hasChildren, true);
});

test("searchRows matches titles case-insensitively with the parent title as path", () => {
  const nodes = [node("p", { title: "Parent" }), node("c", { title: "React 정리", parentId: "p" })];
  assert.deepEqual(
    searchRows(nodes, " react ").map((r) => [r.node.id, r.path]),
    [["c", "Parent"]],
  );
});

test("ancestry lists root first", () => {
  const nodes = [node("a"), node("b", { parentId: "a" }), node("c", { parentId: "b" })];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  assert.deepEqual(ancestry(byId, "c").map((n) => n.id), ["a", "b", "c"]);
});

test("notionIdFromUrl reads page links and ignores other sites", () => {
  const id = "0123abcd-ef01-4234-8567-89abcdef0123";
  assert.equal(notionIdFromUrl("https://app.notion.com/p/Page-0123abcdef014234856789abcdef0123"), id);
  assert.equal(notionIdFromUrl("https://www.notion.so/team/Title-0123abcdef014234856789abcdef0123?pvs=4"), id);
  assert.equal(notionIdFromUrl("/0123abcdef014234856789abcdef0123"), id);
  assert.equal(notionIdFromUrl("https://example.com/0123abcdef014234856789abcdef0123"), null);
});

test("listMarker cycles numbers, letters, and roman numerals by depth", () => {
  assert.deepEqual([1, 2, 3].map((n) => listMarker(true, n, 0)), ["1.", "2.", "3."]);
  assert.deepEqual([1, 26, 27].map((n) => listMarker(true, n, 1)), ["a.", "z.", "aa."]);
  assert.deepEqual([1, 4, 9, 14].map((n) => listMarker(true, n, 2)), ["i.", "iv.", "ix.", "xiv."]);
  assert.equal(listMarker(true, 2, 3), "2.");
  assert.deepEqual([0, 1, 2, 3].map((d) => listMarker(false, 1, d)), ["•", "◦", "▪", "•"]);
});
