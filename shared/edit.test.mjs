import assert from "node:assert/strict";
import { test } from "node:test";
import { editRichText, editSiblings, plainText, richTextRequest } from "./edit.ts";

const plain = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" };
const text = (content, annotations = {}, link = null) => ({
  type: "text",
  text: { content, link },
  annotations: { ...plain, ...annotations },
  plain_text: content,
  href: link?.url ?? null,
});
const mention = (label) => ({
  type: "mention",
  mention: { type: "page", page: { id: "p1" } },
  annotations: plain,
  plain_text: label,
  href: "https://www.notion.so/p1",
});
const shape = (items) => items.map((item) => [item.type, item.plain_text, item.annotations.bold]);

test("editRichText keeps formatting outside the edited span", () => {
  const items = [text("Hello "), text("bold", { bold: true }), text(" end")];
  const next = editRichText(items, "Hello boldest end");
  assert.equal(plainText(next), "Hello boldest end");
  assert.deepEqual(shape(next), [["text", "Hello ", false], ["text", "boldest", true], ["text", " end", false]]);
});

test("editRichText edits across items and keeps an untouched mention", () => {
  const items = [text("see "), mention("Page"), text(" now")];
  assert.deepEqual(shape(editRichText(items, "see Page later")), [
    ["text", "see ", false],
    ["mention", "Page", false],
    ["text", " later", false],
  ]);
  // Text typed right after a mention becomes plain text next to it.
  assert.deepEqual(shape(editRichText([mention("Page")], "Page!")), [["mention", "Page", false], ["text", "!", false]]);
  // A partly deleted mention turns into its remaining text.
  assert.deepEqual(shape(editRichText([mention("Page")], "Pa")), [["text", "Pa", false]]);
});

test("editRichText handles empty text, full deletion, and Notion's 2000-character limit", () => {
  assert.deepEqual(shape(editRichText([], "new")), [["text", "new", false]]);
  assert.deepEqual(editRichText([text("gone")], ""), []);
  const long = editRichText([], "a".repeat(4500));
  assert.deepEqual(long.map((item) => item.plain_text.length), [2000, 2000, 500]);
});

test("richTextRequest drops read-only fields and keeps links and mention ids", () => {
  const link = { url: "https://example.com" };
  const user = { type: "mention", mention: { type: "user", user: { object: "user", id: "u1", name: "A" } }, annotations: plain, plain_text: "@A" };
  assert.deepEqual(richTextRequest([text("x", {}, link), user]), [
    { type: "text", text: { content: "x", link }, annotations: plain },
    { type: "mention", mention: { type: "user", user: { id: "u1" } }, annotations: plain },
  ]);
});

test("editSiblings edits nested lists and leaves other branches shared", () => {
  const other = { id: "b", children: [{ id: "b1" }] };
  const blocks = [{ id: "a", children: [{ id: "a1" }, { id: "a2" }] }, other];
  const next = editSiblings(blocks, "a1", (list, i) => [...list.slice(0, i + 1), { id: "new" }, ...list.slice(i + 1)]);
  assert.deepEqual(next[0].children.map((block) => block.id), ["a1", "new", "a2"]);
  assert.equal(next[1], other);
  assert.equal(editSiblings(blocks, "missing", () => []), blocks);
});

test("edits applied one input change at a time keep a mention between them", () => {
  const items = [text("Hello "), text("world", { bold: true }), text(" see "), mention("Page"), text(" end")];
  const first = editRichText(items, "Hello big world see Page end");
  const second = editRichText(first, "Hello big world see Page the end");
  assert.deepEqual(shape(second), [
    ["text", "Hello big ", false],
    ["text", "world", true],
    ["text", " see ", false],
    ["mention", "Page", false],
    ["text", " the end", false],
  ]);
});

const { toMarkdown, fromMarkdown } = await import("./edit.ts");
const full = (items) => items.map((i) => [i.type, i.plain_text, Object.entries(i.annotations).filter(([, v]) => v && v !== "default").map(([k, v]) => (v === true ? k : v)).join("+"), i.text?.link?.url ?? ""]);

test("toMarkdown and fromMarkdown round-trip formatting, links, mentions, underline, and color", () => {
  const items = [
    text("plain [태그] 1~2 a*b "),
    text("bold", { bold: true }),
    text("both", { bold: true, italic: true }),
    text("it", { italic: true }),
    text(" "),
    text("x_y", { code: true }),
    text(" "),
    text("site", { strikethrough: true }, { url: "https://example.com" }),
    text(" red", { color: "red", underline: true }),
    mention("Page"),
  ];
  const markdown = toMarkdown(items);
  assert.equal(markdown, "plain [태그] 1~2 a\\*b **bold*both**it* `x_y` ~~[site](https://example.com)~~ red@[Page]");
  assert.deepEqual(full(fromMarkdown(markdown, items)), full(items));
  // Spaces at the edge of a formatted span go outside its markers.
  assert.equal(toMarkdown([text("a"), text(" b ", { bold: true }), text("c", { bold: true })]), "a **b** **c**");
});

test("fromMarkdown reads hand-typed syntax and keeps color on text that was not retyped", () => {
  const items = [text("red text", { color: "red" }), text(" tail")];
  assert.deepEqual(full(fromMarkdown("red **text** `new` tail", items)), [
    ["text", "red ", "red", ""],
    ["text", "text", "bold+red", ""],
    ["text", " ", "", ""],
    ["text", "new", "code", ""],
    ["text", " tail", "", ""],
  ]);
  // Unmatched markers and unknown mentions stay as typed.
  assert.deepEqual(full(fromMarkdown("2 * 3 ** @[nobody] `", [])), [["text", "2 * 3 ** @[nobody] `", "", ""]]);
});

const { blockPrefix, locate } = await import("./edit.ts");

test("blockPrefix reads Notion's Markdown block shortcuts and locate finds a nested block", () => {
  const types = (inputs) => inputs.map((input) => blockPrefix(input)?.type ?? null);
  assert.deepEqual(types(["# a", "#### a", "- a", "* a", "12. a", "[] a", "> a", '" a', "```"]), [
    "heading_1", "heading_4", "bulleted_list_item", "bulleted_list_item", "numbered_list_item", "to_do", "toggle", "quote", "code",
  ]);
  assert.deepEqual(types(["#a", "##### a", "**bold** a", "*it* a", "a - b", "-"]), [null, null, null, null, null, null]);
  assert.equal(blockPrefix("## title").rest, "title");
  const parent = { id: "a", children: [{ id: "a1" }, { id: "a2" }] };
  const found = locate([parent, { id: "b" }], "a2");
  assert.deepEqual([found.index, found.parent, found.list.length], [1, parent, 2]);
  assert.equal(locate([parent], "missing"), undefined);
});

const { slashCommand } = await import("./edit.ts");

test("slashCommand finds the command at the end of the text and filters the menu", () => {
  assert.equal(slashCommand("/").items.length, 12);
  // English and Korean names match in either app language.
  for (const query of ["/heading2", "/제목2"]) assert.deepEqual(slashCommand(query).items.map((item) => item.type), ["heading_2"]);
  assert.deepEqual(slashCommand("/할일").items.map((item) => item.type), ["to_do"]);
  assert.deepEqual(slashCommand("some text /todo").items.map((item) => item.type), ["to_do"]);
  assert.equal(slashCommand("some text /todo").start, 9);
  assert.equal(slashCommand("a/b"), null);
  assert.equal(slashCommand("/code more"), null);
});
